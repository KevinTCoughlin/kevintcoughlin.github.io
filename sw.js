const CACHE_PREFIX = 'kevintcoughlin-site-';
const IMAGE_CACHE = CACHE_PREFIX + 'image-v1';
const IMAGE_HOST = 'bauhaus.cascadiacollections.workers.dev';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.map((key) => {
            if (key.startsWith(CACHE_PREFIX) && key !== IMAGE_CACHE) {
              return caches.delete(key);
            }
            return Promise.resolve(false);
          })
        )
      )
      .then(() => self.clients.claim())
  );
});

function isBauhausImageRequest(request) {
  const url = new URL(request.url);
  if (url.hostname === IMAGE_HOST && url.pathname === '/api/today') {
    return true;
  }

  return false;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !isBauhausImageRequest(request)) {
    return;
  }

  event.respondWith(
    caches.open(IMAGE_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const networkPromise = fetch(request)
        .then((response) => {
          if (response.ok || response.type === 'opaque') {
            return cache
              .put(request, response.clone())
              .catch(() => {
                /* cache write failures are non-fatal */
              })
              .then(() => response);
          }
          return response;
        })
        .catch(() => null);

      if (cached) {
        event.waitUntil(networkPromise);
        return cached;
      }

      const network = await networkPromise;
      if (network) {
        return network;
      }

      return Response.error();
    })
  );
});
