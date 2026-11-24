---
published: 2026-11-23T16:10:05Z
---

# A GitHub Pages deploy that missed the artifact it just uploaded

The Pages workflow for [deathban-pro](https://github.com/KevinTCoughlin/deathban-pro) uploaded the site and then failed. Checkout, staging, and the upload all succeeded. About a second later the deploy step said the artifact wasn't there.

[Run 45110071846](https://github.com/KevinTCoughlin/deathban-pro/actions/runs/45110071846) is the deploy of commit [`c43913e`](https://github.com/KevinTCoughlin/deathban-pro/commit/c43913e55d33eb390dd9ec3745c754799d6ed635). The upload step finished an artifact named `github-pages`. The next step, `actions/deploy-pages`, logged:

```
Found 0 artifact(s)
Error: No artifacts named "github-pages" were found for this workflow run. Ensure artifacts are uploaded with actions/upload-artifact@v4 or later.
```

Both steps were in the same job. `deploy-pages` lists artifacts as soon as it starts, and the upload from that job isn't visible yet. That's the race in [actions/deploy-pages#451](https://github.com/actions/deploy-pages/issues/451).

The log says to re-run the deployment. Re-running that run is the wrong recovery. A second upload on the same run then fails, because the run already has an artifact with that name.

## Put the deploy in the next job

Upload in a `build` job. Deploy in a `deploy` job with `needs: build`, so it starts only after the upload job has finished. Move the `environment` block with the deploy step. `pages: write` and `id-token: write` stay on the workflow, where they already were.

Before, `.github/workflows/pages.yml` did the staging, the upload, and the deploy in one job:

```yaml
jobs:
  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-24.04
    steps:
      - name: Checkout
        uses: actions/checkout@v7

      - name: Setup Pages
        uses: actions/configure-pages@v6

      - name: Stage public site
        run: |
          mkdir -p _site
          cp index.html .nojekyll _site/
          if [ -d assets ]; then cp -R assets _site/; fi

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v5
        with:
          path: '_site'

      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v5
```

After, in [deathban-pro#82](https://github.com/KevinTCoughlin/deathban-pro/pull/82) ([`69e0bf3`](https://github.com/KevinTCoughlin/deathban-pro/commit/69e0bf349fd8d3c711a6e67875fbc3d1079bc836)):

```yaml
jobs:
  build:
    runs-on: ubuntu-24.04
    steps:
      - name: Checkout
        uses: actions/checkout@v7

      - name: Setup Pages
        uses: actions/configure-pages@v6

      - name: Stage public site
        run: |
          mkdir -p _site
          cp index.html .nojekyll _site/
          if [ -d assets ]; then cp -R assets _site/; fi

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v5
        with:
          path: '_site'

  # deploy-pages lists artifacts as soon as it starts. In the same job as the
  # upload, that list is often still empty (actions/deploy-pages#451). A later
  # job sees the artifact after the upload job has finished.
  deploy:
    needs: build
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-24.04
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v5
```

If a Pages workflow uploads and deploys in one job and then fails with `Found 0 artifact(s)` right after a successful upload, split it the same way.
