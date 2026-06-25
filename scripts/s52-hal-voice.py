#!/usr/bin/env python3
"""s52-hal-voice — offline "HAL, switch to CarPlay" voice command sidecar.

Listens on the USB mic for the wake word "HAL" followed by a known command,
using whisper.cpp (via pywhispercpp) for fully offline speech-to-text — no
internet dependency, matching the rest of the kiosk's offline-first stance.
Recognized commands are pushed to the kiosk UI (src/useHalVoice.js) as JSON
frames over a local WebSocket that the existing Hal.jsx / DisplaySwitcher.jsx
already know how to consume:

    {"type": "idle" | "listening" | "speaking"}      -- HAL's eye state
    {"type": "command", "intent": "start_carplay"}    -- recognized command

If "HAL" is heard but the rest of the phrase doesn't match a known command,
this process speaks the refusal line itself (HAL has no reason to bother the
UI with that) — "I'm sorry, Dave. I'm afraid I can't do that." — via
espeak-ng, a stock TTS voice swapped in here as a placeholder until a trained
HAL voice model replaces it (see speak_refusal()).

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
VAD_AGGRESSIVENESS = int(os.environ.get('S52_HAL_VAD_LEVEL', '2'))  # 0-3, higher = stricter
SILENCE_END_MS = 700         # trailing silence that closes an utterance
MAX_UTTERANCE_MS = 8000      # safety cap so a stuck-open mic can't buffer forever

WHISPER_MODEL = os.environ.get('S52_HAL_WHISPER_MODEL', 'base.en')

REFUSAL_TEXT = os.environ.get(
    'S52_HAL_REFUSAL_TEXT', "I'm sorry, Dave. I'm afraid I can't do that.",
)
PULSE_SINK = os.environ.get('PULSE_SINK')  # optional, matches s52-carplay-audio.env.example

# Wake word + command grammar. Extend COMMANDS as more intents land — each
# entry is "all of these keywords must appear after the wake word".
WAKE_WORDS = ('hal', 'h a l', 'hal 9000', 'hal nine thousand')
COMMANDS = {
    'start_carplay': (('carplay',),),
}


def find_intent(transcript):
    """Returns (intent, matched) for a transcript, or (None, False) if "hal"
    wasn't heard at all -- i.e. this isn't a command attempt worth a refusal."""
    text = re.sub(r'[^a-z0-9\s]', ' ', transcript.lower())
    text = re.sub(r'\s+', ' ', text).strip()

    heard_wake_word = any(w in text for w in WAKE_WORDS)
    if not heard_wake_word:
        return None, False

    for intent, keyword_sets in COMMANDS.items():
        for keywords in keyword_sets:
            if all(kw in text for kw in keywords):
                return intent, True

    return None, True  # wake word heard, nothing matched -> refusal


def speak_refusal():
    """Stock TTS placeholder -- swap the espeak-ng call for a trained HAL
    voice model later without touching the rest of the pipeline."""
    env = dict(os.environ)
    try:
        tts = subprocess.run(
            ['espeak-ng', '--stdout', '-s', '150', REFUSAL_TEXT],
            capture_output=True, check=True,
        )
        play_cmd = ['paplay'] if PULSE_SINK else ['aplay', '-q']
        if PULSE_SINK:
            env['PULSE_SINK'] = PULSE_SINK
        subprocess.run(play_cmd, input=tts.stdout, env=env, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError, OSError) as exc:
        log.warning('refusal playback failed: %s', exc)


class HalVoiceServer:
    def __init__(self):
        self.clients = set()
        self.active = True
        self.loop = None
        self._model = None

    def model(self):
        if self._model is None:
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

    async def on_utterance(self, pcm_int16):
        await self.broadcast({'type': 'listening'})
        transcript = await asyncio.to_thread(self.transcribe, pcm_int16)
        if not transcript:
            await self.broadcast({'type': 'idle'})
            return

        log.info('heard: %r', transcript)
        intent, matched = find_intent(transcript)
        if intent:
            await self.broadcast({'type': 'command', 'intent': intent})
            await self.broadcast({'type': 'idle'})
        elif matched:
            await self.broadcast({'type': 'speaking'})
            await asyncio.to_thread(speak_refusal)
            await self.broadcast({'type': 'idle'})
        else:
            await self.broadcast({'type': 'idle'})

    async def capture_loop(self):
        """VAD-gated mic capture: only buffers/transcribes while someone is
        actually talking, so an idle cabin doesn't spin whisper.cpp."""
        vad = webrtcvad.Vad(VAD_AGGRESSIVENESS)
        frame_queue = asyncio.Queue(maxsize=50)

        def audio_callback(indata, frames, time_info, status):  # noqa: ARG001
            if status:
                log.debug('audio status: %s', status)
            if self.active:
                self.loop.call_soon_threadsafe(frame_queue.put_nowait, bytes(indata))

        stream = sd.RawInputStream(
            samplerate=SAMPLE_RATE, blocksize=FRAME_SAMPLES, dtype='int16',
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
                    asyncio.create_task(self.on_utterance(pcm))

    async def run(self):
        self.loop = asyncio.get_running_loop()
        async with websockets.serve(self.handle_client, HOST, PORT):
            log.info('HAL voice sidecar listening on ws://%s:%d', HOST, PORT)
            await self.capture_loop()


def main():
    logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
    server = HalVoiceServer()
    try:
        asyncio.run(server.run())
    except KeyboardInterrupt:
        pass


if __name__ == '__main__':
    sys.exit(main())
