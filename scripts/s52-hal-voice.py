#!/usr/bin/env python3
"""s52-hal-voice — offline "HAL, switch to CarPlay" voice command sidecar.

Listens on the USB mic for the wake word "HAL" followed by a known command,
using whisper.cpp (via pywhispercpp) for fully offline speech-to-text — no
internet dependency, matching the rest of the kiosk's offline-first stance.
Recognized commands are pushed to the kiosk UI (src/useHalVoice.js) as JSON
frames over a local WebSocket that the existing Hal.jsx / DisplaySwitcher.jsx
already know how to consume:

    {"type": "idle" | "listening" | "speaking", "label": "OPENING CARPLAY"?}
    {"type": "command", "intent": "start_carplay"}    -- recognized command

If "HAL" is heard but the rest of the phrase doesn't match a known command,
this process speaks the refusal line itself (HAL has no reason to bother the
UI with that) — "I'm sorry, Dave. I'm afraid I can't do that." — via
espeak-ng, a stock TTS voice swapped in here as a placeholder until a trained
HAL voice model replaces it (see speak_tts()). Successful commands get a brief
spoken + on-screen ack the same way before the command frame is sent.

The kiosk UI tells us (over the same socket, the other direction) when to
pause: {"type": "set_active", "active": false} while CarPlay is in the
foreground, since the Carlinkit dongle already owns the mic for Siri at that
point and two listeners on one mic would just fight each other. We stay
connected and simply stop capturing/transcribing until told to resume.

Run by systemd as s52-hal-voice.service (see setup.sh). Config is read from
~/.config/s52-hal-voice.env (see scripts/s52-hal-voice.env.example) the same
way s52-carplay-audio.env.example works for the CarPlay receiver.
"""
import asyncio
import collections
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
PHRASE_COALESCE_SEC = 4.0    # merge split utterances ("how?" + "switch to carplay")
# Mic RMS for HAL eye glow — matches useAudioLevel.js attack/release envelope.
LEVEL_ATTACK = float(os.environ.get('S52_HAL_LEVEL_ATTACK', '0.65'))
LEVEL_RELEASE = float(os.environ.get('S52_HAL_LEVEL_RELEASE', '0.11'))
LEVEL_BROADCAST_MS = int(os.environ.get('S52_HAL_LEVEL_MS', '33'))

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

REFUSAL_TEXT = os.environ.get(
    'S52_HAL_REFUSAL_TEXT', "I'm sorry, Dave. I'm afraid I can't do that.",
)
# Spoken line + on-screen label for successful commands (keep both short — car).
ACK_MESSAGES = {
    'start_carplay': (
        os.environ.get('S52_HAL_CARPLAY_ACK_TEXT', 'Opening CarPlay'),
        'OPENING CARPLAY',
    ),
}

# Wake word + command grammar. Extend COMMANDS as more intents land — each
# entry is "all of these keywords must appear after the wake word".
WAKE_WORDS = ('hal', 'h a l', 'hal 9000', 'hal nine thousand')
# tiny.en often hears "HAL" as "how"/"hall" at the start of a phrase.
WAKE_HOMOPHONES_START = ('how', 'hall', 'hell')
# Avoid treating bare "how are you…" as a failed HAL command.
WAKE_HOMOPHONE_HINTS = frozenset({
    'switch', 'car', 'carplay', 'play', 'games', 'clock', 'system', 'exit', 'go',
})
COMMANDS = {
    'start_carplay': (('carplay',), (('car', 'play'),)),
}
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

CONFIGURED_PULSE_SINK = os.environ.get('PULSE_SINK')
PULSE_SOURCE = os.environ.get('PULSE_SOURCE', '').strip()


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


def find_intent(transcript):
    """Returns (intent, matched) for a transcript, or (None, False) if "hal"
    wasn't heard at all -- i.e. this isn't a command attempt worth a refusal."""
    text = normalize_transcript(transcript)
    if not text:
        return None, False

    if not heard_wake_word(text):
        return None, False

    for intent, keyword_sets in COMMANDS.items():
        for keywords in keyword_sets:
            if all(kw in text for kw in keywords):
                return intent, True

    return None, True  # wake word heard, nothing matched -> refusal


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


def pick_capture_rate(device):
    """Open the mic at a rate the hardware actually supports."""
    override = os.environ.get('S52_HAL_CAPTURE_RATE')
    candidates = (int(override),) if override else CAPTURE_RATE_CANDIDATES
    for rate in candidates:
        try:
            sd.check_input_settings(
                device=device, samplerate=rate, channels=1, dtype='int16',
            )
            return rate
        except sd.PortAudioError:
            continue
    raise RuntimeError('no supported mic sample rate (tried %s)' % (candidates,))


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


def speak_tts(text):
    """Stock TTS placeholder — swap the espeak-ng call for a trained HAL
    voice model later without touching the rest of the pipeline."""
    sink, origin = resolve_pulse_sink()
    env = dict(os.environ)
    try:
        tts = subprocess.run(
            ['espeak-ng', '--stdout', '-s', '150', text],
            capture_output=True, check=True,
        )
        if sink:
            play_cmd = ['paplay']
            env['PULSE_SINK'] = sink
            log.info('TTS → %s (%s): %r', sink, origin, text)
        else:
            play_cmd = ['aplay', '-q']
            log.info('TTS → ALSA default (%s): %r', origin, text)
        subprocess.run(play_cmd, input=tts.stdout, env=env, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError, OSError) as exc:
        log.warning('TTS playback failed: %s', exc)


def speak_refusal():
    speak_tts(REFUSAL_TEXT)


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
            await self.broadcast({'type': 'level', 'value': round(self._level_smooth, 4)})

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
        """Merge recent utterances so brief pauses don't split "HAL … carplay"."""
        norm = normalize_transcript(transcript)
        if not norm:
            return '', None, False

        now = time.monotonic()
        self._phrase_chunks = [
            (stamp, text) for stamp, text in self._phrase_chunks
            if now - stamp < PHRASE_COALESCE_SEC
        ]
        self._phrase_chunks.append((now, norm))
        combined = ' '.join(text for _, text in self._phrase_chunks)
        intent, matched = find_intent(combined)
        if intent or matched:
            self._phrase_chunks.clear()
        return combined, intent, matched

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
        combined, intent, matched = self.coalesce_phrase(transcript)
        if not matched:
            # Room noise / non-HAL speech — no UI glow or transcript HUD.
            return

        await self.broadcast({'type': 'listening'})
        await self.broadcast({'type': 'transcript', 'text': combined or transcript})
        if intent:
            log.info('command: %s', intent)
            ack = ACK_MESSAGES.get(intent)
            if ack:
                spoken, label = ack
                await self.broadcast({'type': 'speaking', 'label': label})
                await asyncio.to_thread(speak_tts, spoken)
            await self.broadcast({'type': 'command', 'intent': intent})
            await self.broadcast({'type': 'idle'})
        elif matched:
            await self.broadcast({'type': 'speaking'})
            await asyncio.to_thread(speak_refusal)
            await self.broadcast({'type': 'idle'})
        else:
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
        capture_rate = pick_capture_rate(input_device)
        capture_frame_samples = capture_rate * FRAME_MS // 1000
        log.info('mic capture at %d Hz → resample to %d Hz for VAD/whisper', capture_rate, SAMPLE_RATE)

        vad = webrtcvad.Vad(VAD_AGGRESSIVENESS)
        frame_queue = asyncio.Queue(maxsize=50)

        def audio_callback(indata, frames, time_info, status):  # noqa: ARG001
            if status:
                log.debug('audio status: %s', status)
            pcm = np.frombuffer(bytes(indata), dtype=np.int16)
            self.note_capture_level(pcm)
            if self.active:
                vad_frame = capture_frame_to_vad(bytes(indata), capture_rate)
                self.loop.call_soon_threadsafe(frame_queue.put_nowait, vad_frame)

        stream = sd.RawInputStream(
            device=input_device,
            samplerate=capture_rate, blocksize=capture_frame_samples, dtype='int16',
            channels=1, callback=audio_callback,
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
