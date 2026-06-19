#!/bin/sh
# s52-drive-sampler.sh — "flight recorder" sampler for the S52 CarPlay head unit.
#
# Logs a timestamped heartbeat to journald (tag: s52-drive) every INTERVAL seconds
# so a drive can later be correlated with audio stutter. Everything goes to the
# persistent system journal, so it survives reboots/power cycles and is reviewed
# afterwards with scripts/s52-drive-report.sh.
#
# What each heartbeat captures (the candidate stutter causes from the diagnosis):
#   * power/throttle  — vcgencmd get_throttled (its upper "has-occurred" bits LATCH,
#                       so even a brief under-voltage sag while driving is caught on
#                       the next sample), EXT5V rail voltage, core voltage, temp.
#   * dongle presence — whether the Carlinkit "Auto Box" (1314:1520) is currently
#                       enumerated (the precise reset timeline still comes from the
#                       kernel log; this is coarse context).
#   * audio sink      — the PipeWire default sink + whether the C-Media USB DAC is
#                       present (matters in the car where the real DAC + phone exist).
#   * load            — CPU load average (llvmpipe spikes can starve the audio thread).
#
# Single-instance via flock so the cron @reboot launcher and the systemd service
# (sudo installer) can't double-run it. Launched either by:
#   * cron @reboot (no sudo) — see how it's wired in s52-drive-report.sh header, or
#   * /etc/systemd/system/s52-drive-recorder.service (scripts/s52-drive-recorder.sh).
set -u
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
export PATH

INTERVAL="${S52_DRIVE_INTERVAL:-5}"
TAG="s52-drive"
LOCK="/tmp/s52-drive-sampler.lock"
DONGLE="1314:1520"
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/1000}"

# Single instance: bail quietly if another sampler already holds the lock.
exec 9>"$LOCK" 2>/dev/null || true
if command -v flock >/dev/null 2>&1; then
  flock -n 9 || { echo "s52-drive-sampler: already running, exiting" >&2; exit 0; }
fi

log() { logger -t "$TAG" -- "$*"; }

log "RECORDER START pid=$$ interval=${INTERVAL}s kernel=$(uname -r)"
trap 'log "RECORDER STOP pid=$$"' INT TERM

while :; do
  throt=$(vcgencmd get_throttled 2>/dev/null);  throt=${throt#throttled=}
  ext5v=$(vcgencmd pmic_read_adc EXT5V_V 2>/dev/null | tr -s ' ' | sed 's/^ //')
  vcore=$(vcgencmd measure_volts 2>/dev/null);  vcore=${vcore#volt=}
  temp=$(vcgencmd measure_temp 2>/dev/null);     temp=${temp#temp=}

  if lsusb -d "$DONGLE" >/dev/null 2>&1; then dongle=up; else dongle=DOWN; fi
  if lsusb 2>/dev/null | grep -qi "C-Media"; then dac=up; else dac=absent; fi

  sink=$(timeout 2 pactl get-default-sink 2>/dev/null)
  [ -n "$sink" ] || sink="?"

  load=$(cut -d' ' -f1-3 /proc/loadavg 2>/dev/null)

  log "hb throttled=${throt:-?} ext5v=${ext5v:-?} vcore=${vcore:-?} temp=${temp:-?} dongle=${dongle} dac=${dac} sink=${sink} load=${load:-?}"
  sleep "$INTERVAL"
done
