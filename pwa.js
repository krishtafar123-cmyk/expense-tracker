// Registers the service worker that makes the app installable to a home screen.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) => {
      console.error("Service worker registration failed:", err);
    });
  });
}

// ---------- Update detection ----------
// An installed PWA resumed from the home screen often just restores the page
// already in memory — no navigation, so no fetch, so a new deploy goes
// unnoticed indefinitely. This watches the files the page actually loaded and
// offers a reload when any of them change on the server.
//
// Vercel sends a per-deploy ETag, so there's no version number to bump by hand
// (which would eventually be forgotten, reintroducing the same problem).
(function watchForUpdates() {
  const CHECK_EVERY_MS = 5 * 60 * 1000;

  const sameOrigin = (url) => {
    try { return new URL(url, location.href).origin === location.origin; }
    catch { return false; }
  };

  const watched = [
    location.pathname,
    ...Array.from(document.querySelectorAll("script[src]")).map((s) => s.src),
    ...Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map((l) => l.href),
  ].filter(sameOrigin);

  if (watched.length === 0) return;

  // ETag if the server sends one, falling back to Last-Modified.
  async function fingerprint(url) {
    try {
      const res = await fetch(url + (url.includes("?") ? "&" : "?") + "_v=" + Date.now(), {
        method: "HEAD",
        cache: "no-store",
      });
      return res.headers.get("etag") || res.headers.get("last-modified") || null;
    } catch {
      return null; // offline or blocked — treated as "unknown", never as changed
    }
  }

  // Keyed by url so a file that fails to answer can be skipped individually
  // rather than discarding the whole comparison — one flaky response would
  // otherwise disable update detection for the rest of the session.
  async function fingerprintAll() {
    const marks = await Promise.all(watched.map(fingerprint));
    const out = {};
    watched.forEach((url, i) => { if (marks[i]) out[url] = marks[i]; });
    return out;
  }

  // An update means: some file we can read now differs from what we read
  // before. Files missing from either side are simply not evidence.
  function hasChanged(before, now) {
    return Object.keys(now).some((url) => before[url] && before[url] !== now[url]);
  }

  let baseline = null;
  let banner = null;

  function showBanner() {
    if (banner) return;
    banner = document.createElement("div");
    banner.className = "update-banner";
    banner.setAttribute("role", "status");
    banner.innerHTML = `
      <span>A newer version of the app is available.</span>
      <button type="button" class="btn btn-primary">Reload</button>
    `;
    banner.querySelector("button").addEventListener("click", async () => {
      // Drop the service worker caches too, so the reload can't be answered
      // from a stale copy of the very files we just detected as outdated.
      try {
        if (window.caches) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
      } catch (err) {
        console.error("Could not clear caches before reload:", err);
      }
      location.reload();
    });
    document.body.appendChild(banner);
  }

  async function check() {
    if (document.visibilityState !== "visible") return;
    const now = await fingerprintAll();
    if (!baseline) { baseline = now; return; }
    if (hasChanged(baseline, now)) showBanner();
  }

  window.addEventListener("load", () => { fingerprintAll().then((f) => { baseline = f; }); });
  document.addEventListener("visibilitychange", check);
  setInterval(check, CHECK_EVERY_MS);

  // Exposed purely so the update path can be exercised in testing without
  // waiting for a real deploy.
  window.__updateWatcher = { fingerprintAll, hasChanged, showBanner, getBaseline: () => baseline };
})();
