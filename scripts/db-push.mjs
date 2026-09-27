// Puente para `drizzle-kit push`.
//
// ¿Por qué existe? Porque en drizzle-kit 0.20 el subcomando `push:sqlite` NO
// lee el campo `schema` de `drizzle.config.ts` (a diferencia de
// `generate:sqlite`, que sí lo lee) y aborta con:
//
//     Invalid input  "--schema" is a required field for push:sqlite command
//
// Además, los flags hay que pasarlos literalmente, y la URL de Turso está en
// una variable de entorno. Poner `%TURSO_DATABASE_URL%` en el script de
// package.json funcionaría en Windows pero no en Linux/Railway, así que este
// script los arma una vez y sirve para los tres.
//
// Uso:  npm run db:push

import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";

import { config } from "dotenv";

// Mismo criterio que en Next: primero `.env.local`, luego `.env`.
config({ path: [".env.local", ".env"] });

const url = process.env.TURSO_DATABASE_URL;
if (!url) {
  console.error(
    "Falta TURSO_DATABASE_URL. Copia .env.example a .env.local y llénalo.",
  );
  process.exit(1);
}

// `libsql` cubre los tres casos con el mismo driver: file: en local,
// libsql:// en Turso remoto.
const args = [
  "push:sqlite",
  "--driver",
  "libsql",
  "--url",
  url,
  "--schema",
  "./lib/db/schema.ts",
];

const authToken = process.env.TURSO_AUTH_TOKEN;
if (authToken) args.push("--auth-token", authToken);

// Se resuelve el entrypoint de drizzle-kit y se ejecuta con el mismo Node, en
// vez de llamar a "drizzle-kit" y confiar en el PATH. Motivo: el shim de
// Windows es un .cmd y no se puede lanzar con spawnSync sin `shell: true`, y
// con `shell: true` el script solo funciona si se invoca vía `npm run` (que es
// lo único que añade node_modules/.bin al PATH). Resolviéndolo, el script
// funciona igual de las dos formas y en cualquier sistema.
const require = createRequire(import.meta.url);
// El campo "exports" de drizzle-kit no expone "./bin.cjs", así que se resuelve
// la entrada principal del paquete y se compone la ruta a mano: el binario
// cuelga del mismo directorio.
const drizzleKitBin = path.join(
  path.dirname(require.resolve("drizzle-kit")),
  "bin.cjs",
);

const result = spawnSync(process.execPath, [drizzleKitBin, ...args], {
  stdio: "inherit",
});
process.exit(result.status ?? 1);
