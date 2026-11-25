---
published: 2026-11-25T04:02:00Z
tags:
  - containers
  - github-actions
  - tips
---

# trivy-action ignored the severity I set when it uploaded SARIF

The Security tab for [cs-server](https://github.com/KevinTCoughlin/cs-server) showed about 560 open Trivy alerts, and none of them could be acted on. That count is from the write-up for [cs-server#131](https://github.com/KevinTCoughlin/cs-server/pull/131), as of before the merge.

I had already set `severity: 'CRITICAL,HIGH'` on the SARIF step. It was not enough.

There were two causes, both as of that write-up. First, `aquasecurity/trivy-action` ignores `severity` for SARIF unless `limit-severities-for-sarif` is set, so medium, low, and unknown findings were uploaded along with critical and high. Second, every open finding was a Debian CVE with no fixed package yet. About 270 of the alerts, from the same write-up, belong to two categories from earlier job names, `.github/workflows/docker.yml:build-and-scan` and `.github/workflows/nightly.yml:nightly`. Nothing uploads to those any more, so they can never close on their own. The pull request does not touch them. Their old analyses have to be deleted by hand.

The current upload category is `trivy-${{ matrix.arch }}` on the matrix image job. The `build-and-scan` job still exists. It only aggregates results, and it does not upload SARIF, which is why that old category is stale.

## The SARIF step before and after

Before, the SARIF step in `.github/workflows/docker.yml` and `nightly.yml` used `aquasecurity/trivy-action@v0.36.0` with `severity` and neither of the two options:

```yaml
- name: Run Trivy vulnerability scanner
  id: trivy
  uses: aquasecurity/trivy-action@v0.36.0
  with:
    image-ref: ${{ env.LOCAL_IMAGE }}
    format: 'sarif'
    output: 'trivy-results.sarif'
    severity: 'CRITICAL,HIGH'
```

After, in [cs-server#131](https://github.com/KevinTCoughlin/cs-server/pull/131) ([`153b301`](https://github.com/KevinTCoughlin/cs-server/commit/153b301ba00152a35dd4fc2c9613f3137ccac15a)). `nightly.yml` mirrors it. The same commit pins `trivy-action` to the commit behind `v0.36.0`.

```yaml
- name: Run Trivy vulnerability scanner
  id: trivy
  uses: aquasecurity/trivy-action@ed142fd0673e97e23eac54620cfb913e5ce36c25 # v0.36.0
  with:
    image-ref: ${{ env.LOCAL_IMAGE }}
    format: 'sarif'
    output: 'trivy-results.sarif'
    severity: 'CRITICAL,HIGH'
    # The Security tab gets what can be acted on: critical and high
    # findings that have a fixed package to move to. Without the first
    # option the action ignores `severity` for SARIF and uploads every
    # level. The table below still lists unfixed findings in the log.
    limit-severities-for-sarif: true
    ignore-unfixed: true

- name: Upload Trivy results to GitHub Security
  uses: github/codeql-action/upload-sarif@v4
  if: always() && steps.trivy.outcome == 'success'
  with:
    sarif_file: 'trivy-results.sarif'
    category: trivy-${{ matrix.arch }}
```

The Security tab should then hold only critical and high findings that have a fix. The table step is unchanged. It still uses format `table` and severity `CRITICAL,HIGH,MEDIUM`, so the job log still lists critical, high, and medium findings, fixed or not.

An unfixed critical or high CVE no longer raises an alert and only appears in the job log. When Debian ships a fix, the next scan raises it. If you'd rather see unfixed criticals in the Security tab, drop `ignore-unfixed` and keep the severity limit.

`actionlint` passed, and the pull request's own `docker.yml` run exercised the new options on both architectures.

If you upload Trivy SARIF to code scanning, set `limit-severities-for-sarif` or `severity` won't apply. Add `ignore-unfixed` only if you accept unfixed criticals staying in the log. Leftover analyses under old job-name categories must be deleted by hand.
