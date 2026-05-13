const CACHE_NAME = 'moments-v8';

self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isR2Request(url) {
  return url.includes('r2.dev') || url.includes('r2.cloudflarestorage.com');
}

function isImage(url) {
  return /\.(jpg|jpeg|png|gif|webp|avif|svg)$/i.test(new URL(url).pathname);
}

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET') return;
  if (!event.request.url.startsWith('http')) return;
  if (event.request.mode === 'navigate') return;

  const { url } = event.request;

  if (isImage(url) || isR2Request(url)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(event.request).then(cached => {
          const fetchPromise = fetch(event.request).then(response => {
            if (response.ok) cache.put(event.request, response.clone());
            return response;
          }).catch(() => cached);
          return cached || fetchPromise;
        })
      )
    );
  }
});
