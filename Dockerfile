# Build a production-parity preview of the static site using nginx.
# Usage:
#   docker build -t kevintcoughlin-site .
#   docker run --rm -p 8080:8080 kevintcoughlin-site
# Or via compose:
#   docker compose up

# ---------- Stage 1: stage runtime assets ----------
FROM alpine:3.22 AS stage
WORKDIR /src
COPY . .
RUN sh scripts/stage-site.sh /out

# ---------- Stage 2: nginx serving the staged site ----------
FROM nginx:1.27-alpine AS runtime

# Run as non-root for parity with restricted environments.
# nginx:alpine ships a 'nginx' user (uid 101). We:
#   - flip listen port from 80 → 8080 (non-root can't bind <1024)
#   - point document root at /srv
#   - relocate the pid file under /var/run/nginx (writable by nginx user)
RUN sed -i 's/listen\s*80;/listen 8080;/' /etc/nginx/conf.d/default.conf \
 && sed -i 's|/usr/share/nginx/html|/srv|g' /etc/nginx/conf.d/default.conf \
 && sed -i -E 's|^pid\s+.*;|pid /tmp/nginx.pid;|' /etc/nginx/nginx.conf \
 && mkdir -p /srv /var/cache/nginx \
 && chown -R nginx:nginx /srv /var/cache/nginx /var/log/nginx /etc/nginx/conf.d

COPY --from=stage --chown=nginx:nginx /out /srv

USER nginx
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
