// Offline support. Bump VERSION whenever any file below changes, so phones
// pick up the new version.
const VERSION = 'eh-v11';
const FILES = [
  './', 'index.html', 'learn.html', 'phrases.html', 'phrases.js', 'phrases-data.js', 'styles.css', 'app.js', 'learn.js', 'learn-data.js',
  'pwa.js', 'explain.js', 'translate.js', 'vendor/compromise.min.js', 'manifest.json', 'icon-192.png', 'icon-512.png', 'apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Network first, so updates show up straight away; the saved copy is used
// only when offline. Grammar checks (another site) are never cached.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }))
  );
});
