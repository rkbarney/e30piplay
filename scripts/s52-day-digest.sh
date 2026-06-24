#!/usr/bin/env bash
# Summarize every boot on a given day for drive review.
# Usage: s52-day-digest.sh [YYYY-MM-DD]   (default: today)
set -u

TARGET_DATE="${1:-$(date +%F)}"

echo "SESSION DIGEST — ${TARGET_DATE}"
echo

tot_disc=0 tot_send=0 tot_stall=0 tot_up=0

for b in $(seq -10 0); do
  line=$(journalctl --list-boots --no-pager | awk -v b="$b" '{gsub(/^ +/,"",$1); if($1==b) {print; exit}}')
  [[ -z "$line" ]] && continue
  [[ "$line" != *"${TARGET_DATE}"* ]] && continue

  app=$(journalctl -b "$b" -t s52-carplay-app --no-pager 2>/dev/null || true)
  drive=$(journalctl -b "$b" -t s52-drive --no-pager 2>/dev/null || true)
  kern=$(journalctl -b "$b" --no-pager 2>/dev/null || true)

  if echo "$app" | grep -q GstVideo; then recv=LIVI
  elif echo "$app" | grep -q "GPU stall"; then recv=react-carplay
  else recv=unknown/bench; fi

  up=$(echo "$drive" | grep -c "dongle=up" || true)
  disc=$(echo "$kern" | grep -c "1-2: USB disconnect" || true)
  send=$(echo "$app" | grep -ci "Send error" || true)
  stall=$(echo "$app" | grep -c "GPU stall" || true)
  xrun=$(echo "$kern" | grep -ciE "xrun|underrun" || true)

  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "BOOT $b"
  echo "  $line"
  echo "  receiver: $recv"
  echo "  in-car: ${up} samples (~$((up * 5 / 60)) min) | USB disconnects: ${disc}"
  echo "  LIVI Send errors: ${send} | GPU stalls: ${stall} | xruns: ${xrun}"

  if [[ "$up" -gt 0 ]]; then
    echo "$drive" | grep dongle=up | head -1 | awk '{print "  first in-car:", $1,$2,$3}'
    echo "$drive" | grep dongle=up | tail -1 | awk '{print "  last in-car: ", $1,$2,$3}'
    tmin=$(echo "$drive" | grep dongle=up | grep -o 'temp=[0-9.]*' | sort -t= -k2 -n | head -1)
    tmax=$(echo "$drive" | grep dongle=up | grep -o 'temp=[0-9.]*' | sort -t= -k2 -n | tail -1)
    echo "  temp: ${tmin#temp=} → ${tmax#temp=}°C"
  fi

  if [[ "$disc" -gt 0 ]]; then
    echo "$kern" | grep "1-2: USB disconnect" | awk '{print "  disconnect:", $1,$2,$3}'
  fi

  tot_disc=$((tot_disc + disc))
  tot_send=$((tot_send + send))
  tot_stall=$((tot_stall + stall))
  tot_up=$((tot_up + up))
done

echo
echo "DAY TOTALS (${TARGET_DATE}): ~$((tot_up * 5 / 60)) min in-car | ${tot_disc} USB disconnects | ${tot_send} LIVI errors | ${tot_stall} GPU stalls"
