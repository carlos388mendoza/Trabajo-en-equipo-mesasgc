// Servidor para desarrollo local (`npm run dev`) y para alojar la app en un
// servidor propio (`npm start`). En Vercel NO se usa: Vercel sirve el build de
// Next directamente (ver `docs/despliegue-vercel.md`).
//
// Ya no lleva Socket.IO: el tiempo real va por HTTP con sondeo corto
// (`app/api/tiempo-real`, `lib/realtime/client.ts`), que funciona igual aquí
// y en Vercel. Lo que sí añade a `next dev` / `next start` es la tarea diaria
// de retención (en Vercel la hace un cron: `app/api/cron/retencion`).
//
// Es el patrón de la guía oficial
// (`node_modules/next/dist/docs/01-app/02-guides/custom-server.md`), que avisa
// de que no se puede combinar con `output: "standalone"`.
//
// Se ejecuta con tsx (`npm run dev`, `npm start`), que respeta los alias `@/`
// del tsconfig. No pasa por el compilador de Next.

import { createServer } from "node:http";
import { logServerError } from "@/lib/log";

async function main() {
  // `--prod` en vez de `NODE_ENV=production` en el script de npm: esa sintaxis
  // no funciona en Windows.
  const prod = process.argv.includes("--prod") || process.env.NODE_ENV === "production";
  // Tiene que fijarse antes de cargar Next, que decide con ella cómo compilar.
  (process.env as Record<string, string>).NODE_ENV = prod ? "production" : "development";

  const port = Number.parseInt(process.env.PORT ?? "3000", 10);

  // Cuando una server action redirige (el login, cerrar sesión), Next pide la
  // página de destino a su propio servidor para mandarla en la misma
  // respuesta. Sin esta variable, detrás de un proxy con https, arma esa URL
  // con `x-forwarded-proto: https` y el puerto interno, que habla http: el TLS
  // falla y cae a una redirección normal, con un viaje más.
  // `next start` la fija igual (`next/dist/server/lib/start-server.js`); un
  // servidor propio como este tiene que hacerlo a mano. Es por loopback: no
  // sale del contenedor.
  process.env.__NEXT_PRIVATE_ORIGIN ??= `http://localhost:${port}`;

  const { default: next } = await import("next");

  const httpServer = createServer();
  // `httpServer` le deja a Next engancharse a los upgrades para su HMR.
  const app = next({ dev: !prod, port, httpServer });
  const handle = app.getRequestHandler();

  // `prepare` también carga `.env.local`, así que la base de datos (que se
  // conecta en el primer uso) ya ve las variables cuando llega un evento.
  await app.prepare();

  httpServer.on("request", (req, res) => {
    void handle(req, res);
  });
  httpServer.listen(port, () => {
    console.log(`> Table Waitlist en http://localhost:${port} (${prod ? "producción" : "desarrollo"})`);
  });

  // Retención del historial de clientes (/admin → «Configuración»; por
  // defecto, 1 año): un minuto después de arrancar y luego una vez al día. Solo
  // anonimiza (nombre, teléfono y nota), nunca borra filas ni cifras; ver
  // `lib/settings/privacy.ts`. Si falla, se apunta en el log y se reintenta al
  // día siguiente: la app sigue igual. `unref`: no impide cerrar el proceso.
  // `RETENTION_JOB=off` solo lo usan las pruebas que levantan este servidor
  // (`verify:auth`, `verify:browser`): escriben en la misma base SQLite a la
  // vez y el UPDATE de la retención la bloquearía. Ellas la prueban llamándola.
  if (process.env.RETENTION_JOB !== "off") {
    const { anonymizeExpiredEntries } = await import("@/lib/settings/privacy");
    const runRetention = () => {
      anonymizeExpiredEntries()
        .then((run) => console.log(`> Retención (${run.retention}): ${run.anonymized} cliente(s) anonimizado(s)`))
        .catch((err) => logServerError("[retención] no se pudo aplicar", err));
    };
    setTimeout(runRetention, 60_000).unref();
    setInterval(runRetention, 24 * 60 * 60 * 1000).unref();
  }

  const shutdown = () => {
    httpServer.close(() => process.exit(0));
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
}

main().catch((err) => {
  logServerError("[servidor] no pudo arrancar", err);
  process.exit(1);
});
