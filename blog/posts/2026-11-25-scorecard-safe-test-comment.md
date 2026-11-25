---
published: 2026-11-25T17:20:00Z
tags:
  - github-actions
  - tips
---

# Getting the test-results comment back without checks: write

[deathban-pro#83](https://github.com/KevinTCoughlin/deathban-pro/pull/83) removed `EnricoMi/publish-unit-test-result-action` from CI. The workflow had granted `checks: write` at the top, and OpenSSF Scorecard's Token-Permissions check warns on that scope, including when only a job sets it. The pull-request comment went away with the action. [deathban-pro#87](https://github.com/KevinTCoughlin/deathban-pro/pull/87) puts a comment back from a later job whose write scope is `pull-requests: write`.

## What the publish step needed

The build job used to publish results itself:

```yaml
- name: Publish test results
  uses: EnricoMi/publish-unit-test-result-action@v2
  if: always()
  with:
    files: build/test-results/test/*.xml
    check_name: Test Results
    comment_mode: always
```

Above that job the workflow permissions were `contents: read`, `checks: write`, and `pull-requests: write`. The step sets `check_name: Test Results`, so the token has to create a check run. After #83 the top of `.github/workflows/ci.yml` is `contents: read`, and that step is gone.

## A separate job

The build job still runs Gradle, on that read-only token. After the tests it uploads `build/test-results/test/*.xml` as an artifact named `junit-xml`, and it appends the same counts to the job summary. The summary is `GITHUB_STEP_SUMMARY`. It needs no extra scope, so a fork, Dependabot, and a push to `main` still show the counts on the run.

The comment is the `test-results` job, as merged in [`d174f05`](https://github.com/KevinTCoughlin/deathban-pro/commit/d174f0565f6a4afd327bf8307809d46c325b8d95). It waits for `build`. It runs for a same-repo pull request that is not from Dependabot, when the build succeeded or failed:

```yaml
# One comment for same-repo pull requests. The build job stays read-only.
# Scorecard v5.7 (scorecard-action v2.6.0) warns when the checks scope is
# write, including at job level, and does not treat pull-requests write as
# one of those scopes. Fork and Dependabot tokens cannot write from this
# event; pr-test-results.yml comments for those after CI completes.
test-results:
  name: Test result comment
  needs: build
  if: >-
    always() &&
    github.event_name == 'pull_request' &&
    github.event.pull_request.head.repo.full_name == github.repository &&
    github.actor != 'dependabot[bot]' &&
    (needs.build.result == 'success' || needs.build.result == 'failure')
  runs-on: ubuntu-24.04
  timeout-minutes: 5
  permissions:
    actions: read
    contents: read
    pull-requests: write
  steps:
    - name: Checkout
      uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
      with:
        persist-credentials: false

    - name: Download JUnit XML
      continue-on-error: true
      uses: actions/download-artifact@37930b1c2abaa49bbe596cd826c3c89aef350131 # v7.0.0
      with:
        name: junit-xml
        path: junit-xml

    - name: Publish pull request comment
      env:
        GITHUB_TOKEN: ${{ github.token }}
        GITHUB_REPOSITORY: ${{ github.repository }}
        PR_NUMBER: ${{ github.event.pull_request.number }}
        HEAD_SHA: ${{ github.event.pull_request.head.sha }}
        RUN_URL: ${{ github.server_url }}/${{ github.repository }}/actions/runs/${{ github.run_id }}
        RESULTS_DIR: junit-xml
        BUILD_RESULT: ${{ needs.build.result }}
      run: python3 scripts/test_results_comment.py post
```

`actions: read` is the artifact download. `contents: read` is the checkout. `pull-requests: write` is the comment.

## What Scorecard v5.7 counts

`.github/workflows/scorecard.yml` pins `ossf/scorecard-action` to `23f22cd43608bae7a1f1fa2603d7314dee9538a5` (`v2.6.0`). That tag's `go.mod` requires `github.com/ossf/scorecard/v5 v5.7.0`.

In `checks/raw/permissions.go` the writes that count are `statuses`, `checks`, `security-events`, `deployments`, `contents`, `packages`, and `actions`. A write of one of those is recorded at the top of the file and on a job. `checks/evaluation/permissions.go` warns when a job sets one of them to write. `checks: write` on the job that creates the check run is still that warning, so the publish action does not fit there either.

`pull-requests` is absent from that list. The raw check stores the write as a non-dangerous write, and the score does not drop for it.

[Run 45500072078](https://github.com/KevinTCoughlin/deathban-pro/actions/runs/45500072078) is Scorecard v5.7.0 on the merge commit. Token-Permissions logged the comment job as `Info: jobLevel 'actions' permission set to 'read': .github/workflows/ci.yml:199` and the same for `contents` on line 200, then `Info: no jobLevel write permissions found`. Line 201 is `pull-requests: write`, and it is absent from that log. The check still scored 0, on a warning that was already there: `Warn: topLevel 'contents' permission set to 'write': .github/workflows/release.yml:14`. #87 leaves `release.yml` alone.

The Scorecard job on the pull request head never printed a score. [Run 45453315532](https://github.com/KevinTCoughlin/deathban-pro/actions/runs/45453315532) failed pulling `ghcr.io/ossf/scorecard-action:v2.6.0` with `manifest unknown`.

## The checkout and the one comment

The comment job runs on its own runner. Its checkout leaves `ref` unset, so the files are the commit that the workflow run is executing, and it sets `persist-credentials: false`. The XML it reads is the `junit-xml` artifact uploaded by `build`. The Gradle job keeps the read-only token.

`scripts/test_results_comment.py` starts the body with `<!-- deathban-pro-test-results -->`. A later CI run edits the earliest `github-actions[bot]` comment that contains that marker, and deletes later bot copies of it. Comments from any other author stay put.

On #87 that is [one comment](https://github.com/KevinTCoughlin/deathban-pro/pull/87#issuecomment-7139774177). GitHub created it at 17:50 UTC and updated it at 17:54 UTC. The body shows `6f01d55cc66e`, the second commit on the pull request, and links [run 45453315718](https://github.com/KevinTCoughlin/deathban-pro/actions/runs/45453315718). CI ignores `**/*.md`, so a docs-only push does not run the job. The comment says it is updated when CI finishes.

Fork `pull_request` tokens stay read-only, and Dependabot tokens do too, even when the workflow file asks for write. The `test-results` job is skipped for them. `.github/workflows/pr-test-results.yml` runs on `workflow_run` after CI completes, from the default-branch copy of the workflow. It downloads the artifact, and its checkout also leaves `ref` unset. Same-repo runs that are not from Dependabot are skipped there, so those pull requests get the one comment from `ci.yml`. Dangerous-Workflow on the merge run scored 10: `no dangerous workflow patterns detected`.

A test report that can live as a pull-request comment can use `pull-requests: write` on its own job. `checks: write` is the scope Scorecard warns on, at the top of the workflow and on the job.
