/**
 * Offline support for the Edge/Chrome version: the app's own files are kept on the
 * computer, so ID Card Studio opens without internet. Your data never passes through here.
 * Raise VERSION whenever the app files change, so computers pick up the new version.
 */
'use strict';
const VERSION = 'idcs-1.0.4';
const FILES = [
  './', './index.html', './csv.js', './platform.js', './local-server.js', './manifest.webmanifest',
  './pages/CardStudio.html', './pages/Design.html', './pages/DesignRuntime.html',
  './pages/StudioClient.html', './pages/StudioTabBridge.html',
  './vendor/JsBarcode.all.min.js', './vendor/qrcode.js',
  './icons/school-logo.png', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png'
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(VERSION).then(cache => Promise.all(
    FILES.map(file => cache.add(new Request(file, {cache: 'reload'})).catch(() => null))
  )).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(key => key !== VERSION).map(key => caches.delete(key))))
    .then(() => self.clients.claim()));
});

// App files: use the network when available (so updates arrive), the saved copy when offline.
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(fetch(request).then(response => {
    if (response.ok) {
      const copy = response.clone();
      caches.open(VERSION).then(cache => cache.put(request, copy));
    }
    return response;
  }).catch(() => caches.match(request, {ignoreSearch: true}).then(cached => cached || caches.match('./index.html'))));
});
