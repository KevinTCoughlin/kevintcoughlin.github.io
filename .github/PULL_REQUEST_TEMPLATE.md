## Summary

<!-- One-line description of the change. -->

## Type

- [ ] feat — user-visible behaviour change
- [ ] fix — bug fix
- [ ] chore(deps) — dependency bump
- [ ] chore(ci) — workflow / Actions change
- [ ] docs — README / AGENTS.md / inline comments only
- [ ] perf / a11y / SEO

## Verification

- [ ] `bun run validate` passes locally
- [ ] `bun run stage && ls _site/` includes any new runtime files
- [ ] Lighthouse CI thresholds (perf ≥ 90, a11y ≥ 95) not regressed
- [ ] CSP in `index.html` updated if a new external origin was added
- [ ] Tested at <http://localhost:8080> via `bun start` or `docker compose up`

## Notes for reviewers

<!-- Anything tricky, screenshots, or context that doesn't fit in the diff. -->
