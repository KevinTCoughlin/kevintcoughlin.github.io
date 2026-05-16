#!/usr/bin/env bash
# Stage runtime assets into ./_site for Pages deploy, Lighthouse, and local preview.
# Mirrors what GitHub Pages will actually serve in production.
set -euo pipefail

OUT="${1:-_site}"
# Recreate the output dir so removed files don't linger from a previous run.
rm -rf "$OUT"
mkdir -p "$OUT/.well-known"

# Runtime files only — exclude lockfiles, configs, tooling, docs.
cp \
  index.html \
  manifest.json \
  sitemap.xml \
  robots.txt \
  llms.txt \
  CNAME \
  humans.txt \
  bauhaus.js \
  sw.js \
  telemetry.js \
  web-vitals.js \
  "$OUT/"

cp \
  favicon.png \
  icon-192.png \
  icon-512.png \
  og-image.png \
  apple-touch-icon-180.png \
  "$OUT/"

cp .well-known/security.txt "$OUT/.well-known/"

echo "Staged $(find "$OUT" -type f | wc -l | tr -d ' ') files into $OUT"
