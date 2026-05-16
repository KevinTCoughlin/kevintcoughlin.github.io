# Security Policy

## Reporting a vulnerability

Please **do not open public GitHub issues** for security vulnerabilities.

Use one of these channels instead, in order of preference:

1. **GitHub Private Vulnerability Reporting**:
   <https://github.com/KevinTCoughlin/kevintcoughlin.github.io/security/advisories/new>
2. Email the address listed in [`.well-known/security.txt`](./.well-known/security.txt).

Expect an initial acknowledgement within **72 hours**.

## Scope

This repository is a static personal website. There is no server-side code, no
authentication, and no user data is collected by the site itself. Realistic
attack surface is limited to:

- Cross-site scripting via the inline CSS / inline JSON-LD in `index.html`
- Service-worker cache poisoning (`sw.js`)
- Subresource issues with the Cloudflare Worker image origin
- Supply-chain compromise of npm dev dependencies

Bugs in those areas are in-scope. Issues in third-party services we link to
(GitHub Pages, Cloudflare, the Bauhaus Worker) should be reported upstream.

## Supported versions

Only the current production version (commit on `master` deployed to
<https://kevintcoughlin.com>) is supported.

## Hall of fame

This is a one-person personal site, but credible reports will be acknowledged
in the commit message or release notes if the reporter wishes.
