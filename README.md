# kevintcoughlin.com

[![Deploy](https://github.com/KevinTCoughlin/kevintcoughlin.github.io/actions/workflows/deploy.yml/badge.svg)](https://github.com/KevinTCoughlin/kevintcoughlin.github.io/actions/workflows/deploy.yml)
[![Quality](https://github.com/KevinTCoughlin/kevintcoughlin.github.io/actions/workflows/quality.yml/badge.svg)](https://github.com/KevinTCoughlin/kevintcoughlin.github.io/actions/workflows/quality.yml)

My personal website. Static, framework-free, deployed to GitHub Pages.

> **For AI coding agents:** start with [`AGENTS.md`](./AGENTS.md).

## Features

- Single-page static site — no framework, no build step
- Daily rotating background from the [Bauhaus](https://github.com/cascadiacollections/bauhaus) Cloudflare Worker, with an inline SVG fallback so the hero never goes blank
- PWA manifest + service-worker image cache (`sw.js`)
- Self-hosted error / Web Vitals beacons (`telemetry.js`)
- Cloudflare Web Analytics (privacy-respecting, no cookies)
- CSP via `<meta>`, `security.txt`, signed WebFinger-style identity link

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 24.x (LTS) — pinned via [`.nvmrc`](.nvmrc)
- [Yarn](https://yarnpkg.com/) 4 — installed automatically by Corepack
- [Docker](https://www.docker.com/) (optional — for production-parity preview)

A [devcontainer](.devcontainer/Dockerfile) is provided for VS Code and Codespaces.

### Common commands

```bash
yarn install            # Install dev deps
yarn start              # http-server on :8080 — fastest local loop
yarn stage              # Produce ./_site (exactly what Pages serves)
yarn preview            # stage + http-server ./_site
yarn preview:docker     # stage + nginx via docker compose (prod parity)

yarn lint               # ESLint (incl. html-eslint)
yarn format             # Prettier check
yarn validate           # lint + format — matches CI
```

### Docker preview

```bash
docker compose up --build       # → http://localhost:8080
```

Runs nginx as non-root on a read-only rootfs — the same configuration GitHub
Pages would serve. Use for a final sanity check before opening a PR. For
day-to-day editing, `yarn start` is faster (no build step).

## Deployment

Push to `master` → [`deploy.yml`](.github/workflows/deploy.yml) runs:

1. **Validate** — ESLint + Prettier
2. **Stage** — `scripts/stage-site.sh _site` (single source of truth for the file
   list that ships to production — also reused by Lighthouse CI and Docker)
3. **Deploy** — `actions/deploy-pages` publishes to <https://kevintcoughlin.com>

## CI workflows

| Workflow                  | Purpose                                                                 | Trigger                  |
| ------------------------- | ----------------------------------------------------------------------- | ------------------------ |
| `deploy.yml`              | Validate → stage → deploy to Pages                                      | push to `master`, manual |
| `quality.yml`             | Lighthouse CI + lychee link check (PRs); devcontainer smoke test (cron) | PRs / push / weekly cron |
| `copilot-setup-steps.yml` | Preinstall env for Copilot Coding Agent                                 | manual                   |

CodeQL is provided by GitHub's **default Code Scanning setup** (configured in
repository Settings → Code security), so no workflow file is needed.

## External integrations

- **Bauhaus API** — daily backgrounds from `bauhaus.cascadiacollections.workers.dev`
- **Cloudflare Web Analytics** — cookieless page-load and Web Vitals
- **Cloudflare Insights** — telemetry beacon endpoint

## Security

See [`.github/SECURITY.md`](./.github/SECURITY.md) and
[`.well-known/security.txt`](./.well-known/security.txt).

## License

[MIT](./LICENSE).
