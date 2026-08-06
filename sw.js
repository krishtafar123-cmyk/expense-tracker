// Bump CACHE when the shell changes so old entries are cleared on activate.
const CACHE = "expense-tracker-v3";

const SHELL = [
  "./",
  "./index.html",
  "./dashboard.html",
  "./reset.html",
  "./styles.css",
  "./auth.js",
  "./dashboard.js",
  "./reset.js",
  "./shared.js",
  "./config.js",
  "./pwa.js",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    // Cache entries individually so one failure doesn't abort the whole install.
    await Promise.all(SHELL.map((url) => cache.add(url).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Network-first: a new Vercel deploy is picked up immediately, and the cache
// only serves as an offline fallback. Cross-origin requests (Supabase API,
// the supabase-js CDN) are left alone entirely.
self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      const cache = await caches.open(CACHE);
      cache.put(req, fresh.clone());
      return fresh;
    } catch (err) {
      const cached = await caches.match(req);
      if (cached) return cached;
      throw err;
    }
  })());
});
