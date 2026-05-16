# Copilot Instructions for kevintcoughlin.github.io

> **Canonical guide:** [`AGENTS.md`](../AGENTS.md) at the repo root.
> This file remains for tooling that specifically reads `.github/copilot-instructions.md`.
> When the two conflict, `AGENTS.md` wins.

## TL;DR

- Static personal website. No framework. No build step. No backend.
- Node 24 + Yarn 4 (Corepack). ESLint v10 flat config. Prettier 3.
- `master` auto-deploys to GitHub Pages → <https://kevintcoughlin.com>.
- Analytics: **Cloudflare Web Analytics** (Google Analytics + AdSense were removed in #47).
- Background images: Cloudflare Worker at `bauhaus.cascadiacollections.workers.dev`.

## Workflows you need to know

| Command               | What it does                                       |
| --------------------- | -------------------------------------------------- |
| `yarn install`        | Install dev deps                                   |
| `yarn start`          | http-server on :8080 (raw repo)                    |
| `yarn stage`          | Produce `./_site` — **what Pages actually serves** |
| `yarn preview`        | stage + http-server `./_site`                      |
| `yarn dev:docker`     | Hot-reload preview via nginx (bind-mounted)        |
| `yarn preview:docker` | Production-parity preview via nginx                |
| `yarn validate`       | ESLint + Prettier (matches CI)                     |

The deploy workflow uses [`scripts/stage-site.sh`](../scripts/stage-site.sh) as the
single source of truth for the file list shipped to production. If you add a new
runtime file, add it there too.

## Conventions

- **Commits:** Conventional Commits. Dependabot uses `chore(deps)` / `chore(ci)`.
- **Branch:** trunk-based on `master`.
- **Don't introduce frameworks/bundlers/transpilers.**
- **Don't modify `web-vitals.js` by hand** — it's vendored.
- **CSP is in `index.html`** via `<meta http-equiv="Content-Security-Policy">`.
  Any new external origin must be added there.
- **Third-party GitHub Actions are pinned to commit SHA** in workflows with
  write permissions. First-party actions (`actions/*`, `github/*`) may use
  major-version tags.

## Quality bars (enforced by CI)

- Lighthouse: perf ≥ 90, a11y ≥ 95, best-practices ≥ 90, SEO ≥ 95
- Lychee: no broken links in `index.html`, `README.md`, `sitemap.xml`
- CodeQL: clean for JavaScript (provided by GitHub's default Code Scanning setup)
- OSSF Scorecard: monitored weekly

## File map (selected)

- `index.html` — entry point (inline `<style>`, ES module imports)
- `bauhaus.js` — daily background image + caching
- `sw.js` — service worker (image cache)
- `telemetry.js`, `web-vitals.js` — self-hosted beacons
- `manifest.json` — PWA
- `.well-known/security.txt` — disclosure contact
- `scripts/stage-site.sh` — staging script
- `Dockerfile`, `docker-compose.yml` — local preview parity
- `.github/workflows/` — CI/CD (deploy, quality, scorecard, copilot-setup-steps)

## When unsure

- Read [`AGENTS.md`](../AGENTS.md).
- Look at recent merged PRs (`gh pr list --state merged --limit 10`).
- Open a draft PR with a question rather than guessing on architecture.
