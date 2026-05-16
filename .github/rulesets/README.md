# GitHub Repository Rulesets

Branch protection and pre-merge checks **as code**. This is the one config that
silently drifts when it lives only in the GitHub web UI.

## Files

- [`branch-master.json`](./branch-master.json) — protects `master`: PR required,
  status checks must pass, no force-push, no deletions, linear history.

## Applying a ruleset

Once (per ruleset), apply via `gh`:

```bash
gh api \
  --method POST \
  -H "Accept: application/vnd.github+json" \
  /repos/KevinTCoughlin/kevintcoughlin.github.io/rulesets \
  --input .github/rulesets/branch-master.json
```

To update an existing ruleset (after editing the JSON), grab the `id` from
`gh api /repos/:owner/:repo/rulesets` and:

```bash
gh api \
  --method PUT \
  -H "Accept: application/vnd.github+json" \
  /repos/KevinTCoughlin/kevintcoughlin.github.io/rulesets/<ID> \
  --input .github/rulesets/branch-master.json
```

## Editing in the UI

Settings → Rules → Rulesets. After editing, **export the ruleset to JSON** and
commit it back here so the source of truth stays version-controlled.

## Why not automate the apply step in CI?

Applying rulesets requires `admin:repo` permission, which `GITHUB_TOKEN`
doesn't have. Automating would require a PAT or GitHub App, which adds
secret-management overhead disproportionate to a personal site. Manual
apply at change-time is fine; the version-controlled JSON is the win.
