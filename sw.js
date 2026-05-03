const IMAGE_CACHE = 'image-cache-v1';
const IMAGE_HOST = 'bauhaus.cascadiacollections.workers.dev';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

function isImageRequest(request) {
  if (request.destination === 'image') {
    return true;
  }

  const url = new URL(request.url);
  if (url.hostname === IMAGE_HOST && url.pathname.startsWith('/api/today')) {
    return true;
  }

  return false;
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || !isImageRequest(request)) {
    return;
  }

  event.respondWith(
    caches.open(IMAGE_CACHE).then(async (cache) => {
      const cached = await cache.match(request);
      const networkPromise = fetch(request)
        .then((response) => {
          if (response.ok) {
            cache.put(request, response.clone());
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
