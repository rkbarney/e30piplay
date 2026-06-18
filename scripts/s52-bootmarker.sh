#!/bin/bash
# Logged once per boot so each power-on leaves an explicit, greppable anchor
# capturing the PMIC undervoltage/throttle flags as seen right after boot.
logger -t s52-boot "=== S52 BOOT MARKER === $(vcgencmd get_throttled 2>/dev/null) measure_$(vcgencmd measure_volts 2>/dev/null) $(vcgencmd pmic_read_adc EXT5V_V 2>/dev/null | tr -s ' ') uptime=$(uptime)"
