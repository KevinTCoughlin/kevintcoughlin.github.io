# kevintcoughlin.com

[![Deploy to GitHub Pages](https://github.com/KevinTCoughlin/kevintcoughlin.github.io/actions/workflows/deploy.yml/badge.svg)](https://github.com/KevinTCoughlin/kevintcoughlin.github.io/actions/workflows/deploy.yml)

My personal website built as a static site and deployed to GitHub Pages.

## Features

- Static HTML/CSS/JavaScript site (no build step required)
- Daily rotating background images from the [Bauhaus Collection](https://github.com/cascadiacollections/bauhaus)
- PWA-ready with manifest and service worker support
- Optimized caching strategy using localStorage and query parameters
- Responsive design with smooth animations

## Development

This repository includes a devcontainer configuration for development in VS Code or GitHub Codespaces.

### Prerequisites

- [Node.js](https://nodejs.org/) 24.x or later
- [Yarn](https://yarnpkg.com/) 4.x (via [Corepack](https://nodejs.org/api/corepack.html))

### Local Development

```bash
# Install dependencies
yarn install

# Start local development server (opens browser automatically)
yarn start

# Run linting
yarn lint

# Fix linting issues automatically
yarn lint:fix

# Check code formatting
yarn format

# Fix formatting issues automatically
yarn format:fix

# Run all validations (lint + format)
yarn validate
```

The development server runs on http://localhost:8080.

### Code Quality

This project uses:

- **ESLint** for JavaScript linting (with HTML plugin support)
- **Prettier** for code formatting
- **GitHub Actions** for automated validation on every push

All code is validated automatically in CI/CD before deployment.

## Deployment

The site is automatically deployed to GitHub Pages when changes are pushed to the `master` branch. The deployment process:

1. Validates code with ESLint and Prettier
2. Deploys static files to GitHub Pages
3. Makes the site available at [kevintcoughlin.com](https://kevintcoughlin.com)

## External Integrations

- **Bauhaus API**: Daily background images from `https://bauhaus.cascadiacollections.workers.dev`
- **Google Analytics**: Site analytics (GA4)
- **Google AdSense**: Ad management

## Project Structure

```
.
├── .devcontainer/          # VS Code devcontainer configuration
├── .github/workflows/      # GitHub Actions CI/CD
├── index.html              # Main site page
├── manifest.json           # PWA manifest
├── robots.txt              # Search engine directives
├── sitemap.xml             # Site map
├── CNAME                   # Custom domain configuration
├── LICENSE                 # MIT License
├── package.json            # Dependencies and scripts
└── README.md               # This file
```

## License

MIT License - see [LICENSE](LICENSE) for details.
