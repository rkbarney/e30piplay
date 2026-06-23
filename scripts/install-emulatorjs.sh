#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# install-emulatorjs.sh
#
# Downloads EmulatorJS from the @emulatorjs npm packages and installs the
# data directory plus selected cores into public/emulatorjs/ for fully
# offline use.
#
# Run once after cloning, and again to upgrade:
#   bash scripts/install-emulatorjs.sh
#
# Cores installed: fceumm (NES), gambatte (GB + GBC), snes9x (SNES).
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
EMULATORJS_VERSION="${EMULATORJS_VERSION:-4.2.3}"

# Libretro core packages to install.
# Each maps to an @emulatorjs/core-<name> npm package.
#   fceumm   → NES
#   gambatte → Game Boy and Game Boy Color (both use the 'gb' system name)
#   snes9x   → SNES
CORES=("fceumm" "gambatte" "snes9x")

NPM_BASE="https://registry.npmjs.org"

echo "==> Installing EmulatorJS ${EMULATORJS_VERSION} → ${TARGET}"

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

# ── 1. Main data package (loader.js, emulator.css, src/, localization/) ──────
EJS_URL="${NPM_BASE}/@emulatorjs/emulatorjs/-/emulatorjs-${EMULATORJS_VERSION}.tgz"
echo "    Downloading @emulatorjs/emulatorjs@${EMULATORJS_VERSION}…"
curl -fsSL --max-time 120 -o "$TMPDIR/ejs.tgz" "$EJS_URL"

echo "    Extracting…"
mkdir -p "$TMPDIR/ejs_src"
tar -xzf "$TMPDIR/ejs.tgz" -C "$TMPDIR/ejs_src"

# The tarball unpacks to package/; EmulatorJS data lives in package/data/.
DATA_SRC="$TMPDIR/ejs_src/package/data"
if [[ ! -f "$DATA_SRC/loader.js" ]]; then
  echo "ERROR: loader.js not found in extracted package." >&2
  echo "       Check that EMULATORJS_VERSION=${EMULATORJS_VERSION} is a valid @emulatorjs/emulatorjs release." >&2
  exit 1
fi

mkdir -p "$TARGET"
rsync -a "$DATA_SRC/" "$TARGET/"

# ── 2. Core packages ──────────────────────────────────────────────────────────
# Each @emulatorjs/core-<name> package contains <name>-wasm.data (and thread/
# legacy variants) at the package root, plus reports/<name>.json.
mkdir -p "$TARGET/cores" "$TARGET/cores/reports"

for CORE in "${CORES[@]}"; do
  CORE_URL="${NPM_BASE}/@emulatorjs/core-${CORE}/-/core-${CORE}-${EMULATORJS_VERSION}.tgz"
  echo "    Downloading @emulatorjs/core-${CORE}@${EMULATORJS_VERSION}…"
  curl -fsSL --max-time 120 -o "$TMPDIR/core-${CORE}.tgz" "$CORE_URL"

  CORE_DIR="$TMPDIR/core_${CORE}"
  mkdir -p "$CORE_DIR"
  tar -xzf "$TMPDIR/core-${CORE}.tgz" -C "$CORE_DIR"

  # .data files (wasm bundles) live at the package root.
  find "$CORE_DIR/package" -maxdepth 1 -name "*.data" \
    -exec cp -f {} "$TARGET/cores/" \;

  # Metadata reports used by the emulator at runtime.
  if [[ -d "$CORE_DIR/package/reports" ]]; then
    cp -f "$CORE_DIR/package/reports/"*.json "$TARGET/cores/reports/" 2>/dev/null || true
  fi
done

# ── 3. Verify installation ────────────────────────────────────────────────────
if [[ ! -f "$TARGET/loader.js" ]]; then
  echo "ERROR: loader.js missing from ${TARGET} — installation failed." >&2
  exit 1
fi

for CORE in "${CORES[@]}"; do
  if [[ ! -f "$TARGET/cores/${CORE}-wasm.data" ]]; then
    echo "ERROR: core bundle missing: ${TARGET}/cores/${CORE}-wasm.data" >&2
    exit 1
  fi
done

echo "    Done."
du -sh "$TARGET" 2>/dev/null || true
echo ""
echo "    EmulatorJS ${EMULATORJS_VERSION} installed to public/emulatorjs/"
echo "    Cores installed: ${CORES[*]}"
echo "    Run 'npm run build' to include it in the production bundle."
