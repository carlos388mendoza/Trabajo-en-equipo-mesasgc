// Levanta una COPIA de la app para medirla, sin tocar la de desarrollo.
//
// Por qué una copia y no `npm run dev`:
//
//  - En desarrollo, React corre en modo estricto (doble render) y Next mete las
//    utilidades de desarrollo en el paquete. Medir ahí mide el desarrollo, no lo
//    que el usuario tiene delante. Los FPS que se publican tienen que ser los
//    de la compilación de producción.
//
//  - Se compila en `.next-perf` (carpeta aparte) porque Next 16 no deja dos
//    servidores en la misma carpeta de salida.
//
//  - Se usa una COPIA de `local.db` (`.perf-editor.db`): la medición mueve
//    mesas, añade y gira, así que la base de desarrollo no debe verse.
//
// Uso:  npx tsx scripts/perf/levantar-perf.mts [--rebuild]

import { spawn, spawnSync } from "node:child_process";
import { copyFileSync, existsSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const PORT = 3100;
const DIST = ".next-perf";
const DB = ".perf-editor.db";

const rebuild = process.argv.includes("--rebuild");

if (rebuild || !existsSync(resolve(DIST, "BUILD_ID"))) {
  console.log(`Compilando para medición en ${DIST}…`);
  const r = spawnSync("npx", ["next", "build"], {
    stdio: "inherit",
    env: { ...process.env, NEXT_DIST_DIR: DIST },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// La base de datos: copia de la de desarrollo, con los mismos usuarios de
// prueba. Si no existe, se parte de cero con el seed.
if (!existsSync(resolve(DB)) || process.argv.includes("--db-nueva")) {
  rmSync(resolve(DB), { force: true });
  if (existsSync(resolve("local.db"))) {
    copyFileSync(resolve("local.db"), resolve(DB));
    console.log(`Copia de local.db → ${DB}`);
  }
}

console.log(`Sirviendo en http://127.0.0.1:${PORT} (Ctrl+C para parar)`);

const child = spawn("npx", ["tsx", "server.ts", "--prod"], {
  stdio: "inherit",
  env: {
    ...process.env,
    PORT: String(PORT),
    NEXT_DIST_DIR: DIST,
    NODE_ENV: "production",
    TURSO_DATABASE_URL: `file:./${DB}`,
    BETTER_AUTH_URL: `http://127.0.0.1:${PORT}`,
    NEXT_PUBLIC_SOCKET_URL: `http://127.0.0.1:${PORT}`,
    // Sin esto, el primer login que llega a /restaurante/[id]/editor con datos
    // vivos abre un socket de producción.
    OPENROUTER_API_KEY: "",
  },
});

process.on("SIGINT", () => {
  child.kill();
  process.exit(0);
});
child.on("exit", (code) => process.exit(code ?? 0));