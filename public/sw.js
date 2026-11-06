// public/sw.js
// Keeps the app shell on the phone so the app opens even when the network is
// blocked or very slow. Only this site's own files are kept; calls to other
// servers (database, AI) always go to the network untouched.

const VERSION = "md-shell-v1";
const SLOW_MS = 4000;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== VERSION).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

// Page loads: try the network first (fresh app after every deploy), and fall
// back to the saved page when it fails or takes too long.
async function page(request) {
  const cache = await caches.open(VERSION);
  const saved = () => cache.match("/index.html");

  try {
    const fresh = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error("slow")), SLOW_MS)),
    ]);

    if (fresh && fresh.ok) {
      cache.put("/index.html", fresh.clone());
      return fresh;
    }

    return (await saved()) || fresh;
  } catch {
    const old = await saved();

    if (old) return old;

    return fetch(request);
  }
}

// Built files have a new name on every change, so a saved copy is always right.
async function asset(request) {
  const cache = await caches.open(VERSION);
  const hit = await cache.match(request);

  if (hit) return hit;

  const fresh = await fetch(request);

  if (fresh && fresh.ok) cache.put(request, fresh.clone());

  return fresh;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);

  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(page(request));
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(asset(request));
  }
});
