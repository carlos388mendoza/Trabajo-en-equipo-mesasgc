// Service worker del modo sencillo: que la página se pueda RECARGAR sin
// Internet. Los datos (la lista, las mesas y la cola de cambios) no pasan por
// aquí: viven en IndexedDB (`lib/offline/store.ts`).
//
// Qué guarda, y nada más:
//   - la página del modo sencillo (`/restaurante/<id>/rapido`) la última vez
//     que se abrió con red;
//   - los archivos estáticos de Next (`/_next/static/...`), que la página
//     necesita para arrancar;
//   - los logos (`/brand/...`) y los iconos.
//
// Siempre «red primero»: con conexión se usa lo nuevo y se actualiza la copia;
// la copia solo se sirve si la red falla. Así una versión nueva de la app no
// se queda atascada detrás de la caché.
//
// Nunca guarda: la API, el login, los sockets ni ninguna petición que no sea
// GET. La sesión (cookie httpOnly) no la ve ni la toca.

const CACHE = "tw-modo-sencillo-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith("tw-") && name !== CACHE) await caches.delete(name);
      }
      await self.clients.claim();
    })(),
  );
});

function cacheable(url, request) {
  if (request.method !== "GET" || url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/socket.io")) return false;
  if (request.mode === "navigate") return /^\/restaurante\/[^/]+\/rapido\/?$/.test(url.pathname);
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/brand/") ||
    /^\/(icon|apple-icon|favicon)/.test(url.pathname)
  );
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (!cacheable(url, event.request)) return;
  event.respondWith(
    (async () => {
      const cache = await caches.open(CACHE);
      try {
        const response = await fetch(event.request);
        // Solo respuestas buenas y de la propia página: una redirección a
        // /login (sesión vencida) no debe quedar guardada como el modo sencillo.
        if (response.ok && !response.redirected && response.type === "basic") {
          await cache.put(event.request, response.clone());
        }
        return response;
      } catch (error) {
        const copy = await cache.match(event.request, { ignoreVary: true });
        if (copy) return copy;
        throw error;
      }
    })(),
  );
});
