const CACHE_NAME = 'flash-anzan-school-7.0.3';
const APP_SHELL = [
  '/', '/index.html', '/manifest.webmanifest', '/icons/anzan-pro.svg',
  '/css/app.css', '/css/mobile.css', '/js/firebase-config.js', '/js/config.js',
  '/js/soroban-generator.js', '/js/app.js', '/js/ui.js', '/js/auth.js',
  '/js/multiplayer.js', '/js/school-operations.js', '/js/main.js'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE_NAME).map(key => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  if (event.request.method !== 'GET' || new URL(event.request.url).origin !== self.location.origin) return;
  if (event.request.mode === 'navigate') {
    event.respondWith(fetch(event.request).catch(() => caches.match('/index.html')));
    return;
  }
  // Zasoby aplikacji są network-first: po wdrożeniu użytkownik od razu dostaje
  // aktualny formularz i logikę. Cache pozostaje bezpiecznym fallbackiem offline.
  event.respondWith(fetch(event.request).then(response => {
    const copy = response.clone();
    caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
    return response;
  }).catch(() => caches.match(event.request)));
});
