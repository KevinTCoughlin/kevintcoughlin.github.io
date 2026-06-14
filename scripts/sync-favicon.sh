#!/usr/bin/env bash
# Fetch the current Gravatar and regenerate all icon assets.
# Requires: curl, imagemagick (convert), python3
# Env: GRAVATAR_EMAIL — email address registered with Gravatar (set as a GitHub secret)
set -euo pipefail

if [[ -z "${GRAVATAR_EMAIL:-}" ]]; then
  echo "GRAVATAR_EMAIL not set — skipping favicon sync" >&2
  exit 0
fi

# MD5 hash of lowercase, whitespace-trimmed email (Gravatar spec)
HASH=$(python3 -c "import hashlib,os; print(hashlib.md5(os.environ['GRAVATAR_EMAIL'].lower().strip().encode()).hexdigest())")
URL="https://www.gravatar.com/avatar/${HASH}?s=2048&d=404&r=g"

SOURCE=$(mktemp --suffix=.png)
trap 'rm -f "$SOURCE"' EXIT

echo "Fetching Gravatar …"
if ! HTTP_CODE=$(curl --connect-timeout 10 --max-time 30 -sS -o "$SOURCE" -w "%{http_code}" "$URL"); then
  echo "Failed to fetch Gravatar — skipping sync" >&2
  exit 0
fi
if [[ "$HTTP_CODE" != "200" ]]; then
  echo "Gravatar returned HTTP ${HTTP_CODE} — skipping sync" >&2
  exit 0
fi

convert "$SOURCE" -resize 32x32 -strip favicon.png
convert "$SOURCE" -resize 180x180 -strip apple-touch-icon-180.png
convert "$SOURCE" -resize 192x192 -strip icon-192.png
convert "$SOURCE" -resize 512x512 -strip icon-512.png

echo "Favicon sync complete."
