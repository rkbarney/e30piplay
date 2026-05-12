#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if ! command -v docker >/dev/null 2>&1; then
  echo "docker not found. Install Docker Desktop for Mac: https://docs.docker.com/desktop/setup/install/mac-install/" >&2
  exit 1
fi

exec docker compose up --build "$@"
