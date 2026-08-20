// PréVol DR400 — service worker
// Stratégie : "réseau d'abord" pour la page principale, pour que la
// dernière version en ligne soit toujours utilisée dès que le réseau
// est disponible ; repli sur le cache en l'absence de réseau.
// Augmente CACHE_VERSION si tu veux forcer un rafraîchissement complet
// du cache (rarement nécessaire avec cette stratégie).
const CACHE_VERSION = 'prevol-dr400-v5';

const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  // Les appels météo (/api/…) doivent toujours partir sur le réseau et ne
  // jamais être servis depuis le cache : une observation périmée servie
  // silencieusement serait dangereuse en préparation de vol.
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith('/api/')) return;

  const isNavigation = req.mode === 'navigate' ||
    (req.destination === '' && req.headers.get('accept')?.includes('text/html'));

  if (isNavigation) {
    // Page principale : réseau d'abord, cache en secours (mode hors ligne).
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // Autres ressources (icônes, polices, manifest…) : cache d'abord,
  // puis réseau, avec mise à jour silencieuse du cache si en ligne.
  event.respondWith(
    caches.match(req).then((cached) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200) {
            const copy = res.clone();
            caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
