// modScore PWA: same-origin assets only. No score content leaves IndexedDB.
const BASE = new URL("./", self.location.href);
const local = (path) => new URL(path.replace(/^\//, ""), BASE).href;
const VERSION = "modscore-shell-v1";
const SCOPE = encodeURIComponent(BASE.pathname);
const SHELL_PREFIX = "modscore-shell-" + SCOPE + "-";
const SHELL_CACHE = SHELL_PREFIX + VERSION;
const OFFLINE = "modscore-offline-" + SCOPE + "-v1";
const SHELL = [
  "/",
  "/index.html",
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
];
self.addEventListener("install", (event) =>
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      await cache.addAll(SHELL.map(local));
      try {
        const response = await fetch(local("offline-assets.json"), {
          cache: "no-store",
        });
        if (response.ok) {
          const paths = await response.json();
          const small = paths.filter(
            (p) => !p.startsWith("/recognition/models/"),
          );
          for (const path of small) await cache.add(local(path));
        }
      } catch (e) {
        console.warn("Optional asset precache interrupted", e);
      }
    })(),
  ),
);
self.addEventListener("activate", (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith(SHELL_PREFIX) && key !== SHELL_CACHE) {
          await caches.delete(key);
          await caches.delete(OFFLINE);
        }
      await self.clients.claim();
    })(),
  ),
);
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("fetch", (event) => {
  const req = event.request,
    url = new URL(req.url);
  if (
    req.method !== "GET" ||
    url.origin !== self.location.origin ||
    !url.pathname.startsWith(BASE.pathname) ||
    url.pathname.startsWith("/@") ||
    url.pathname.startsWith("/src/") ||
    url.pathname.includes("node_modules")
  )
    return;
  // OMR handles range requests and resumable model caching itself.
  if (url.pathname.startsWith(BASE.pathname + "recognition/models/")) return;
  event.respondWith(
    (async () => {
      const canonical = new URL(url.pathname, url.origin).href;
      const shell = await caches.open(SHELL_CACHE),
        offline = await caches.open(OFFLINE);
      if (req.mode === "navigate") {
        try {
          const response = await fetch(req);
          if (response.ok) await shell.put(req, response.clone());
          return response;
        } catch {
          return (
            (await shell.match(req)) ||
            (await shell.match(local("index.html"))) ||
            Response.error()
          );
        }
      }
      const cached =
        (await offline.match(canonical)) || (await shell.match(canonical));
      if (cached) return cached;
      const response = await fetch(req);
      if (
        response.ok &&
        !url.search &&
        !url.pathname.startsWith("/validate") &&
        !url.pathname.endsWith(".map")
      ) {
        try {
          await shell.put(canonical, response.clone());
        } catch {}
      }
      return response;
    })(),
  );
});
