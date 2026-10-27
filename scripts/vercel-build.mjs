// Build en Vercel (`vercel.json` → `buildCommand`).
//
// Sustituye al `preDeployCommand` de Railway: en el despliegue de PRODUCCIÓN
// (`VERCEL_ENV=production`) aplica las migraciones pendientes y el catálogo de
// tipos de elemento ANTES de construir. Si fallan, el build falla y Vercel
// deja la versión anterior en línea: nunca queda código nuevo con una base
// vieja. En las vistas previas (PR, ramas) no toca ninguna base.
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
if (env === "production") {
  if (!process.env.TURSO_DATABASE_URL) {
    console.error("✖ Falta TURSO_DATABASE_URL en las variables de Production de Vercel.");
    process.exit(1);
  }
  run("npx", ["drizzle-kit", "migrate"]);
  run("npx", ["tsx", "scripts/db-catalog.mts"]);
} else {
  console.log(`Entorno «${env ?? "local"}»: sin migraciones (solo se migran en Production).`);
}

run("npx", ["next", "build"]);
