const CACHE = "bit24-real-console-shell-1";
const ASSETS = [
  "/",
  "/style.css",
  "/app.js",
  "/icon.svg",
  "/icon-192.png",
  "/icon-512.png",
  "/manifest.webmanifest",
];
self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (k) => k.startsWith("bit24-real-console-shell-") && k !== CACHE,
            )
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (
    url.origin !== self.location.origin ||
    e.request.method !== "GET" ||
    !ASSETS.includes(url.pathname) ||
    url.search
  )
    return;
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request)));
});
