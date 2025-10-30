const CACHE_NAME = 'tabsplit-v2';
const BASE_PATH = '/TabSplit-V1';
const urlsToCache = [
  `${BASE_PATH}/`,
  `${BASE_PATH}/index.html`
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache');
        return cache.addAll(urlsToCache);
      })
  );
});

self.addEventListener('fetch', event => {
  // Do not cache requests to the Gemini API
  if (event.request.url.includes('generativelanguage.googleapis.com')) {
    return;
  }

  // Do not cache CDN requests (Tailwind, React, etc)
  if (event.request.url.includes('cdn.tailwindcss.com') || 
      event.request.url.includes('aistudiocdn.com')) {
    return;
  }

  // Only cache same-origin requests
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Cache hit - return response
        if (response) {
          return response;
        }

        return fetch(event.request).then(
          networkResponse => {
            // Check if we received a valid response
            if (!networkResponse || networkResponse.status !== 200 || networkResponse.type !== 'basic') {
              return networkResponse;
            }

            // Clone the response for caching
            const responseToCache = networkResponse.clone();

            caches.open(CACHE_NAME)
              .then(cache => {
                cache.put(event.request, responseToCache);
              });

            return networkResponse;
          }
        ).catch(() => {
          // If fetch fails, try to return cached response
          return caches.match(event.request);
        });
      })
  );
});// Clean up old caches on activation
self.addEventListener('activate', event => {
  const cacheWhitelist = [CACHE_NAME];
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheWhitelist.indexOf(cacheName) === -1) {
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});
