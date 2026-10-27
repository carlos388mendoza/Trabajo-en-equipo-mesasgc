// Build en Vercel (`vercel.json` → `buildCommand`).
//
// Sustituye al `preDeployCommand` de Railway: en el despliegue de PRODUCCIÓN
// (`VERCEL_ENV=production`) aplica las migraciones pendientes y el catálogo de
// tipos de elemento ANTES de construir. Si fallan, el build falla y Vercel
// deja la versión anterior en línea: nunca queda código nuevo con una base
// vieja.
//
// En PREVIEW (`VERCEL_ENV=preview`) también aplica migraciones y catálogo,
// PERO con protección: si la URL contiene "mesasgc-prod" el build FALLA para
// evitar usar la base de producción en una vista previa.
//
// En desarrollo local no toca la base.
//
// Solo corre `db:migrate` (las migraciones SQL de `drizzle/`, que son
// aditivas) y `db:catalog` (idempotente). NUNCA `db:push`, `seed` ni
// `seed:reset`: esos borran o inventan datos.
//
// No imprime las variables: drizzle-kit y el catálogo solo dicen el host.

import { spawnSync } from "node:child_process";

function run(command, args) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, { stdio: "inherit", shell: process.platform === "win32" });
  if (result.status !== 0) {
    console.error(`\n✖ Falló «${command} ${args.join(" ")}» (código ${result.status}). No se publica esta versión.`);
    process.exit(result.status ?? 1);
  }
}

const env = process.env.VERCEL_ENV;
const dbUrl = process.env.TURSO_DATABASE_URL || "";

if (env === "production") {
  if (!dbUrl) {
    console.error("✖ Falta TURSO_DATABASE_URL en las variables de Production de Vercel.");
    process.exit(1);
  }
  run("npx", ["drizzle-kit", "migrate"]);
  run("npx", ["tsx", "scripts/db-catalog.mts"]);
} else if (env === "preview") {
  if (!dbUrl) {
    console.error("✖ Falta TURSO_DATABASE_URL en las variables de Preview de Vercel.");
    process.exit(1);
  }
  if (dbUrl.includes("mesasgc-prod")) {
    console.error("✖ PROTECCIÓN: VERCEL_ENV=preview no puede usar la base de producción (mesasgc-prod). Usa la base de preview (mesasgc-preview).");
    process.exit(1);
  }
  run("npx", ["drizzle-kit", "migrate"]);
  run("npx", ["tsx", "scripts/db-catalog.mts"]);
} else {
  console.log(`Entorno «${env ?? "local"}»: sin migraciones (solo se migran en Production/Preview).`);
}

run("npx", ["next", "build"]);
