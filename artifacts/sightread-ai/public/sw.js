/* SightRead AI service worker.
 * Goals: installable, opens offline (app shell + code already used), and
 * stays SMALL on low-storage phones. It never caches /api (uploads/OMR),
 * only same-origin GETs, and trims its asset cache to a fixed size. */
const VERSION = "v1";
const SHELL_CACHE = `sightread-shell-${VERSION}`;
const ASSET_CACHE = `sightread-assets-${VERSION}`;
const MAX_ASSET_ENTRIES = 40;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(["/", "/manifest.webmanifest", "/icon-192.png"]))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("sightread-") && k !== SHELL_CACHE && k !== ASSET_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // fonts etc: leave to the browser
  if (url.pathname.startsWith("/api/")) return; // never cache uploads / OMR

  // Page loads: network first so deploys show up, cached shell when offline.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(SHELL_CACHE).then((c) => c.put("/", copy));
          return res;
        })
        .catch(() => caches.match("/").then((r) => r || Response.error())),
    );
    return;
  }

  // Built assets are content-hashed, so cache-first is safe.
  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches
                .open(ASSET_CACHE)
                .then((c) => c.put(req, copy))
                .then(() => trim(ASSET_CACHE, MAX_ASSET_ENTRIES));
            }
            return res;
          }),
      ),
    );
  }
});
