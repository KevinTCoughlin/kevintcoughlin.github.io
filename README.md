# kevintcoughlin.com

[![Deploy](https://github.com/KevinTCoughlin/kevintcoughlin.github.io/actions/workflows/deploy.yml/badge.svg)](https://github.com/KevinTCoughlin/kevintcoughlin.github.io/actions/workflows/deploy.yml)
[![Quality](https://github.com/KevinTCoughlin/kevintcoughlin.github.io/actions/workflows/quality.yml/badge.svg)](https://github.com/KevinTCoughlin/kevintcoughlin.github.io/actions/workflows/quality.yml)
[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/KevinTCoughlin/kevintcoughlin.github.io/badge)](https://scorecard.dev/viewer/?uri=github.com/KevinTCoughlin/kevintcoughlin.github.io)

My personal website. Static, framework-free, deployed to GitHub Pages.

> **For AI coding agents:** start with [`AGENTS.md`](./AGENTS.md).

## Features

- Single-page static site — no framework, no build step
- Daily rotating background from the [Bauhaus](https://github.com/cascadiacollections/bauhaus) Cloudflare Worker
- PWA manifest + service-worker image cache (`sw.js`)
- Self-hosted error / Web Vitals beacons (`telemetry.js`)
- Cloudflare Web Analytics (privacy-respecting, no cookies)
- CSP via `<meta>`, `security.txt`, signed `WebFinger`-style identity link
- Build provenance attestations on every Pages deploy

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) 26.x (via [Corepack](https://nodejs.org/api/corepack.html))
- [Yarn](https://yarnpkg.com/) 4 — installed automatically by Corepack
- [Docker](https://www.docker.com/) (optional — for production-parity preview)

A [devcontainer](.devcontainer/devcontainer.json) is provided for VS Code and Codespaces.

### Common commands

```bash
yarn install            # Install dev deps
yarn start              # http-server on :8080 (raw repo, no staging)
yarn stage              # Produce ./_site (exactly what Pages serves)
yarn preview            # stage + http-server ./_site
yarn preview:docker     # stage + nginx via docker compose (prod parity)

yarn lint               # ESLint (incl. html-eslint)
yarn format             # Prettier check
yarn validate           # lint + format — matches CI
```

### Docker preview

Two profiles:

```bash
# Rapid prototyping — bind-mounts the repo; edits are live, no rebuild.
docker compose --profile dev up        # or: yarn dev:docker
# → http://localhost:8080  (Cache-Control: no-store, autoindex on)

# Production-parity — builds the image with staged _site/ baked in.
docker compose up --build              # or: yarn preview:docker
# → http://localhost:8080  (read-only rootfs, non-root, hardened)
```

Use `dev` while iterating, `prod` for a sanity check before opening a PR.
The dev container has no build step, so startup is < 2 s; the prod container
runs the same nginx config that gets bundled in the image.

## Deployment

Push to `master` → [`deploy.yml`](.github/workflows/deploy.yml) runs:

1. **Validate** — ESLint + Prettier
2. **Stage** — `scripts/stage-site.sh _site` (single source of truth for the file
   list that ships to production — also reused by Lighthouse CI and Docker)
3. **Attest** — `actions/attest-build-provenance` signs the artifact
4. **Deploy** — `actions/deploy-pages` publishes to <https://kevintcoughlin.com>

## CI workflows

| Workflow                  | Purpose                                             | Trigger                  |
| ------------------------- | --------------------------------------------------- | ------------------------ |
| `deploy.yml`              | Validate → stage → attest → deploy to Pages                     | push to `master`, manual |
| `quality.yml`             | Lighthouse CI + lychee link check + devcontainer smoke test     | PRs, push, weekly cron   |
| `scorecard.yml`           | OSSF Scorecard supply-chain rating                              | weekly cron, push        |
| `copilot-setup-steps.yml` | Preinstall env for Copilot Coding Agent                         | manual                   |

CodeQL is provided by GitHub's **default Code Scanning setup** (configured in
repository Settings → Code security), so no workflow file is needed.

All workflows use [`step-security/harden-runner`](https://github.com/step-security/harden-runner)
in audit mode (SHA-pinned). Third-party actions in write-permission workflows
are SHA-pinned; first-party `actions/*` and `github/*` use major-version tags
and are auto-bumped by Dependabot.

## External integrations

- **Bauhaus API** — daily backgrounds from `bauhaus.cascadiacollections.workers.dev`
- **Cloudflare Web Analytics** — cookieless page-load and Web Vitals
- **Cloudflare Insights** — telemetry beacon endpoint

## Security

See [`.github/SECURITY.md`](./.github/SECURITY.md) and
[`.well-known/security.txt`](./.well-known/security.txt).

## License

[MIT](./LICENSE).
