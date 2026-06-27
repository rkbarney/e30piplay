#!/usr/bin/env bash
# Tweak the *stock* navit.xml (installed by the `navit` apt package) for the
# 480x640 portrait panel, instead of hand-authoring a full layout/style file
# from scratch — Navit's default car layout/style is thousands of lines and
# easy to get subtly wrong by rewriting it. We only touch:
#   - <graphics> window size -> 480x640 (matches the panel 1:1, same idea as
#     the fixed react-carplay window sizing)
#   - add a "Demo" vehicle (source="demo://", synthetic GPS) so the screen
#     shows movement before a real position feed (GPS / phone geolocation
#     handoff) is wired up
#
# NOT yet done by this script (next steps once Navit is confirmed running):
#   - drop a maptool-built .bin OSM extract at ~/.navit/maps/ and add a
#     <mapset><map type="binfile" data="..."/></mapset> entry
#   - replace the Demo vehicle with a real position source
#
# Re-run after `apt upgrade navit` to fold stock changes back in — this
# OVERWRITES ~/.navit/navit.xml from the system default every time, so any
# manual edits (map paths, vehicle source) belong in a copy, not here.
set -euo pipefail

STOCK=""
for candidate in /etc/navit/navit.xml /usr/share/navit/navit.xml; do
  if [[ -f "$candidate" ]]; then
    STOCK="$candidate"
    break
  fi
done
if [[ -z "$STOCK" ]]; then
  echo "ERROR: stock navit.xml not found under /etc/navit or /usr/share/navit." >&2
  echo "       Is the navit apt package installed?" >&2
  exit 1
fi

DST="${HOME}/.navit/navit.xml"
mkdir -p "${HOME}/.navit/maps"
cp "$STOCK" "$DST"

python3 - "$DST" <<'PY'
import re
import sys

path = sys.argv[1]
xml = open(path, encoding='utf-8').read()


def set_attr(tag_pattern, attr, value, xml):
    m = re.search(tag_pattern, xml)
    if not m:
        return xml
    tag = m.group(0)
    if re.search(rf'\b{attr}="[^"]*"', tag):
        new_tag = re.sub(rf'{attr}="[^"]*"', f'{attr}="{value}"', tag)
    elif tag.endswith('/>'):
        new_tag = tag[:-2] + f' {attr}="{value}"/>'
    else:
        new_tag = tag[:-1] + f' {attr}="{value}">'
    return xml.replace(tag, new_tag, 1)


xml = set_attr(r'<graphics\b[^>]*/?>', 'w', '480', xml)
xml = set_attr(r'<graphics\b[^>]*/?>', 'h', '640', xml)

if 'source="demo://"' not in xml:
    xml = re.sub(
        r'(<navit\b[^>]*>)',
        r'\1\n    <vehicle name="Demo" profilename="car" source="demo://" follow="1" active="1"/>',
        xml,
        count=1,
    )

open(path, 'w', encoding='utf-8').write(xml)
PY

echo "Wrote ${DST} (from ${STOCK}: 480x640 window + demo vehicle)."
echo "No map data yet — drop a maptool-built .bin extract at ~/.navit/maps/"
echo "and add a <mapset><map type=\"binfile\" data=\"...\"/></mapset> entry to use it."
