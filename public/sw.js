// modScore PWA: same-origin assets only. Projects stay in IndexedDB.
const BASE = new URL("./", self.location.href);
const local = (path) => new URL(path.replace(/^\//, ""), BASE).href;
const VERSION = "modscore-shell-v1";
const SCOPE = encodeURIComponent(BASE.pathname);
const SHELL_PREFIX = "modscore-shell-" + SCOPE + "-";
const SHELL_CACHE = SHELL_PREFIX + VERSION;
const OFFLINE = "modscore-offline-" + SCOPE + "-v1";
const ESSENTIALS = [
  "/", "/index.html", "/manifest.webmanifest",
  "/icon-180.png", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png",
  "/instruments/acoustic_grand_piano.json", "/demos/basic-music.musicxml",
  "/demos/basic-music-source.mp3",
];

self.addEventListener("install", (event) =>
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const manifestUrl = local("offline-assets.json");
    const response = await fetch(manifestUrl, { cache: "no-store" });
    if (!response.ok) throw Error("Offline asset list is unavailable.");
    const paths = await response.clone().json();
    const critical = new Set([
      ...ESSENTIALS,
      ...paths.filter((path) => path.startsWith("/assets/index-") ||
        path.endsWith("/opensheetmusicdisplay.min.js")),
    ]);
    // Never activate a version with an incomplete playback shell.
    await cache.addAll([...critical].map(local));
    await cache.put(manifestUrl, response);
    const optional = paths.filter((path) => !critical.has(path));
    // A failed optional file must not prevent subsequent files being cached.
    for (let i = 0; i < optional.length; i += 4)
      await Promise.allSettled(optional.slice(i, i + 4).map((path) => cache.add(local(path))));
  })()),
);

self.addEventListener("activate", (event) =>
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith(SHELL_PREFIX) && key !== SHELL_CACHE) {
        await caches.delete(key);
        await caches.delete(OFFLINE);
      }
    }
    await self.clients.claim();
  })()),
);
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});

async function mediaRange(request, cached) {
  const range = request.headers.get("Range");
  if (!range || !/^audio\//i.test(cached.headers.get("Content-Type") || "")) return cached;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(range);
  if (!match || (!match[1] && !match[2])) return cached;
  const data = await cached.arrayBuffer();
  const length = data.byteLength;
  const start = match[1] ? Number(match[1]) : Math.max(0, length - Number(match[2]));
  const end = match[1] && match[2] ? Math.min(length - 1, Number(match[2])) : length - 1;
  const headers = new Headers(cached.headers);
  headers.delete("Content-Encoding");
  headers.delete("Content-Length");
  headers.set("Accept-Ranges", "bytes");
  if (start > end || start >= length) {
    headers.set("Content-Range", `bytes */${length}`);
    return new Response(null, { status: 416, headers });
  }
  headers.set("Content-Range", `bytes ${start}-${end}/${length}`);
  headers.set("Content-Length", String(end - start + 1));
  return new Response(data.slice(start, end + 1), { status: 206, headers });
}

self.addEventListener("fetch", (event) => {
  const req = event.request, url = new URL(req.url);
  if (
    req.method !== "GET" || url.origin !== self.location.origin ||
    !url.pathname.startsWith(BASE.pathname) || url.pathname.startsWith("/@") ||
    url.pathname.startsWith("/src/") || url.pathname.includes("node_modules") ||
    url.pathname.startsWith(BASE.pathname + "recognition/models/")
  ) return;
  event.respondWith((async () => {
    const canonical = new URL(url.pathname, url.origin).href;
    const shell = await caches.open(SHELL_CACHE), offline = await caches.open(OFFLINE);
    if (req.mode === "navigate") {
      try {
        const response = await fetch(req);
        if (response.ok) {
          try { await shell.put(req, response.clone()); } catch {}
        }
        return response;
      } catch {
        return (await shell.match(req)) || (await shell.match(local("index.html"))) ||
          new Response("The app is not cached on this device.", { status: 503 });
      }
    }
    const cached = (await offline.match(canonical)) || (await shell.match(canonical));
    if (cached) return mediaRange(req, cached);
    try {
      const response = await fetch(req);
      if (response.ok && response.status !== 206 && !url.search &&
          !url.pathname.startsWith("/validate") && !url.pathname.endsWith(".map")) {
        try { await shell.put(canonical, response.clone()); } catch {}
      }
      return response;
    } catch {
      return new Response("This file is unavailable offline. Reconnect and prepare offline use.", {
        status: 503,
        headers: { "Content-Type": "text/plain; charset=utf-8" },
      });
    }
  })());
});
