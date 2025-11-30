const VERSION = 'v3';
const STATIC_CACHE = `rakit-static-${VERSION}`;
const ASSET_CACHE = `rakit-assets-${VERSION}`;
const PAGE_CACHE = `rakit-pages-${VERSION}`;
const IMAGE_CACHE = `rakit-images-${VERSION}`;
const STATIC_ASSETS = [
  '/manifest.webmanifest',
  '/favicon-32x32.png',
  '/favicon-192x192.png',
  '/icon-128x128.png',
  '/icon-512x512.png',
  '/apple-touch-icon.png'
];
const RUNTIME_MAX_ENTRIES = 60;
const IMAGE_MAX_ENTRIES = 80;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(STATIC_ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => ![STATIC_CACHE, ASSET_CACHE, PAGE_CACHE, IMAGE_CACHE].includes(key)
            )
            .map((staleKey) => caches.delete(staleKey))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(networkFirst(request, PAGE_CACHE));
    return;
  }

  if (['style', 'script', 'worker', 'font'].includes(request.destination)) {
    event.respondWith(staleWhileRevalidate(request, ASSET_CACHE, RUNTIME_MAX_ENTRIES));
    return;
  }

  if (request.destination === 'image') {
    event.respondWith(staleWhileRevalidate(request, IMAGE_CACHE, IMAGE_MAX_ENTRIES));
    return;
  }

  if (url.pathname.startsWith('/api')) {
    return; // let API requests hit the network with no caching
  }

  event.respondWith(networkFirst(request, PAGE_CACHE));
});

async function cacheFirst(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  cache.put(request, response.clone());
  if (maxEntries) await trimCache(cache, maxEntries);
  return response;
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const fallback = await caches.match('/');
      if (fallback) return fallback;
    }
    throw error;
  }
}

async function staleWhileRevalidate(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then((response) => {
      cache.put(request, response.clone());
      return trimCache(cache, maxEntries).then(() => response);
    })
    .catch((error) => {
      if (cached) return cached;
      throw error;
    });

  return cached || fetchPromise;
}

async function trimCache(cache, maxEntries) {
  if (!maxEntries) return;
  const keys = await cache.keys();
  const deletions = [];
  while (keys.length > maxEntries) {
    const request = keys.shift();
    if (request) {
      deletions.push(cache.delete(request));
    }
  }
  await Promise.all(deletions);
}
