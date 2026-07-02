const CACHE_NAME = "my-next-bus-shell-v3";
const BASE_PATH = new URL(self.location.href).pathname.replace(/\/sw\.js$/, "");
const appPath = (path) => `${BASE_PATH}${path}`;
const APP_SHELL = [
  appPath("/"),
  appPath("/manifest.webmanifest"),
  appPath("/bus-board-icon.svg"),
  appPath("/bus-board-icon-192.png"),
  appPath("/bus-board-icon-512.png"),
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);

  if (request.method !== "GET" || url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        if (request.mode === "navigate") return caches.match(appPath("/"));
        throw new Error("Offline and resource is not cached");
      }),
  );
});
