#!/bin/bash
# One-shot setup: persistent journald + per-boot power marker + revert POWER_OFF_ON_HALT.
# Intended to be run as root on the Pi. Safe to re-run (idempotent).
set -euo pipefail

echo "=== 1. Enable persistent journald ==="
mkdir -p /etc/systemd/journald.conf.d
cat > /etc/systemd/journald.conf.d/99-s52-persistent.conf <<'EOF'
[Journal]
Storage=persistent
SystemMaxUse=200M
EOF
mkdir -p /var/log/journal
systemd-tmpfiles --create --prefix /var/log/journal || true
systemctl restart systemd-journald
journalctl --flush || true
echo "journald now persistent; boots tracked across power cycles."

echo "=== 2. Per-boot power marker ==="
cat > /usr/local/bin/s52-bootmarker.sh <<'EOF'
#!/bin/bash
# Logged once per boot so each power-on leaves an explicit, greppable anchor
# capturing the PMIC undervoltage/throttle flags as seen right after boot.
logger -t s52-boot "=== S52 BOOT MARKER === $(vcgencmd get_throttled 2>/dev/null) measure_$(vcgencmd measure_volts 2>/dev/null) $(vcgencmd pmic_read_adc EXT5V_V 2>/dev/null | tr -s ' ') uptime=$(uptime)"
EOF
chmod +x /usr/local/bin/s52-bootmarker.sh

cat > /etc/systemd/system/s52-bootmarker.service <<'EOF'
[Unit]
Description=S52 per-boot power/undervoltage marker
After=multi-user.target
[Service]
Type=oneshot
ExecStart=/usr/local/bin/s52-bootmarker.sh
[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable s52-bootmarker.service
systemctl start s52-bootmarker.service
echo "boot marker installed; grep with: journalctl -t s52-boot"

echo "=== 3. Revert POWER_OFF_ON_HALT in EEPROM ==="
if rpi-eeprom-config | grep -q '^POWER_OFF_ON_HALT='; then
  rpi-eeprom-config | grep -v '^POWER_OFF_ON_HALT=' > /tmp/eeprom-new.txt
  rpi-eeprom-config --apply /tmp/eeprom-new.txt
  echo "POWER_OFF_ON_HALT removed; staged for next reboot."
else
  echo "POWER_OFF_ON_HALT already absent; nothing to do."
fi

echo "=== ALL DONE ==="
