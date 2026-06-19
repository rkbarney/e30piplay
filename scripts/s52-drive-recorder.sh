#!/bin/bash
# s52-drive-recorder.sh — make the "flight recorder" permanent & boot-managed.
#
# Run ONCE as root on the Pi. Idempotent / safe to re-run. It:
#   1. installs the sampler + report helper into /usr/local/bin
#   2. installs a systemd service that runs the sampler on every boot (Restart=always),
#      so the recorder runs unattended while driving and survives power cycles
#   3. removes the no-sudo cron @reboot launcher if present (systemd becomes the single
#      owner; the sampler's flock would otherwise just keep one instance anyway)
#
# Companion pieces (already deployed to ~/.local/bin by the agent, no sudo needed):
#   * s52-drive-sampler.sh  — the periodic heartbeat logger (tag: s52-drive)
#   * s52-drive-report.sh   — post-drive review (run as admin, no sudo)
#
# Persistent journald + the per-boot s52-boot marker are installed by
# scripts/s52-logging-setup.sh — run that first if it hasn't been.
set -euo pipefail

SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
ADMIN_HOME=/home/admin

echo "=== 1. Install sampler + report into /usr/local/bin ==="
install -m 0755 "${SRC_DIR}/s52-drive-sampler.sh" /usr/local/bin/s52-drive-sampler.sh
install -m 0755 "${SRC_DIR}/s52-drive-report.sh"  /usr/local/bin/s52-drive-report.sh
echo "installed: /usr/local/bin/s52-drive-sampler.sh, /usr/local/bin/s52-drive-report.sh"

echo "=== 2. Systemd service (runs the recorder every boot) ==="
cat > /etc/systemd/system/s52-drive-recorder.service <<'EOF'
[Unit]
Description=S52 drive "flight recorder" — periodic power/USB/audio heartbeat to journald
After=multi-user.target

[Service]
Type=simple
# Run as the kiosk user so pactl can read the PipeWire default sink.
User=admin
Environment=XDG_RUNTIME_DIR=/run/user/1000
Environment=S52_DRIVE_INTERVAL=5
ExecStart=/usr/local/bin/s52-drive-sampler.sh
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable s52-drive-recorder.service
systemctl restart s52-drive-recorder.service
echo "service enabled + started; review with: journalctl -t s52-drive"

echo "=== 3. Drop the no-sudo cron @reboot launcher (systemd now owns it) ==="
if crontab -u admin -l 2>/dev/null | grep -q 's52-drive-sampler.sh'; then
  crontab -u admin -l 2>/dev/null | grep -v 's52-drive-sampler.sh' | crontab -u admin -
  echo "removed cron @reboot launcher from admin's crontab."
else
  echo "no cron launcher to remove."
fi

echo "=== DONE ==="
echo "After a drive, run (no sudo):  ~/.local/bin/s52-drive-report.sh"
