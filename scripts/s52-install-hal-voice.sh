#!/usr/bin/env bash
# Install/start the HAL voice sidecar (user venv + user systemd).
# One-time sudo for system packages: python3-dev libportaudio2 espeak-ng
set -euo pipefail

APP_DIR="${APP_DIR:-$HOME/e30piplay}"
VENV_DIR="$HOME/.venvs/s52-hal-voice"
REQ="$APP_DIR/scripts/s52-hal-voice-requirements.txt"
PY="$APP_DIR/scripts/s52-hal-voice.py"

[[ -f "$PY" ]] || { echo "No $PY — not on a HAL voice branch?" >&2; exit 1; }
[[ -f "$REQ" ]] || { echo "Missing $REQ" >&2; exit 1; }

need_apt=0
for pkg in python3-dev libportaudio2 espeak-ng; do
  dpkg -s "$pkg" >/dev/null 2>&1 || need_apt=1
done
if [[ "$need_apt" -eq 1 ]]; then
  echo "Installing system packages (sudo password required)…"
  sudo apt-get install -y python3-dev libportaudio2 portaudio19-dev espeak-ng
fi

python3 -m venv "$VENV_DIR"
"$VENV_DIR/bin/pip" install -q --upgrade pip
"$VENV_DIR/bin/pip" install -r "$REQ"

if [[ ! -f "$HOME/.config/s52-hal-voice.env" ]]; then
  {
    echo "# HAL voice tuning — mic auto-detected at runtime (see s52-hal-voice.py)"
    echo "S52_HAL_VAD_LEVEL=3"
    echo "S52_HAL_WHISPER_MODEL=tiny.en"
  } > "$HOME/.config/s52-hal-voice.env"
fi

mkdir -p "$HOME/.config/systemd/user"
cat > "$HOME/.config/systemd/user/s52-hal-voice.service" <<SERVICE
[Unit]
Description=S52 HAL voice command sidecar (offline STT)
After=pipewire.service wireplumber.service

[Service]
EnvironmentFile=-%h/.config/s52-carplay-audio.env
EnvironmentFile=-%h/.config/s52-hal-voice.env
Environment=XDG_RUNTIME_DIR=/run/user/%U
WorkingDirectory=$APP_DIR
ExecStart=$VENV_DIR/bin/python3 $PY
Restart=on-failure
RestartSec=3

[Install]
WantedBy=default.target
SERVICE

systemctl --user daemon-reload
systemctl --user enable --now s52-hal-voice
echo "HAL voice sidecar running (journalctl --user -u s52-hal-voice -f)"
