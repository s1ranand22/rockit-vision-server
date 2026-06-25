// RockIt Vision — Service Worker
// Required for Android Chrome to show the install prompt.
// This is minimal — just caches the shell so the icon/splash loads offline.

const CACHE = 'rockit-vision-v1';
const SHELL = [
  '/vision/',
  '/vision/index.html',
  '/vision/manifest.json',
  '/vision/icon-192.png',
  '/vision/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  // Network first for WebSocket and API calls, cache fallback for shell
  if (e.request.url.includes('/vision-ws') || e.request.url.includes('googleapis')) {
    return; // don't intercept WebSocket or Gemini calls
  }
  e.respondWith(
    fetch(e.request).catch(() => caches.match(e.request))
  );
});
