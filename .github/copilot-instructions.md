# Copilot Instructions for kevintcoughlin.github.io

This repository is a personal website, statically served via GitHub Pages. Follow these guidelines to ensure AI coding agents are productive and consistent with project conventions.

## Project Overview

- **Type:** Static personal website
- **Deployment:** Auto-deployed to GitHub Pages on every push to `master`
- **Dev Environment:** VS Code Dev Containers or GitHub Codespaces (see devcontainer config)

## Key Workflows

- **Local Development:**
  - Install dependencies: `yarn install`
  - Start local server: `yarn start`
- **Deployment:**
  - No manual steps; deployment is handled by GitHub Actions on push to `master`.

## File/Directory Conventions

- `index.html`: Main entry point for the site
- `manifest.json`, `robots.txt`, `CNAME`: Standard static site config files
- `package.json`: Defines dependencies and scripts (uses Yarn)
- `.github/`: GitHub-specific configuration (actions, instructions)

## Patterns & Practices

- **No build step**: Site is served as static files; avoid introducing frameworks or build tools unless explicitly requested.
- **Minimal external dependencies**: Only add packages if necessary and document their purpose in `README.md`.
- **Keep HTML/CSS/JS simple**: Prioritize maintainability and clarity over complexity.
- **No backend/server code**: All logic should run client-side.

## Examples

- To add a new page, create a new HTML file and link it from `index.html`.
- To update site metadata, edit `manifest.json` and `index.html`.

## Integration Points

- **GitHub Actions**: See `.github/workflows/deploy.yml` for deployment automation.
- **Custom Domain**: Managed via `CNAME` file.

## When in Doubt

- Reference `README.md` for up-to-date workflow instructions.
- Ask for clarification before introducing new tools or major changes.
