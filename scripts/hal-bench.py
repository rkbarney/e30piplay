#!/usr/bin/env python3
"""Headless HAL bench — exercise the whole brain+voice pipeline with NO mic and
NO speakers, so you can validate it on a laptop (or in Docker) before trusting
the Pi's audio hardware.

It reuses the real sidecar code (scripts/s52-hal-voice.py): your phrase →
Claude Haiku (streamed) → parsed screen-switch intent → HAL 9000 voice rendered
to a WAV file you can play back however you like.

    # fastest check — just the brain (only needs ANTHROPIC_API_KEY, no models):
    python scripts/hal-bench.py --no-voice --say "HAL, switch to CarPlay"

    # full pipeline — also downloads + runs the Piper voice, writes reply.wav:
    python scripts/hal-bench.py --say "HAL, play me something" --out reply.wav

    # also test Whisper STT from a recording (16-bit WAV; resampled to 16 kHz):
    python scripts/hal-bench.py --wav clip.wav

Reads ANTHROPIC_API_KEY (and optional ~/.config/hal-context.yaml) the same way
the sidecar does. See docker/hal-bench/Dockerfile for the containerized run.
"""
import argparse
import asyncio
import importlib.util
import os
import sys

_HERE = os.path.dirname(os.path.abspath(__file__))
_SPEC = importlib.util.spec_from_file_location(
    'hal_voice', os.path.join(_HERE, 's52-hal-voice.py'),
)
hal = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(hal)


def load_wav_pcm16_16k(path):
    """Load a 16-bit WAV → mono int16 at 16 kHz (what whisper.cpp wants)."""
    import wave
    import numpy as np
    with wave.open(path, 'rb') as wav_file:
        rate = wav_file.getframerate()
        channels = wav_file.getnchannels()
        width = wav_file.getsampwidth()
        frames = wav_file.readframes(wav_file.getnframes())
    if width != 2:
        raise SystemExit(f'{path}: need a 16-bit PCM WAV (got {width * 8}-bit)')
    pcm = np.frombuffer(frames, dtype=np.int16)
    if channels > 1:
        pcm = pcm.reshape(-1, channels).mean(axis=1).astype(np.int16)
    if rate != hal.SAMPLE_RATE and pcm.size:
        count = int(len(pcm) * hal.SAMPLE_RATE / rate)
        pcm = np.interp(
            np.linspace(0, len(pcm) - 1, num=count),
            np.arange(len(pcm)),
            pcm.astype(np.float64),
        ).astype(np.int16)
    return pcm


def heard_text(args):
    if args.wav:
        pcm = load_wav_pcm16_16k(args.wav)
        server = hal.HalVoiceServer()  # only used for its whisper model + transcribe
        text = server.transcribe(pcm)
        if not text:
            raise SystemExit(f'{args.wav}: whisper heard nothing')
        return text
    return args.say


async def run(args):
    if not os.environ.get('ANTHROPIC_API_KEY'):
        print(
            'ERROR: ANTHROPIC_API_KEY not set. Put it in ~/.config/hal.env '
            '(ANTHROPIC_API_KEY=sk-ant-...) or pass it to the container with '
            '-e ANTHROPIC_API_KEY=...',
            file=sys.stderr,
        )
        return 2

    if args.wav and not os.path.isfile(args.wav):
        raise SystemExit(f'{args.wav}: no such file')

    # 1. What did HAL "hear" — typed phrase, or Whisper on a recording.
    print('… transcribing' if args.wav else '… using typed phrase', file=sys.stderr)
    heard = await asyncio.to_thread(heard_text, args)
    command = hal.strip_wake_word(hal.normalize_transcript(heard)) or heard
    print(f'\nheard:   {heard!r}')
    print(f'command: {command!r}\n')

    # Canned (Easter-egg) line wins before the cloud — exact wording, instant.
    canned = hal.match_canned(command, hal.load_context().get('canned') or [])
    if canned:
        line, intent = canned
        print(f'HAL says (canned): {line!r}')
        print(f'intent:       {intent}')
        if not args.no_voice and line:
            await asyncio.to_thread(hal._TTS.load)
            await asyncio.to_thread(hal._TTS.render_wav, line, args.out)
            print(f'\nwrote {args.out}  →  play it with:  afplay {args.out}')
        return 0

    # 2. Load the Piper voice up front (unless we're skipping audio).
    if not args.no_voice:
        print('… loading HAL Piper voice (first run downloads ~60 MB)', file=sys.stderr)
        await asyncio.to_thread(hal._TTS.load)

    # 3. Stream the reply from Claude — print deltas live so you see it arrive.
    llm = hal.HalLLM()
    system = hal.build_system_prompt(hal.load_context(), carplay_active=args.carplay_active)
    print('HAL (raw stream): ', end='', flush=True)
    full = ''
    try:
        async with llm.stream(system, command) as stream:
            async for delta in stream.text_stream:
                full += delta
                sys.stdout.write(delta)
                sys.stdout.flush()
    except Exception as exc:  # noqa: BLE001 - surface API/network errors plainly
        print(f'\n\nERROR talking to Claude: {exc}', file=sys.stderr)
        return 1
    print('\n')

    # 4. Split the spoken words from the intent JSON.
    spoken, intent = hal.extract_intent(full)
    print(f'HAL says:     {spoken!r}')
    print(f'intent:       {intent}')
    if intent != 'none':
        print(f'command frame: {{"type": "command", "intent": "{intent}"}}')
    else:
        print('command frame: (none — spoken reply only, no screen change)')

    # 5. Render the voice to a WAV you can play back (afplay/VLC/etc.).
    if not args.no_voice and spoken:
        await asyncio.to_thread(hal._TTS.render_wav, spoken, args.out)
        print(f'\nwrote {args.out}  →  play it with:  afplay {args.out}')
    return 0


async def chat(args):
    """Interactive REPL — type phrases, HAL replies (text + intent). No audio:
    Docker can't reach the Mac's speakers live, so this is the brain only. Use
    --say for an audio render of a single phrase."""
    if not os.environ.get('ANTHROPIC_API_KEY'):
        print('ERROR: ANTHROPIC_API_KEY not set (see ~/.config/hal.env).', file=sys.stderr)
        return 2
    llm = hal.HalLLM()
    context = hal.load_context()
    print("HAL 9000 online. Type a request, or 'quit' to exit.")
    print("(chat is text-only — run with --say \"...\" to hear the voice.)\n")
    while True:
        try:
            line = await asyncio.to_thread(input, 'you> ')
        except (EOFError, KeyboardInterrupt):
            print()
            break
        line = line.strip()
        if not line:
            continue
        if line.lower() in ('quit', 'exit', 'q'):
            break
        command = hal.strip_wake_word(hal.normalize_transcript(line)) or line
        canned = hal.match_canned(command, context.get('canned') or [])
        if canned:
            cline, cintent = canned
            print(f'HAL> {cline}')
            if cintent != 'none':
                print(f'     ↳ would send intent: {cintent}')
            print()
            continue
        system = hal.build_system_prompt(context, carplay_active=args.carplay_active)
        full = ''
        try:
            async with llm.stream(system, command) as stream:
                async for delta in stream.text_stream:
                    full += delta
        except Exception as exc:  # noqa: BLE001 - keep the REPL alive on a hiccup
            print(f'HAL> [error talking to Claude: {exc}]\n')
            continue
        spoken, intent = hal.extract_intent(full)
        print(f'HAL> {spoken}')
        if intent != 'none':
            print(f'     ↳ would send intent: {intent}')
        print()
    print('HAL: Goodbye, Dave.')
    return 0


def main():
    parser = argparse.ArgumentParser(description='Headless HAL voice pipeline bench (no mic/speakers).')
    src = parser.add_mutually_exclusive_group()
    src.add_argument('--say', metavar='TEXT', help='phrase to feed HAL (skips mic + Whisper)')
    src.add_argument('--wav', metavar='PATH', help='recorded clip to transcribe with Whisper first')
    parser.add_argument('--chat', action='store_true',
                        help='interactive REPL — type phrases, HAL replies (text + intent, no audio)')
    parser.add_argument(
        '--out', metavar='PATH',
        default=os.environ.get('HAL_BENCH_OUT', 'reply.wav'),
        help="where to write HAL's spoken reply (default: reply.wav)",
    )
    parser.add_argument('--no-voice', action='store_true',
                        help='skip Piper TTS — only test Claude + intent (fast, no models)')
    parser.add_argument('--carplay-active', action='store_true',
                        help='tell HAL CarPlay is currently on screen (runtime state)')
    args = parser.parse_args()
    if args.chat:
        return asyncio.run(chat(args))
    if not (args.say or args.wav):
        parser.error('one of --say, --wav, or --chat is required')
    return asyncio.run(run(args))


if __name__ == '__main__':
    sys.exit(main())
