const VERSION = 'v6';
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
  '/apple-touch-icon.png',
  '/rakit_banner_512x512.png',
  '/fonts/Inter-Regular-subset.woff2',
  '/fonts/Inter-Bold-subset.woff2',
  '/fonts/InterVariable-subset.woff2'
];
const RUNTIME_MAX_ENTRIES = 60;
const IMAGE_MAX_ENTRIES = 80;
const NAVIGATION_TIMEOUT_MS = 5000;

self.addEventListener('install', (event) => {
  event.waitUntil(precacheAppShell());
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
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

  if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
    return; // authenticated API responses must never enter a Cache Storage bucket
  }

  if (STATIC_ASSETS.includes(url.pathname)) {
    event.respondWith(cacheFirst(request, STATIC_CACHE));
    return;
  }

  if (request.mode === 'navigate' || request.destination === 'document') {
    event.respondWith(networkFirst(request, PAGE_CACHE, NAVIGATION_TIMEOUT_MS));
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

  event.respondWith(networkFirst(request, PAGE_CACHE));
});

async function precacheAppShell() {
  const staticCache = await caches.open(STATIC_CACHE);
  await staticCache.addAll(STATIC_ASSETS);

  const shellRequest = new Request(new URL('/', self.location.origin), { cache: 'reload' });
  const shellResponse = await fetch(shellRequest);
  if (!shellResponse.ok) throw new Error(`Unable to cache app shell (${shellResponse.status})`);

  const pageCache = await caches.open(PAGE_CACHE);
  await pageCache.put(shellRequest, shellResponse.clone());

  // Vite writes hashed script and stylesheet URLs into the production index.
  // Cache those exact files so the first installed launch can render without a network.
  const html = await shellResponse.text();
  const assetUrls = Array.from(html.matchAll(/(?:src|href)=["']([^"']+)["']/g), (match) => match[1])
    .map((value) => new URL(value, self.location.origin))
    .filter(
      (url) =>
        url.origin === self.location.origin &&
        url.pathname !== '/' &&
        !STATIC_ASSETS.includes(url.pathname) &&
        url.pathname !== '/sw.js' &&
        !url.pathname.startsWith('/api/')
    );

  const assetCache = await caches.open(ASSET_CACHE);
  await Promise.all(
    assetUrls.map(async (url) => {
      const request = new Request(url.href, { cache: 'reload' });
      const response = await fetch(request);
      if (!response.ok) throw new Error(`Unable to cache ${url.pathname} (${response.status})`);
      await assetCache.put(request, response);
    })
  );
}

async function cacheFirst(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (response.ok) await cache.put(request, response.clone());
  if (maxEntries) await trimCache(cache, maxEntries);
  return response;
}

async function networkFirst(request, cacheName, timeoutMs = 0) {
  const cache = await caches.open(cacheName);
  const controller = timeoutMs ? new AbortController() : null;
  const timeout = controller
    ? setTimeout(() => controller.abort(), timeoutMs)
    : null;
  try {
    const response = await fetch(request, controller ? { signal: controller.signal } : undefined);
    if (response.ok) await cache.put(request, response.clone());
    if (!response.ok && request.mode === 'navigate') {
      const cached =
        (await cache.match(request)) ||
        (await caches.match(new URL('/', self.location.origin).href));
      if (cached) return cached;
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') {
      const fallback = await caches.match(new URL('/', self.location.origin).href);
      if (fallback) return fallback;
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function staleWhileRevalidate(request, cacheName, maxEntries) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);

  const fetchPromise = fetch(request)
    .then(async (response) => {
      if (response.ok) await cache.put(request, response.clone());
      await trimCache(cache, maxEntries);
      return response;
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
