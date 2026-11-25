// PathoMitra public web shell only. Clinical persistence is disabled in production
// browsers; the service worker therefore caches only an explicit static allowlist.
const STATIC_EXTENSIONS = [
  '.js',
  '.css',
  '.woff',
  '.woff2',
  '.ttf',
  '.png',
  '.jpg',
  '.jpeg',
  '.svg',
  '.ico',
  '.webp',
];
const PUBLIC_HTML_ROUTES = new Set(['/', '/index.html', '/privacy', '/technology', '/solutions']);
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/favicon.ico',
  '/favicon-16x16.png',
  '/favicon-32x32.png',
  '/android-chrome-192x192.png',
  '/android-chrome-512x512.png',
  '/apple-touch-icon.png',
];

let cacheName = 'pathomitra-cache-unversioned';
let cacheNamePromise = fetch('/pwa-version.json', { cache: 'no-store' })
  .then(response => (response.ok ? response.json() : null))
  .then(
    value =>
      `pathomitra-cache-${String(value?.buildId || 'unversioned')
        .replace(/[^a-zA-Z0-9_-]/g, '-')
        .slice(0, 80)}`,
  )
  .catch(() => 'pathomitra-cache-unversioned');

const currentCacheName = () => cacheNamePromise;

function isAllowedStaticPath(pathname) {
  if (
    pathname === '/manifest.json' ||
    pathname.startsWith('/favicon') ||
    pathname.startsWith('/android-chrome-') ||
    pathname === '/apple-touch-icon.png'
  )
    return true;
  return pathname.startsWith('/assets/') && STATIC_EXTENSIONS.some(ext => pathname.endsWith(ext));
}

self.addEventListener('install', event => {
  event.waitUntil(
    (async () => {
      cacheName = await currentCacheName();
      const cache = await caches.open(cacheName);
      await cache.addAll(PRECACHE_ASSETS);
      // Do not skipWaiting automatically. The page offers an accessible reload
      // prompt, so dismissing it keeps the current working shell available.
    })(),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      cacheName = await currentCacheName();
      const keys = await caches.keys();
      await Promise.all(keys.filter(key => key !== cacheName).map(key => caches.delete(key)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;

  if (isAllowedStaticPath(url.pathname)) {
    event.respondWith(
      (async () => {
        const name = await currentCacheName();
        const cache = await caches.open(name);
        const cached = await cache.match(request);
        if (cached) {
          fetch(request)
            .then(response => {
              if (response.status === 200 && response.type === 'basic')
                cache.put(request, response.clone());
            })
            .catch(() => {});
          return cached;
        }
        const response = await fetch(request);
        if (response.status === 200 && response.type === 'basic')
          cache.put(request, response.clone());
        return response;
      })(),
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        const name = await currentCacheName();
        const cache = await caches.open(name);
        try {
          const response = await fetch(request);
          if (
            response.status === 200 &&
            response.type === 'basic' &&
            PUBLIC_HTML_ROUTES.has(url.pathname)
          ) {
            cache.put(request, response.clone());
          }
          return response;
        } catch {
          return (
            (await cache.match(request)) || (await cache.match('/index.html')) || Response.error()
          );
        }
      })(),
    );
    return;
  }

  // API-like JSON, auth material, backups, patient data and every unrecognised
  // same-origin GET are deliberately never cached.
});
