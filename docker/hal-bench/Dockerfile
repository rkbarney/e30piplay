# Headless HAL voice bench — Whisper STT → Claude Haiku → Piper voice → intent,
# with no mic and no speakers. Lets you validate the pipeline (and that the
# pywhispercpp / piper-tts install actually works) on a laptop before the Pi.
#
#   mkdir -p out
#   docker compose run --rm hal-bench --say "HAL, switch to CarPlay"
#   afplay out/reply.wav      # listen to HAL on the Mac
#
# Needs ANTHROPIC_API_KEY — supplied via the ~/.config/hal.env bind mount in
# docker-compose.yml (the sidecar code loads it automatically).
FROM python:3.11-bookworm

# build-essential + cmake: pywhispercpp compiles whisper.cpp from source.
# libportaudio2: sounddevice dlopens it at import (even though we don't capture).
# espeak-ng + libespeak-ng-dev: Piper phonemization / espeak fallback.
RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential cmake pkg-config curl ca-certificates \
      libportaudio2 espeak-ng libespeak-ng-dev \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY scripts/s52-hal-voice-requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY scripts/s52-hal-voice.py scripts/hal-bench.py ./scripts/
# Default car persona so HAL has context in the bench; real secrets come from
# the mounted ~/.config/hal.env at runtime, never baked into the image.
COPY scripts/hal-context.yaml.example /root/.config/hal-context.yaml

# Write the reply WAV into the mounted /out by default (see compose).
ENV HAL_BENCH_OUT=/out/reply.wav

ENTRYPOINT ["python", "scripts/hal-bench.py"]
