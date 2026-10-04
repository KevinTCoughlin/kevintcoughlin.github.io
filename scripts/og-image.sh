#!/usr/bin/env bash
# Regenerate og-image.png from scripts/og-image.html.
# Needs a Chromium-family browser and oxipng (same -o 4 as images.yml).
# Usage: bash scripts/og-image.sh

set -euo pipefail

cd "$(dirname "$0")/.."
browser=$(command -v chromium-browser || command -v chromium || command -v google-chrome || true)
[[ -n $browser ]] || { echo "no Chromium-family browser on PATH" >&2; exit 1; }
command -v oxipng >/dev/null || { echo "oxipng not on PATH" >&2; exit 1; }

"$browser" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --virtual-time-budget=10000 --window-size=1200,630 \
  --screenshot="$PWD/og-image.png" "file://$PWD/scripts/og-image.html" 2>/dev/null
oxipng -o 4 --strip safe --quiet og-image.png
file og-image.png
