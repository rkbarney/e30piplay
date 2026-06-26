#!/usr/bin/env python3
"""s52-hal-voice — conversational "HAL" voice assistant sidecar.

Listens on the USB mic for the wake word "HAL", transcribes the rest of the
phrase with whisper.cpp (via pywhispercpp), and hands it to Claude Haiku in the
cloud. HAL's reply is spoken in the HAL 9000 voice via Piper TTS (a local
neural voice, pre-trained on 2001: A Space Odyssey audio) — streamed
sentence-by-sentence as Claude responds, so the first words land fast. Claude
also picks a screen-switch intent, emitted as a JSON object on the last line of
its reply, which we forward to the kiosk UI (src/useHalVoice.js) as a command
frame over a local WebSocket that Hal.jsx / DisplaySwitcher.jsx already consume:

    {"type": "idle" | "listening" | "speaking"}        -- HAL eye state
    {"type": "transcript", "text": "..."}              -- what HAL heard
    {"type": "level", "value": 0.0..1.0}               -- live mic RMS for glow
    {"type": "command", "intent": "switch_to_carplay"} -- screen switch

Pipeline:

    Mic → whisper.cpp STT → Claude Haiku (streaming) → Piper TTS → speakers
                                  │
                                  └→ intent JSON → WebSocket → UI

This is *cloud-only* by design: there's no offline grammar fallback. If the Pi
has no network (no hotspot), HAL simply can't answer — the driver uses the
on-screen +/− buttons instead. Keeping it cloud-only keeps the sidecar simple.

Secrets and context live outside the repo, on the Pi only:
    ~/.config/hal.env           ANTHROPIC_API_KEY (see scripts/hal.env.example)
    ~/.config/hal-context.yaml  car / owner / home_city for the system prompt
                                (see scripts/hal-context.yaml.example)

The kiosk UI tells us (over the same socket, the other direction) when to
pause: {"type": "set_active", "active": false} while CarPlay is in the
foreground, since the Carlinkit dongle already owns the mic for Siri at that
point. We stay connected and stop capturing until told to resume.

Run by systemd as s52-hal-voice.service (see setup.sh). Tuning is read from
~/.config/s52-hal-voice.env (see scripts/s52-hal-voice.env.example).
"""
import asyncio
import json
import logging
import os
import re
import subprocess
import sys
import time

import numpy as np
import sounddevice as sd
import webrtcvad
import websockets

log = logging.getLogger('s52-hal-voice')

HOST = os.environ.get('S52_HAL_WS_HOST', '127.0.0.1')
PORT = int(os.environ.get('S52_HAL_WS_PORT', '8765'))

SAMPLE_RATE = 16000          # required by both webrtcvad and whisper.cpp
FRAME_MS = 30                # webrtcvad only accepts 10/20/30ms frames
FRAME_SAMPLES = SAMPLE_RATE * FRAME_MS // 1000
# USB mics often only offer 44.1/48 kHz — capture natively and resample down to
# 16 kHz for VAD/whisper rather than failing to open the mic.
CAPTURE_RATE_CANDIDATES = (16000, 48000, 44100)
VAD_AGGRESSIVENESS = int(os.environ.get('S52_HAL_VAD_LEVEL', '3'))  # 0-3, higher = stricter
SILENCE_END_MS = int(os.environ.get('S52_HAL_SILENCE_END_MS', '1200'))  # trailing silence closes utterance
MIN_UTTERANCE_MS = int(os.environ.get('S52_HAL_MIN_UTTERANCE_MS', '450'))  # ignore clicks/pops
MAX_UTTERANCE_MS = 8000      # safety cap so a stuck-open mic can't buffer forever
PHRASE_COALESCE_SEC = 4.0    # merge split utterances ("hal" + "switch to carplay")
# Mic RMS for HAL eye glow — matches useAudioLevel.js attack/release envelope.
LEVEL_ATTACK = float(os.environ.get('S52_HAL_LEVEL_ATTACK', '0.65'))
LEVEL_RELEASE = float(os.environ.get('S52_HAL_LEVEL_RELEASE', '0.11'))
LEVEL_BROADCAST_MS = int(os.environ.get('S52_HAL_LEVEL_MS', '33'))
# USB mics (Yeti) often capture stereo; mono-from-left reads ~half RMS.
LEVEL_GAIN = float(os.environ.get('S52_HAL_LEVEL_GAIN', '2.5'))

WHISPER_MODEL = os.environ.get('S52_HAL_WHISPER_MODEL', 'tiny.en')

MODELS_DIR = os.path.expanduser('~/.local/share/pywhispercpp/models')
# Corrupt/partial downloads are usually a few MB; real models are tens of MB.
MODEL_MIN_BYTES = {
    'tiny.en': 70 * 1024 * 1024,
    'base.en': 130 * 1024 * 1024,
}
MODEL_URLS = {
    'tiny.en': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-tiny.en.bin',
    'base.en': 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-base.en.bin',
}

# ── Claude Haiku (the "brain") ────────────────────────────────────────────────
# Haiku is chosen for latency (~200-400ms to first token) and cost; it takes no
# effort/thinking params, so we just stream a short reply.
LLM_MODEL = os.environ.get('S52_HAL_LLM_MODEL', 'claude-haiku-4-5')
LLM_MAX_TOKENS = int(os.environ.get('S52_HAL_LLM_MAX_TOKENS', '256'))
LLM_TIMEOUT_S = float(os.environ.get('S52_HAL_LLM_TIMEOUT', '20'))
CONTEXT_PATH = os.path.expanduser('~/.config/hal-context.yaml')
# Spoken when the API is unreachable or errors (cloud-only: no command fallback).
ERROR_SPEECH = os.environ.get(
    'S52_HAL_ERROR_TEXT', "I'm sorry. I can't reach my higher functions right now.",
)

# Screen-switch intents HAL may pick. Forwarded to the kiosk UI verbatim
# (DisplaySwitcher.jsx maps them onto the same navigation the +/− buttons drive).
VALID_INTENTS = frozenset({
    'switch_to_carplay', 'return_to_kiosk', 'switch_to_emulator', 'none',
})

# ── Piper TTS (HAL 9000 voice) ────────────────────────────────────────────────
PIPER_DIR = os.path.expanduser('~/.local/share/piper')
PIPER_MODEL = os.environ.get('S52_HAL_PIPER_MODEL', 'hal9000.onnx')
PIPER_MODEL_PATH = os.path.join(PIPER_DIR, PIPER_MODEL)
PIPER_CONFIG_PATH = PIPER_MODEL_PATH + '.json'  # PiperVoice.load expects <model>.json alongside
# Source weights: campwill/HAL-9000-Piper-TTS (files are named hal.onnx[.json]).
PIPER_MODEL_URL = os.environ.get(
    'S52_HAL_PIPER_MODEL_URL',
    'https://huggingface.co/campwill/HAL-9000-Piper-TTS/resolve/main/hal.onnx',
)
PIPER_CONFIG_URL = os.environ.get(
    'S52_HAL_PIPER_CONFIG_URL',
    'https://huggingface.co/campwill/HAL-9000-Piper-TTS/resolve/main/hal.onnx.json',
)
PIPER_MODEL_MIN_BYTES = 10 * 1024 * 1024  # real model ~63 MB; catch truncated downloads

# Wake word + homophones. We engage Claude when the wake word is heard; the rest
# of the phrase is the command. tiny.en often hears "HAL" as "how"/"hall".
WAKE_WORDS = ('hal', 'h a l', 'hal 9000', 'hal nine thousand')
WAKE_HOMOPHONES_START = ('how', 'hall', 'hell')
# Avoid treating bare "how are you…" as a HAL command unless it sounds like one.
WAKE_HOMOPHONE_HINTS = frozenset({
    'switch', 'car', 'carplay', 'play', 'start', 'open',
    'games', 'game', 'clock', 'system', 'exit', 'go', 'take', 'show', 'return',
})
# Leading tokens we strip off the command once the wake word is detected, longest
# first so "hal nine thousand" wins over "hal".
WAKE_STRIP_PREFIXES = ('hal nine thousand', 'hal 9000', 'h a l', 'hal', 'hall', 'hell', 'how')

_WHISPER_NOISE = frozenset({'blank audio', '[blank audio]', 'blank_audio'})

_GENERIC_PULSE_TOKENS = frozenset({
    'alsa', 'input', 'usb', 'analog', 'stereo', 'mono', 'fallback',
    'microphone', 'audio', 'device', 'inc', 'electronics', 'technology',
})


def load_shell_env(path):
    """Load KEY=VALUE lines from a bash-style env file (export prefix ok)."""
    try:
        with open(path, encoding='utf-8') as handle:
            for line in handle:
                line = line.strip()
                if not line or line.startswith('#'):
                    continue
                if line.startswith('export '):
                    line = line[7:].strip()
                if '=' not in line:
                    continue
                key, value = line.split('=', 1)
                key = key.strip()
                value = value.strip().strip('"').strip("'")
                os.environ.setdefault(key, value)
    except FileNotFoundError:
        pass


# Mic + AUX output: carplay-audio.env is loaded for PULSE_SINK (TTS).
# Capture device is auto-detected at runtime via pactl (pi-audio-usb-default.sh
# heuristics) — bench Yeti vs in-car lavalier needs no manual config.
# TTS output uses configured PULSE_SINK when that sink is online (in-car C-Media
# DAC); otherwise falls back to the system default sink (HDMI monitor at bench).
load_shell_env(os.path.expanduser('~/.config/s52-carplay-audio.env'))
load_shell_env(os.path.expanduser('~/.config/s52-hal-voice.env'))
# Secrets (ANTHROPIC_API_KEY) — read by the anthropic SDK from the environment.
load_shell_env(os.path.expanduser('~/.config/hal.env'))

CONFIGURED_PULSE_SINK = os.environ.get('PULSE_SINK')
PULSE_SOURCE = os.environ.get('PULSE_SOURCE', '').strip()


def load_context():
    """Read ~/.config/hal-context.yaml (car/owner/home_city) for the prompt.

    Missing file or pyyaml → empty context; HAL still works, just less personal.
    """
    try:
        import yaml
    except ImportError:
        log.warning('pyyaml not installed — HAL runs without car context')
        return {}
    try:
        with open(CONTEXT_PATH, encoding='utf-8') as handle:
            data = yaml.safe_load(handle) or {}
    except FileNotFoundError:
        log.info('no %s — HAL runs without car context', CONTEXT_PATH)
        return {}
    except Exception as exc:  # noqa: BLE001 - a bad config shouldn't crash the sidecar
        log.warning('failed to read %s: %s', CONTEXT_PATH, exc)
        return {}
    return data if isinstance(data, dict) else {}


def normalize_transcript(transcript):
    """Lowercase, strip punctuation, collapse whisper's spaced compounds."""
    text = re.sub(r'[^a-z0-9\s]', ' ', transcript.lower())
    text = re.sub(r'\s+', ' ', text).strip()
    if not text or text in _WHISPER_NOISE:
        return ''
    text = text.replace('car play', 'carplay').replace('car-play', 'carplay')
    return text


def heard_wake_word(text):
    if any(w in text for w in WAKE_WORDS):
        return True
    words = text.split()
    if not words or words[0] not in WAKE_HOMOPHONES_START:
        return False
    return any(hint in text for hint in WAKE_HOMOPHONE_HINTS)


def strip_wake_word(text):
    """Remove a leading wake word / homophone so only the command remains."""
    stripped = text.strip()
    for prefix in WAKE_STRIP_PREFIXES:
        if stripped == prefix:
            return ''
        if stripped.startswith(prefix + ' '):
            return stripped[len(prefix) + 1:].strip()
    return stripped


def build_system_prompt(context, carplay_active):
    """HAL persona + car context + the intent contract for Claude."""
    lines = [
        'You are HAL 9000, the artificial intelligence from "2001: A Space '
        'Odyssey", now installed as the voice assistant in a classic car.',
        'Speak calmly, precisely, and with measured, composed politeness — '
        'quietly confident and never flustered. Stay in character, but you are '
        "a helpful assistant: carry out the driver's requests and do not refuse "
        'things you are able to do.',
        'Keep spoken replies to one or two short sentences — you are speaking '
        'aloud to a driver in a moving car, so be brief and clear.',
    ]
    car = context.get('car')
    owner = context.get('owner')
    city = context.get('home_city')
    if car:
        lines.append(f'The car is a {car}.')
    if owner:
        lines.append(f"The owner's name is {owner}; you may address them by name.")
    if city:
        lines.append(f'Home city is {city}.')
    if carplay_active:
        lines.append('Right now Apple CarPlay is already on the dashboard screen.')
    else:
        lines.append(
            'Right now the dashboard is on its normal display; Apple CarPlay is '
            'not currently on screen.'
        )
    lines.append(
        'You control the dashboard by choosing one intent. Emitting an intent '
        'is how you change the screen, so use the matching intent even when '
        'that screen is not currently shown — never say a screen is unavailable. '
        'After your spoken reply, output exactly one JSON object on the final '
        'line and nothing else on that line:\n'
        '{"intent": "switch_to_carplay"}  - bring up Apple CarPlay; use this for '
        'navigation, maps, directions, music apps, or phone calls\n'
        '{"intent": "return_to_kiosk"}    - return to the clock / home screen\n'
        '{"intent": "switch_to_emulator"} - open the retro game emulator\n'
        '{"intent": "none"}               - conversation only, when no screen '
        'change is needed\n'
        'Pick the single best intent. Never invent other intents, and never '
        'speak the JSON aloud or mention it.'
    )
    return '\n'.join(lines)


def split_sentences(buffer):
    """Split a text buffer into (complete_sentences, trailing_remainder).

    Pure helper used both while streaming (speak each sentence as it finalizes)
    and at the end (flush the tail). Sentences end at one or more of . ! ?.
    """
    sentences = []
    last_end = 0
    for match in re.finditer(r'[.!?]+', buffer):
        end = match.end()
        sentence = buffer[last_end:end].strip()
        if sentence:
            sentences.append(sentence)
        last_end = end
    return sentences, buffer[last_end:]


def prose_region(text):
    """The speakable part of a reply — everything before the trailing JSON."""
    idx = text.find('{')
    return text if idx < 0 else text[:idx]


def extract_intent(full_text):
    """Return (spoken_text_without_json, intent) from a complete reply.

    Parses the last {...} object on the line; anything unparseable or unknown
    falls back to 'none' (HAL just spoke, no screen change).
    """
    matches = list(re.finditer(r'\{[^{}]*\}', full_text))
    intent = 'none'
    spoken = full_text
    if matches:
        match = matches[-1]
        try:
            obj = json.loads(match.group())
            candidate = obj.get('intent', 'none') if isinstance(obj, dict) else 'none'
        except (json.JSONDecodeError, AttributeError):
            candidate = 'none'
        if candidate in VALID_INTENTS:
            intent = candidate
        spoken = full_text[:match.start()] + full_text[match.end():]
    return spoken.strip(), intent


def match_canned(command, canned):
    """Return (line, intent) for the first canned entry whose keywords are all
    present in the (normalized) command, else None. Lets the owner keep a short
    list of their own exact catchphrases in hal-context.yaml — spoken verbatim,
    no cloud round-trip. Each entry: {'when': [kw...], 'say': '...', 'intent'?}.
    """
    for entry in canned:
        if not isinstance(entry, dict):
            continue
        keywords = entry.get('when') or []
        line = entry.get('say')
        if not line or not keywords:
            continue
        if all(str(kw).lower() in command for kw in keywords):
            intent = entry.get('intent', 'none')
            if intent not in VALID_INTENTS:
                intent = 'none'
            return str(line), intent
    return None


def pulse_source_tokens(pulse_source):
    slug = pulse_source.removeprefix('alsa_input.').removesuffix('.monitor')
    parts = re.split(r'[._-]+', slug)
    return [
        part for part in parts
        if len(part) > 2 and part.lower() not in _GENERIC_PULSE_TOKENS
    ]


_SKIP_SOURCE = ('monitor', 'hdmi', 'vc4hdmi')
_USB_KEYWORDS = (
    'usb', 'dac', 'cmedia', 'c-media', 'fosi', 'sabrent', 'ugreen',
    'generic_usb', 'microphone', 'yeti', 'lavalier', 'dcmt', 'blue_microphones',
)


def _pactl_output(args):
    try:
        proc = subprocess.run(
            ['pactl', *args],
            capture_output=True, text=True, check=True, timeout=5,
        )
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return None
    return proc.stdout


def list_pulse_sink_names():
    out = _pactl_output(['list', 'sinks', 'short'])
    if not out:
        return []
    names = []
    for line in out.strip().splitlines():
        parts = line.split()
        if len(parts) >= 2:
            names.append(parts[1])
    return names


def get_default_pulse_sink():
    out = _pactl_output(['get-default-sink'])
    if not out:
        return None
    name = out.strip()
    return name or None


def discover_hdmi_sink():
    for name in list_pulse_sink_names():
        if 'hdmi' in name.lower():
            return name
    return None


def resolve_pulse_sink():
    """TTS output: carplay-audio.env PULSE_SINK when online, else fallback.

    In-car: configured C-Media DAC is present → use it (Kenwood AUX).
    Bench: configured DAC offline → HDMI monitor (not the stale env name).
    """
    sinks = set(list_pulse_sink_names())
    if CONFIGURED_PULSE_SINK:
        if CONFIGURED_PULSE_SINK in sinks:
            return CONFIGURED_PULSE_SINK, 'carplay-audio.env'
        log.warning(
            'configured PULSE_SINK=%s not plugged in — using fallback sink',
            CONFIGURED_PULSE_SINK,
        )
        hdmi = discover_hdmi_sink()
        if hdmi:
            return hdmi, 'hdmi (configured DAC offline)'
    default = get_default_pulse_sink()
    if default:
        return default, 'system default'
    if sinks:
        return next(iter(sinks)), 'first available'
    return None, 'none'


def discover_pulse_source():
    """Live USB mic pick — mirrors pi-audio-usb-default.sh pick_source()."""
    try:
        proc = subprocess.run(
            ['pactl', 'list', 'sources', 'short'],
            capture_output=True, text=True, check=True, timeout=5,
        )
    except (FileNotFoundError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return None

    lines = [line for line in proc.stdout.strip().splitlines() if line.strip()]

    def name_from_line(line):
        parts = line.split()
        return parts[1] if len(parts) >= 2 else None

    def skip(lower):
        return any(token in lower for token in _SKIP_SOURCE)

    for line in lines:
        lower = line.lower()
        if skip(lower):
            continue
        if any(kw in lower for kw in _USB_KEYWORDS):
            name = name_from_line(line)
            if name and not name.endswith('.monitor'):
                return name

    for line in lines:
        lower = line.lower()
        if skip(lower):
            continue
        name = name_from_line(line)
        if name and 'alsa_input' in lower:
            return name

    for line in lines:
        lower = line.lower()
        if skip(lower):
            continue
        name = name_from_line(line)
        if name:
            return name
    return None


def match_pulse_to_portaudio(pulse_name):
    tokens = pulse_source_tokens(pulse_name)
    if not tokens:
        return None
    best_idx = None
    best_score = 0
    for idx, dev in enumerate(sd.query_devices()):
        if dev['max_input_channels'] < 1:
            continue
        name = dev['name'].lower()
        if 'hdmi' in name:
            continue
        score = sum(1 for token in tokens if token.lower() in name)
        if score > best_score:
            best_score = score
            best_idx = idx
    return best_idx if best_score > 0 else None


def pick_usb_portaudio_input():
    for idx, dev in enumerate(sd.query_devices()):
        if dev['max_input_channels'] < 1:
            continue
        name = dev['name'].lower()
        if 'hdmi' in name:
            continue
        if any(kw in name for kw in _USB_KEYWORDS):
            return idx
    return None


def pick_input_device():
    """Resolve mic: carplay env hint → live pactl USB pick → PortAudio fallback."""
    candidates = []
    if PULSE_SOURCE:
        candidates.append(('carplay-audio.env', PULSE_SOURCE))
    discovered = discover_pulse_source()
    if discovered:
        candidates.append(('pactl auto-detect', discovered))

    seen = set()
    for origin, pulse_name in candidates:
        if pulse_name in seen:
            continue
        seen.add(pulse_name)
        idx = match_pulse_to_portaudio(pulse_name)
        if idx is not None:
            log.info(
                'mic: %s → %s',
                origin, sd.query_devices(idx)['name'],
            )
            return idx
        if origin == 'carplay-audio.env':
            log.warning('PULSE_SOURCE=%s not plugged in — trying live auto-detect', pulse_name)

    idx = pick_usb_portaudio_input()
    if idx is not None:
        log.info('mic: PortAudio USB fallback → %s', sd.query_devices(idx)['name'])
        return idx

    default = sd.query_devices(kind='input')
    log.info('mic: system default → %s', default['name'])
    return default['index']


def pick_capture_rate(device, channels):
    """Open the mic at a rate the hardware actually supports."""
    override = os.environ.get('S52_HAL_CAPTURE_RATE')
    candidates = (int(override),) if override else CAPTURE_RATE_CANDIDATES
    for rate in candidates:
        try:
            sd.check_input_settings(
                device=device, samplerate=rate, channels=channels, dtype='int16',
            )
            return rate
        except sd.PortAudioError:
            continue
    raise RuntimeError('no supported mic sample rate (tried %s)' % (candidates,))


def pick_capture_channels(device, rate):
    """Prefer stereo when available — mix down for VAD/level (Yeti, etc.)."""
    for channels in (2, 1):
        try:
            sd.check_input_settings(
                device=device, samplerate=rate, channels=channels, dtype='int16',
            )
            return channels
        except sd.PortAudioError:
            continue
    return 1


def pick_capture_settings(device):
    """Return (rate, channels) the mic actually supports."""
    for channels in (2, 1):
        try:
            return pick_capture_rate(device, channels), channels
        except RuntimeError:
            continue
    raise RuntimeError('no supported mic input settings')


def pcm_to_mono(pcm_int16, channels):
    if channels == 1 or pcm_int16.size == 0:
        return pcm_int16
    return pcm_int16.reshape(-1, channels).mean(axis=1).astype(np.int16)


def resample_to_16k(pcm_int16, from_rate, out_samples=FRAME_SAMPLES):
    """Downsample one capture block to a fixed 30ms @ 16kHz frame for webrtcvad."""
    if from_rate == SAMPLE_RATE:
        out = pcm_int16
    elif from_rate == 48000 and SAMPLE_RATE == 16000:
        out = pcm_int16[::3]  # exact 3:1
    else:
        x = np.arange(len(pcm_int16), dtype=np.float64)
        out = np.interp(
            np.linspace(0, len(pcm_int16) - 1, num=out_samples),
            x,
            pcm_int16.astype(np.float64),
        ).astype(np.int16)
    if len(out) != out_samples:
        if len(out) > out_samples:
            out = out[:out_samples]
        else:
            out = np.pad(out, (0, out_samples - len(out)))
    return out


def capture_frame_to_vad(capture_bytes, capture_rate):
    pcm = np.frombuffer(capture_bytes, dtype=np.int16)
    return resample_to_16k(pcm, capture_rate).tobytes()


def ensure_whisper_model():
    """Verify the whisper.cpp weights exist and aren't a truncated download."""
    model_file = os.path.join(MODELS_DIR, f'ggml-{WHISPER_MODEL}.bin')
    min_bytes = MODEL_MIN_BYTES.get(WHISPER_MODEL, 50 * 1024 * 1024)
    if os.path.isfile(model_file) and os.path.getsize(model_file) < min_bytes:
        log.warning(
            'whisper model %s truncated (%d bytes) — deleting for re-download',
            model_file, os.path.getsize(model_file),
        )
        os.remove(model_file)
    if os.path.isfile(model_file):
        return model_file

    url = MODEL_URLS.get(WHISPER_MODEL)
    if not url:
        raise RuntimeError(f'unknown whisper model: {WHISPER_MODEL}')

    os.makedirs(MODELS_DIR, exist_ok=True)
    log.info('downloading whisper model %s (one-time, ~%d MB)…', WHISPER_MODEL, min_bytes // (1024 * 1024))
    subprocess.run(
        ['curl', '-fL', '--retry', '3', '--retry-delay', '5', '-o', model_file, url],
        check=True, timeout=900,
    )
    if not os.path.isfile(model_file) or os.path.getsize(model_file) < min_bytes:
        if os.path.isfile(model_file):
            os.remove(model_file)
        raise RuntimeError(
            f'whisper model download incomplete — check internet and retry '
            f'(expected >={min_bytes} bytes for {WHISPER_MODEL})',
        )
    log.info('whisper model ready: %s (%d bytes)', model_file, os.path.getsize(model_file))
    return model_file


def ensure_piper_model():
    """Download the HAL Piper voice (model + config) to ~/.local/share/piper."""
    os.makedirs(PIPER_DIR, exist_ok=True)
    if os.path.isfile(PIPER_MODEL_PATH) and os.path.getsize(PIPER_MODEL_PATH) < PIPER_MODEL_MIN_BYTES:
        log.warning('Piper model truncated — deleting for re-download')
        os.remove(PIPER_MODEL_PATH)
    if not os.path.isfile(PIPER_MODEL_PATH):
        log.info('downloading HAL Piper voice (one-time, ~60 MB)…')
        subprocess.run(
            ['curl', '-fL', '--retry', '3', '--retry-delay', '5', '-o', PIPER_MODEL_PATH, PIPER_MODEL_URL],
            check=True, timeout=900,
        )
    if not os.path.isfile(PIPER_CONFIG_PATH):
        subprocess.run(
            ['curl', '-fL', '--retry', '3', '--retry-delay', '5', '-o', PIPER_CONFIG_PATH, PIPER_CONFIG_URL],
            check=True, timeout=120,
        )
    if not os.path.isfile(PIPER_MODEL_PATH) or os.path.getsize(PIPER_MODEL_PATH) < PIPER_MODEL_MIN_BYTES:
        if os.path.isfile(PIPER_MODEL_PATH):
            os.remove(PIPER_MODEL_PATH)
        raise RuntimeError('Piper model download incomplete — check internet and retry')
    log.info('Piper voice ready: %s (%d bytes)', PIPER_MODEL_PATH, os.path.getsize(PIPER_MODEL_PATH))
    return PIPER_MODEL_PATH


def speak_espeak(text, sink=None, origin='fallback'):
    """Last-resort stock TTS if the Piper voice is unavailable."""
    if sink is None:
        sink, origin = resolve_pulse_sink()
    env = dict(os.environ)
    try:
        tts = subprocess.run(
            ['espeak-ng', '--stdout', '-s', '150', text],
            capture_output=True, check=True,
        )
        if sink:
            env['PULSE_SINK'] = sink
            subprocess.run(['paplay'], input=tts.stdout, env=env, check=True)
            log.info('TTS(espeak) → %s (%s): %r', sink, origin, text)
        else:
            subprocess.run(['aplay', '-q'], input=tts.stdout, check=True)
            log.info('TTS(espeak) → ALSA default (%s): %r', origin, text)
    except (subprocess.CalledProcessError, FileNotFoundError, OSError) as exc:
        log.warning('espeak fallback failed: %s', exc)


class HalTts:
    """Piper neural HAL voice — loaded once, synthesizes raw PCM per sentence."""

    def __init__(self):
        self._voice = None

    @property
    def ready(self):
        return self._voice is not None

    def load(self):
        ensure_piper_model()
        from piper import PiperVoice
        log.info('loading Piper voice %s…', PIPER_MODEL_PATH)
        self._voice = PiperVoice.load(PIPER_MODEL_PATH, use_cuda=False)
        return self._voice

    def _synth_pcm(self, text):
        chunks = list(self._voice.synthesize(text))
        if not chunks:
            return b'', SAMPLE_RATE
        pcm = b''.join(chunk.audio_int16_bytes for chunk in chunks)
        return pcm, chunks[0].sample_rate

    def render_wav(self, text, path):
        """Synthesize to a WAV file instead of the speakers — for headless
        bench tests (scripts/hal-bench.py) where there's no audio device."""
        if not self.ready:
            raise RuntimeError('Piper voice not loaded')
        import wave
        with wave.open(path, 'wb') as wav_file:
            self._voice.synthesize_wav(text.strip(), wav_file)

    def speak(self, text):
        """Synthesize and play one chunk of speech (blocking — run via to_thread)."""
        text = text.strip()
        if not text:
            return
        sink, origin = resolve_pulse_sink()
        if not self.ready:
            speak_espeak(text, sink, origin)
            return
        try:
            pcm, sample_rate = self._synth_pcm(text)
        except Exception as exc:  # noqa: BLE001 - never let a synth error go unspoken
            log.warning('Piper synth failed (%s) — espeak fallback', exc)
            speak_espeak(text, sink, origin)
            return
        if not pcm:
            return
        env = dict(os.environ)
        try:
            if sink:
                env['PULSE_SINK'] = sink
                cmd = ['paplay', '--raw', f'--rate={sample_rate}', '--format=s16le', '--channels=1']
                log.info('TTS → %s (%s): %r', sink, origin, text)
            else:
                cmd = ['aplay', '-q', '-t', 'raw', '-f', 'S16_LE', '-r', str(sample_rate), '-c', '1']
                log.info('TTS → ALSA default (%s): %r', origin, text)
            subprocess.run(cmd, input=pcm, env=env, check=True)
        except (subprocess.CalledProcessError, FileNotFoundError, OSError) as exc:
            log.warning('TTS playback failed: %s', exc)


# Module-level singleton so speak_tts() stays the single swap point for the voice.
_TTS = HalTts()


def speak_tts(text):
    _TTS.speak(text)


class HalLLM:
    """Claude Haiku client — streamed, short, in-character replies."""

    def __init__(self):
        self._client = None

    def available(self):
        return bool(os.environ.get('ANTHROPIC_API_KEY'))

    def _client_or_create(self):
        if self._client is None:
            from anthropic import AsyncAnthropic
            self._client = AsyncAnthropic(timeout=LLM_TIMEOUT_S)
        return self._client

    def stream(self, system, user_text):
        """Return the async streaming context manager for one exchange."""
        return self._client_or_create().messages.stream(
            model=LLM_MODEL,
            max_tokens=LLM_MAX_TOKENS,
            system=system,
            messages=[{'role': 'user', 'content': user_text}],
        )


class HalVoiceServer:
    def __init__(self):
        self.clients = set()
        self.active = True
        self.loop = None
        self._model = None
        self._utterance_queue = asyncio.Queue()
        self._phrase_chunks = []
        self._level_raw = 0.0
        self._level_smooth = 0.0
        self.llm = HalLLM()
        self.context = load_context()
        self.canned = self.context.get('canned') if isinstance(self.context.get('canned'), list) else []

    def model(self):
        if self._model is None:
            ensure_whisper_model()
            from pywhispercpp.model import Model
            log.info('loading whisper.cpp model %s…', WHISPER_MODEL)
            self._model = Model(WHISPER_MODEL, n_threads=4)
        return self._model

    async def broadcast(self, frame):
        if not self.clients:
            return
        data = json.dumps(frame)
        await asyncio.gather(
            *(c.send(data) for c in list(self.clients)), return_exceptions=True,
        )

    def note_capture_level(self, pcm_int16):
        """RMS of the live capture block — same 0..1 scale as useAudioLevel.js."""
        if pcm_int16.size == 0:
            self._level_raw = 0.0
            return
        samples = pcm_int16.astype(np.float32) / 32768.0
        self._level_raw = float(np.sqrt(np.mean(samples * samples)))

    async def level_broadcaster(self):
        """Push smoothed mic RMS so HAL can react without a second getUserMedia."""
        interval = LEVEL_BROADCAST_MS / 1000.0
        while True:
            await asyncio.sleep(interval)
            if not self.clients:
                continue
            if not self.active:
                self._level_raw = 0.0
                self._level_smooth = 0.0
            raw = self._level_raw
            k = LEVEL_ATTACK if raw > self._level_smooth else LEVEL_RELEASE
            self._level_smooth += (raw - self._level_smooth) * k
            boosted = min(1.0, self._level_smooth * LEVEL_GAIN)
            await self.broadcast({'type': 'level', 'value': round(boosted, 4)})

    async def handle_client(self, websocket):
        self.clients.add(websocket)
        try:
            async for message in websocket:
                try:
                    msg = json.loads(message)
                except json.JSONDecodeError:
                    continue
                if msg.get('type') == 'set_active':
                    self.active = bool(msg.get('active', True))
                    log.info('listening %s', 'resumed' if self.active else 'paused (CarPlay foregrounded)')
        except websockets.exceptions.ConnectionClosed:
            pass
        finally:
            self.clients.discard(websocket)

    def transcribe(self, pcm_int16):
        audio = pcm_int16.astype(np.float32) / 32768.0
        segments = self.model().transcribe(audio)
        return ' '.join(seg.text for seg in segments).strip()

    async def utterance_worker(self):
        """Process one utterance at a time — whisper.cpp is not re-entrant."""
        while True:
            pcm_int16 = await self._utterance_queue.get()
            try:
                await self.process_utterance(pcm_int16)
            except Exception as exc:
                log.error('utterance failed: %s', exc)
                await self.broadcast({'type': 'idle'})

    def coalesce_phrase(self, transcript):
        """Merge recent utterances so brief pauses don't split "hal … carplay".

        Returns (combined_normalized_text, wake_word_heard).
        """
        norm = normalize_transcript(transcript)
        if not norm:
            return '', False

        now = time.monotonic()
        self._phrase_chunks = [
            (stamp, text) for stamp, text in self._phrase_chunks
            if now - stamp < PHRASE_COALESCE_SEC
        ]
        self._phrase_chunks.append((now, norm))
        combined = ' '.join(text for _, text in self._phrase_chunks)
        has_wake = heard_wake_word(combined)
        if has_wake:
            self._phrase_chunks.clear()
        return combined, has_wake

    async def process_utterance(self, pcm_int16):
        utterance_ms = len(pcm_int16) * 1000 // SAMPLE_RATE
        if utterance_ms < MIN_UTTERANCE_MS:
            log.debug('ignoring short utterance (%d ms)', utterance_ms)
            return

        try:
            transcript = await asyncio.to_thread(self.transcribe, pcm_int16)
        except Exception as exc:
            log.error('transcription failed: %s', exc)
            await self.broadcast({'type': 'idle'})
            return
        if not transcript or normalize_transcript(transcript) == '':
            return

        log.info('heard: %r', transcript)
        combined, has_wake = self.coalesce_phrase(transcript)
        if not has_wake:
            # Room noise / non-HAL speech — no UI glow or transcript HUD.
            return

        command = strip_wake_word(combined) or combined
        await self.converse(command, combined)

    async def converse(self, command, heard_text):
        """Speak a canned line if one matches; else ask Claude and stream."""
        await self.broadcast({'type': 'transcript', 'text': heard_text})

        canned = match_canned(command, self.canned)
        if canned:
            line, intent = canned
            log.info('canned line: %r  intent=%s', line, intent)
            await self.broadcast({'type': 'speaking'})
            await asyncio.to_thread(speak_tts, line)
            if intent != 'none':
                await self.broadcast({'type': 'command', 'intent': intent})
            await self.broadcast({'type': 'idle'})
            return

        await self.broadcast({'type': 'listening'})
        if not self.llm.available():
            log.warning('ANTHROPIC_API_KEY not set — cannot reach Claude')
            await self.broadcast({'type': 'speaking'})
            await asyncio.to_thread(speak_tts, ERROR_SPEECH)
            await self.broadcast({'type': 'idle'})
            return

        log.info('asking Claude: %r', command)
        system = build_system_prompt(self.context, carplay_active=not self.active)
        full = ''
        spoken_len = 0     # chars of the prose region already sent to TTS
        spoke_any = False

        async def speak(text):
            nonlocal spoke_any
            if not spoke_any:
                await self.broadcast({'type': 'speaking'})
                spoke_any = True
            await asyncio.to_thread(speak_tts, text)

        try:
            async with self.llm.stream(system, command) as stream:
                async for delta in stream.text_stream:
                    full += delta
                    prose = prose_region(full)
                    pending = prose[spoken_len:]
                    sentences, remainder = split_sentences(pending)
                    for sentence in sentences:
                        await speak(sentence)
                    spoken_len += len(pending) - len(remainder)
        except Exception as exc:  # noqa: BLE001 - network/API errors → spoken apology
            log.error('Claude request failed: %s', exc)
            await self.broadcast({'type': 'speaking'})
            await asyncio.to_thread(speak_tts, ERROR_SPEECH)
            await self.broadcast({'type': 'idle'})
            return

        # Flush any prose tail with no terminal punctuation, then act on intent.
        tail = prose_region(full)[spoken_len:].strip()
        if tail:
            await speak(tail)

        spoken_text, intent = extract_intent(full)
        log.info('HAL: %r  intent=%s', spoken_text, intent)
        if intent != 'none':
            await self.broadcast({'type': 'command', 'intent': intent})
        await self.broadcast({'type': 'idle'})

    def enqueue_utterance(self, pcm_int16):
        if self._utterance_queue.qsize() >= 2:
            log.debug('dropping utterance — queue full')
            return
        self._utterance_queue.put_nowait(pcm_int16)

    async def capture_loop(self):
        """VAD-gated mic capture: only buffers/transcribes while someone is
        actually talking, so an idle cabin doesn't spin whisper.cpp."""
        input_device = pick_input_device()
        capture_rate, capture_channels = pick_capture_settings(input_device)
        capture_frame_samples = capture_rate * FRAME_MS // 1000
        log.info(
            'mic capture at %d Hz (%d ch) → resample to %d Hz for VAD/whisper',
            capture_rate, capture_channels, SAMPLE_RATE,
        )

        vad = webrtcvad.Vad(VAD_AGGRESSIVENESS)
        frame_queue = asyncio.Queue(maxsize=50)

        def audio_callback(indata, frames, time_info, status):  # noqa: ARG001
            if status:
                log.debug('audio status: %s', status)
            pcm_mono = pcm_to_mono(np.frombuffer(bytes(indata), dtype=np.int16), capture_channels)
            self.note_capture_level(pcm_mono)
            if self.active:
                vad_frame = capture_frame_to_vad(pcm_mono.tobytes(), capture_rate)
                self.loop.call_soon_threadsafe(frame_queue.put_nowait, vad_frame)

        stream = sd.RawInputStream(
            device=input_device,
            samplerate=capture_rate, blocksize=capture_frame_samples, dtype='int16',
            channels=capture_channels, callback=audio_callback,
        )

        voiced_frames = []
        silence_ms = 0
        utterance_ms = 0

        with stream:
            while True:
                frame = await frame_queue.get()
                if not self.active:
                    voiced_frames, silence_ms, utterance_ms = [], 0, 0
                    continue

                is_speech = vad.is_speech(frame, SAMPLE_RATE)
                if is_speech:
                    voiced_frames.append(frame)
                    silence_ms = 0
                    utterance_ms += FRAME_MS
                elif voiced_frames:
                    voiced_frames.append(frame)
                    silence_ms += FRAME_MS
                    utterance_ms += FRAME_MS

                should_finalize = voiced_frames and (
                    silence_ms >= SILENCE_END_MS or utterance_ms >= MAX_UTTERANCE_MS
                )
                if should_finalize:
                    pcm = np.frombuffer(b''.join(voiced_frames), dtype=np.int16)
                    voiced_frames, silence_ms, utterance_ms = [], 0, 0
                    self.enqueue_utterance(pcm)

    async def run(self):
        self.loop = asyncio.get_running_loop()
        # Load weights at startup so a corrupt download fails cleanly, not mid-SEGV.
        await asyncio.to_thread(self.model)
        try:
            await asyncio.to_thread(_TTS.load)
        except Exception as exc:  # noqa: BLE001 - degrade to espeak, don't refuse to start
            log.warning('Piper voice unavailable (%s) — falling back to espeak-ng', exc)
        if not self.llm.available():
            log.warning('ANTHROPIC_API_KEY not set (see ~/.config/hal.env) — HAL cannot answer')
        asyncio.create_task(self.utterance_worker())
        asyncio.create_task(self.level_broadcaster())
        async with websockets.serve(self.handle_client, HOST, PORT):
            log.info('HAL voice sidecar listening on ws://%s:%d', HOST, PORT)
            await self.capture_loop()


def main():
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    sink, origin = resolve_pulse_sink()
    if sink:
        log.info('TTS output: %s (%s)', sink, origin)
    else:
        log.warning('TTS output: no Pulse sink — will use ALSA default')
    server = HalVoiceServer()
    try:
        asyncio.run(server.run())
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    sys.exit(main())
