#!/bin/bash
# s52-drive-report.sh — post-drive review for the S52 head unit "flight recorder".
#
# Run this AFTER a drive, once the Pi is back in WiFi range. It mines the
# (already-persistent) system + user journals and prints one timestamped timeline
# that correlates the audio stutter with its candidate causes:
#   * Carlinkit dongle (1314:1520, port 1-2) disconnect / re-enumeration
#   * USB resets / errors / xhci / over-current
#   * power: under-voltage & throttle (kernel events + latched get_throttled samples)
#   * PipeWire/WirePlumber xruns / underruns / suspend (USB DAC dropouts)
#   * the s52-drive heartbeat (power/temp/sink/load trend)
#
# No sudo required: 'admin' is in the 'adm' group and can read the journal.
#
# Usage:
#   s52-drive-report.sh                 # last 3 hours (default)
#   s52-drive-report.sh --since "2 hours ago"
#   s52-drive-report.sh --since "2026-06-19 14:00:00"
#   s52-drive-report.sh --boot          # current boot only
#
# Tip: from the Mac you can run it remotely and save a copy:
#   ssh s52 '~/.local/bin/s52-drive-report.sh' | tee ~/s52-drive-$(date +%F-%H%M).txt
set -u
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/1000}"

SINCE="3 hours ago"
SEL=(--since "$SINCE")
USEL=(--since "$SINCE")
case "${1:-}" in
  --since) SINCE="${2:-3 hours ago}"; SEL=(--since "$SINCE"); USEL=(--since "$SINCE") ;;
  --boot)  SINCE="(this boot)";        SEL=(-b 0);             USEL=(-b 0) ;;
esac

DONGLE_RE='1-2: (USB disconnect|new high-speed|New USB device found|device descriptor|device not accepting|reset high-speed|unable to enumerate)'
USBERR_RE='error -[0-9]|over-current|cannot enable|device not accepting|descriptor read|reset high-speed|xhci_hcd.*(WARN|ERROR|halt|abort)|unable to enumerate'
PWR_RE='throttl|under.?volt|voltage|hwmon.*curr|low voltage'
AUDIO_RE='xrun|under.?run|over.?run|suspend|node.*timeout|too slow|error'

hr() { printf '\n========== %s ==========\n' "$1"; }

echo "S52 DRIVE REPORT — window: ${SINCE}    generated: $(date '+%F %T %Z')"
echo "host: $(uname -n)   kernel: $(uname -r)   uptime:$(uptime | sed 's/.*up//; s/,.*load/  load/')"

hr "BOOTS in window (did the Pi power-cycle while driving?)"
journalctl --list-boots --no-pager 2>/dev/null | tail -12

hr "PER-BOOT POWER MARKER (s52-boot)"
journalctl -t s52-boot --no-pager "${SEL[@]}" 2>/dev/null | tail -20
echo "(throttled should read 0x0; any other value = under-voltage/throttle occurred)"

hr "POWER / UNDER-VOLTAGE kernel events"
pwr=$(journalctl -k --no-pager "${SEL[@]}" 2>/dev/null | grep -iE "$PWR_RE")
if [ -n "$pwr" ]; then echo "$pwr" | tail -40; else echo "none — no kernel under-voltage/throttle messages in window."; fi

hr "FLIGHT-RECORDER heartbeat: NON-CLEAN power samples (latched get_throttled != 0x0)"
bad=$(journalctl -t s52-drive --no-pager "${SEL[@]}" 2>/dev/null | grep -E 'throttled=' | grep -vE 'throttled=0x0( |$)')
if [ -n "$bad" ]; then echo "$bad" | tail -40; else echo "none — every heartbeat showed throttled=0x0 (clean 5V)."; fi

hr "CARLINKIT DONGLE (1314:1520, port 1-2) — re-enumeration timeline"
disc=$(journalctl -k --no-pager "${SEL[@]}" 2>/dev/null | grep -cE '1-2: USB disconnect')
enum=$(journalctl -k --no-pager "${SEL[@]}" 2>/dev/null | grep -cE '1-2: new high-speed')
echo "disconnects=${disc}   re-enumerations=${enum}   (each = a CarPlay audio/video cutout)"
echo "-- first/last few events --"
journalctl -k --no-pager "${SEL[@]}" 2>/dev/null | grep -E "$DONGLE_RE" | grep -E 'disconnect|new high-speed' | sed -n '1,6p'
echo "   ..."
journalctl -k --no-pager "${SEL[@]}" 2>/dev/null | grep -E "$DONGLE_RE" | grep -E 'disconnect|new high-speed' | tail -6

hr "DONGLE reset cadence (gap in seconds between disconnects — flat ~13s = firmware reboot loop)"
journalctl -k --no-pager "${SEL[@]}" -o short-unix 2>/dev/null \
  | grep -E '1-2: USB disconnect' | awk '{print int($1)}' \
  | awk 'NR>1{print $1-p} {p=$1}' | sort -n | uniq -c | sort -rn | head -10 \
  | awk '{printf "   %5d events spaced %ss apart\n", $1, $2}'
echo "   (a few distinct large gaps + bursts = intermittent/while-driving; one flat value = constant reboot loop)"

hr "USB errors / resets / xhci (loose-connection / power signature)"
usberr=$(journalctl -k --no-pager "${SEL[@]}" 2>/dev/null | grep -iE "$USBERR_RE")
if [ -n "$usberr" ]; then echo "$usberr" | tail -40; else echo "none — clean disconnect/reconnect, no bus errors (points at dongle firmware, not cable/power)."; fi

hr "AUDIO: PipeWire / WirePlumber xruns / underruns / suspend (USB DAC dropouts)"
au=$(journalctl --user -u pipewire -u pipewire-pulse -u wireplumber --no-pager "${USEL[@]}" 2>/dev/null | grep -iE "$AUDIO_RE")
if [ -n "$au" ]; then echo "$au" | tail -40; else echo "none — no PipeWire xruns/underruns/suspend in window (buffering/quantum not the cause)."; fi

hr "AUDIO: USB DAC (C-Media) presence per heartbeat"
journalctl -t s52-drive --no-pager "${SEL[@]}" 2>/dev/null | grep -oE 'dac=(up|absent)' | sort | uniq -c \
  | awk '{printf "   %s : %d samples\n", $2, $1}'
echo "(in the car the DAC should be 'up' the whole time; any 'absent' bursts = DAC dropped off USB)"

hr "HEARTBEAT sample (first + last, for the timeline)"
journalctl -t s52-drive --no-pager "${SEL[@]}" 2>/dev/null | grep -E 'RECORDER|hb ' | sed -n '1,3p'
echo "   ..."
journalctl -t s52-drive --no-pager "${SEL[@]}" 2>/dev/null | grep -E 'RECORDER|hb ' | tail -3

hr "SUMMARY"
echo "dongle re-enumerations : ${enum}"
echo "USB bus errors         : $( [ -n "$usberr" ] && echo "$usberr" | grep -c . || echo 0)"
echo "under-voltage events   : $( [ -n "$pwr" ] && echo "$pwr" | grep -c . || echo 0)"
echo "non-clean power samples: $( [ -n "$bad" ] && echo "$bad" | grep -c . || echo 0)"
echo "pipewire audio events  : $( [ -n "$au" ] && echo "$au" | grep -c . || echo 0)"
echo
echo "Reading: many dongle re-enumerations + zero USB errors + zero power/audio events"
echo "=> the Carlinkit dongle is rebooting itself (source-side); fix is firmware/replace,"
echo "   not the AUX/DAC output and not Bluetooth. Spaced/bursty resets that line up with"
echo "   driving (vs a flat idle cadence) would instead implicate vibration/power."
