# Repository Guidelines for AI Agents

This file is the canonical entry point for AI coding agents working in this repo
(GitHub Copilot, Codex, Claude, Cursor, etc.). It supersedes the older
`.github/copilot-instructions.md` where they conflict.

## Project at a glance

- **Type:** static personal website (no framework, no build step)
- **Production:** GitHub Pages — auto-deployed on push to `master`
- **Domain:** <https://kevintcoughlin.com> (via `CNAME`)
- **Stack:** vanilla HTML / CSS / ES modules, served by GitHub Pages
- **Toolchain:** Node 24 LTS, Yarn 4 (via Corepack), ESLint v10 (flat config), Prettier 3
- **Analytics:** Cloudflare Web Analytics (Google Analytics + AdSense were removed in #47)
- **Background images:** Cloudflare Worker at `bauhaus.cascadiacollections.workers.dev`

## What lives where

| Path                                      | Purpose                                                                                                   |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `index.html`                              | Single-page entry; inline `<style>` + module imports                                                      |
| `bauhaus.js`                              | Hero image rotation + caching logic                                                                       |
| `sw.js`                                   | Service worker (image cache)                                                                              |
| `telemetry.js`                            | Self-hosted error/perf beacons                                                                            |
| `web-vitals.js`                           | Vendored web-vitals (do not lint/modify by hand)                                                          |
| `manifest.json`                           | PWA manifest                                                                                              |
| `sitemap.xml`, `robots.txt`, `humans.txt` | SEO / crawler hints                                                                                       |
| `.well-known/security.txt`                | Disclosure contact                                                                                        |
| `scripts/stage-site.sh`                   | **Source of truth** for "what files ship to prod"                                                         |
| `Dockerfile` + `docker-compose.yml`       | Production-parity local preview via nginx                                                                 |
| `.github/workflows/deploy.yml`            | Validate → stage → Pages deploy                                                                           |
| `.github/workflows/quality.yml`           | Lighthouse CI + lychee link check (PRs); devcontainer smoke test (weekly cron)                            |
| `.github/workflows/codeql.yml`            | _(removed — GitHub's default Code Scanning setup is enabled in repo settings; no workflow file required)_ |

## Commands

```bash
yarn install            # Corepack auto-pins Yarn 4
yarn start              # http-server on :8080 — fastest local loop
yarn lint               # ESLint
yarn format             # Prettier check
yarn validate           # lint + format (matches CI)
yarn stage              # Produce ./_site (what Pages will serve)

docker compose up       # Production-parity preview (built nginx image)
```

## Hard rules for agents

1. **No build step. No framework.** Don't introduce bundlers, transpilers, React/Vue/etc.
   This is intentional — the page is one HTML file and a handful of JS modules.
2. **No backend.** All logic runs client-side. External APIs go through Cloudflare Workers,
   not new server-side code in this repo.
3. **Keep the shipped surface small.** If you add a file that must ship to production,
   add it to `scripts/stage-site.sh` and verify it appears in `_site/` after running
   `yarn stage`. The deploy workflow only copies files listed in that script.
4. **Don't modify `web-vitals.js` by hand** — it's vendored. Replace it wholesale if upgrading.
5. **CSP is set via `<meta http-equiv>` in `index.html`.** Any new external origin
   (script, image, fetch) must be added to the appropriate directive.
6. **No secrets in this repo.** There is no server, so there's no place for them anyway.
7. **GitHub Actions pinning:** any action can use a major-version tag — Dependabot
   bumps them weekly. Pinning to SHA is optional; only do it if there's a concrete
   threat model (a personal static site doesn't have one).
8. **Yarn is the package manager.** `package-lock.json` should never appear.

## Quality bars (enforced by CI)

- Lighthouse: perf ≥ 90, a11y ≥ 95, best-practices ≥ 90, SEO ≥ 95 (desktop preset, 3 runs)
- Lychee: no broken links in `index.html`, `README.md`, `sitemap.xml`
- ESLint: html-eslint rules including `require-img-alt`, `no-target-blank`, `require-meta-*`
- Prettier: all files (see `.prettierignore`)

## Conventions

- **Commit messages:** Conventional Commits (`feat:`, `fix:`, `chore(deps):`, `chore(ci):`).
  Dependabot uses `chore(deps)` / `chore(ci)` prefixes — match them.
- **PRs:** one logical change per PR; CI must be green before merge.
- **Branch:** trunk-based on `master`. No long-lived feature branches.
- **Dependencies:** justify every new dep in the PR description.
  This repo has 5 devDeps total — keep it that way.

## When you're unsure

- Read `.github/copilot-instructions.md` for additional historical context.
- Reference the most recent merged PRs (`gh pr list --state merged --limit 10`) for tone.
- Open a draft PR and ask in the description rather than guessing on architecture.
