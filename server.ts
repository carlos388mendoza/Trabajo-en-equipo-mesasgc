// Servidor propio: Next y Socket.IO en el mismo proceso y el mismo puerto.
//
// Hace falta porque Socket.IO necesita un `http.Server` de larga vida al que
// engancharse, y `next start` / `next dev` no lo exponen. Es el patrón de la
// guía oficial (`node_modules/next/dist/docs/01-app/02-guides/custom-server.md`).
// Esa guía avisa de que no se puede combinar con `output: "standalone"`: no lo
// activéis en `next.config.mjs`.
//
// Un solo puerto a propósito: Railway expone uno (`PORT`), y así el navegador
// se conecta al socket en el mismo origen que la página, sin CORS.
//
// Se ejecuta con tsx (`npm run dev`, `npm start`), que respeta los alias `@/`
// del tsconfig. No pasa por el compilador de Next.

import { createServer } from "node:http";

async function main() {
  // `--prod` en vez de `NODE_ENV=production` en el script de npm: esa sintaxis
  // no funciona en Windows.
  const prod = process.argv.includes("--prod") || process.env.NODE_ENV === "production";
  // Tiene que fijarse antes de cargar Next, que decide con ella cómo compilar.
  (process.env as Record<string, string>).NODE_ENV = prod ? "production" : "development";

  const port = Number.parseInt(process.env.PORT ?? "3000", 10);

  // Cuando una server action redirige (el login, cerrar sesión), Next pide la
  // página de destino a su propio servidor para mandarla en la misma
  // respuesta. Sin esta variable arma esa URL con el protocolo que manda el
  // proxy de Railway (`x-forwarded-proto: https`) y el puerto interno, que
  // habla http: el TLS falla («SSL wrong version number», «failed to get
  // redirect response») y cae a una redirección normal, con un viaje más.
  // `next start` la fija igual (`next/dist/server/lib/start-server.js`); un
  // servidor propio como este tiene que hacerlo a mano. Es por loopback: no
  // sale del contenedor.
  process.env.__NEXT_PRIVATE_ORIGIN ??= `http://localhost:${port}`;

  const { default: next } = await import("next");
  const { attachRealtime } = await import("@/lib/realtime/server");

  const httpServer = createServer();
  // `httpServer` le deja a Next engancharse a los upgrades para su HMR. Solo
  // atiende los suyos; los de `/socket.io/` los deja pasar.
  const app = next({ dev: !prod, port, httpServer });
  const handle = app.getRequestHandler();

  // `prepare` también carga `.env.local`, así que la base de datos (que se
  // conecta en el primer uso) ya ve las variables cuando llega un evento.
  await app.prepare();

  httpServer.on("request", (req, res) => {
    void handle(req, res);
  });
  const io = attachRealtime(httpServer);

  httpServer.listen(port, () => {
    console.log(
      `> Table Waitlist en http://localhost:${port} (${prod ? "producción" : "desarrollo"}, Socket.IO activo)`,
    );
  });

  // Railway manda SIGTERM al redesplegar: cerrar los sockets deja que los
  // clientes reconecten al servidor nuevo en vez de esperar un timeout.
  // `io.close` también cierra el `httpServer`.
  const shutdown = () => {
    void io.close(() => process.exit(0));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
