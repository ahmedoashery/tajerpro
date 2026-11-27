#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

if ! command -v node >/dev/null 2>&1; then
  echo "[ERROR] Node.js is not installed. Please install Node.js 22 LTS from https://nodejs.org/"
  read -r -p "Press Enter to exit..." _
  exit 1
fi

exec node scripts/auto-start.mjs
