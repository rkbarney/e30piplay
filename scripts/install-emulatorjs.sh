#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# install-emulatorjs.sh
#
# Downloads EmulatorJS from npm and extracts the data/ directory (loader, cores)
# into public/emulatorjs/ so the app can serve it fully offline.
#
# Run once after cloning, and again to upgrade:
#   bash scripts/install-emulatorjs.sh
#
# Cores included: nes, gb, gbc, snes (others are stripped to save space).
# The destination (public/emulatorjs/) is gitignored and is included in the
# Vite build automatically (public/ is copied verbatim into dist/).
#
# Environment overrides:
#   APP_DIR              defaults to the repo root (parent of this script's dir)
#   EMULATORJS_VERSION   npm package version to install (default: latest stable)
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
APP_DIR="${APP_DIR:-$(cd "$SCRIPT_DIR/.." && pwd)}"
TARGET="$APP_DIR/public/emulatorjs"
EMULATORJS_VERSION="${EMULATORJS_VERSION:-4.2.1}"
NPM_URL="https://registry.npmjs.org/emulatorjs/-/emulatorjs-${EMULATORJS_VERSION}.tgz"

# Cores to keep (others are stripped to reduce footprint).
# Extend this list when adding more systems.
KEEP_CORES=("nes" "gb" "gbc" "snes")

echo "==> Installing EmulatorJS ${EMULATORJS_VERSION} → ${TARGET}"

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

echo "    Downloading package tarball…"
curl -fsSL --max-time 120 -o "$TMPDIR/ejs.tgz" "$NPM_URL"

echo "    Extracting…"
tar -xzf "$TMPDIR/ejs.tgz" -C "$TMPDIR"

# The npm tarball always unpacks to package/
PKG="$TMPDIR/package"
if [[ ! -d "$PKG/data" ]]; then
  echo "ERROR: data/ directory not found inside the package." >&2
  echo "       Check that EMULATORJS_VERSION=${EMULATORJS_VERSION} is correct." >&2
  exit 1
fi

# Copy the full data directory, then strip unwanted core files.
mkdir -p "$TARGET"
rsync -a --delete "$PKG/data/" "$TARGET/"

# ── Strip cores not in KEEP_CORES to save ~100 MB ────────────────────────────
if [[ -d "$TARGET/cores" ]]; then
  echo "    Pruning unused cores…"
  for wasm in "$TARGET/cores"/*.wasm; do
    [[ -f "$wasm" ]] || continue
    base="$(basename "$wasm" .wasm)"
    keep=0
    for c in "${KEEP_CORES[@]}"; do
      [[ "$base" == "$c" ]] && { keep=1; break; }
    done
    if [[ "$keep" -eq 0 ]]; then
      rm -f "$wasm" "$TARGET/cores/${base}"_wasm.js 2>/dev/null || true
    fi
  done
fi

echo "    Done."
du -sh "$TARGET" 2>/dev/null || true
echo ""
echo "    EmulatorJS ${EMULATORJS_VERSION} installed to public/emulatorjs/"
echo "    Cores: ${KEEP_CORES[*]}"
echo "    Run 'npm run build' to include it in the production bundle."
