// Respaldo de la base (Turso / libSQL) a un archivo SQLite, SOLO LEYENDO.
//
//   npm run db:respaldo -- <archivo-destino.db>
//   & "$(npm prefix -g)\railway.cmd" run npm run db:respaldo -- C:\ruta\respaldo.db   (producción)
//
// Lee la base de `TURSO_DATABASE_URL` (con `railway run`, la de producción)
// y copia el esquema y todas las filas a un archivo SQLite NUEVO. Con la base
// de origen solo hace `SELECT` (nunca escribe en ella): sirve en Windows sin la
// CLI de Turso. El archivo resultante se restaura desde la web de Turso
// («Create database» → «Import» / «From file») o con
// `turso db create <nombre> --from-file respaldo.db`; ver `docs/respaldos.md`.
//
// OJO: el archivo tiene los datos REALES de los clientes. No se sube al
// repositorio (la carpeta `respaldos/` está en .gitignore) ni se manda por
// chat: se guarda en un sitio privado y se borra cuando ya no hace falta.
//
// Al terminar imprime cuántas filas tiene cada tabla en el origen y en la
// copia: tienen que coincidir.

import { existsSync } from "node:fs";
import { resolve } from "node:path";

import { createClient, type InValue } from "@libsql/client";

const destino = process.argv[2];
if (!destino) {
  console.error("Uso: npm run db:respaldo -- <archivo-destino.db>");
  process.exit(2);
}
const ruta = resolve(destino);
if (existsSync(ruta)) {
  console.error(`Ya existe ${ruta}: elige otro nombre (el respaldo nunca pisa un archivo).`);
  process.exit(2);
}
const url = process.env.TURSO_DATABASE_URL;
if (!url) {
  console.error("Falta TURSO_DATABASE_URL (en producción, corre el comando con `railway run`).");
  process.exit(2);
}
if (url.startsWith("file:") && resolve(url.slice(5)) === ruta) {
  console.error("El origen y el destino son el mismo archivo.");
  process.exit(2);
}

const origen = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN || undefined });
const copia = createClient({ url: `file:${ruta}` });

/** Con el origen solo se lee: si alguna vez se intenta otra cosa, se para. */
async function leer(sql: string, args: InValue[] = []) {
  if (!/^\s*(select|pragma)\b/i.test(sql)) throw new Error(`Solo lectura: no se ejecuta «${sql.slice(0, 40)}» en el origen`);
  return origen.execute({ sql, args });
}

const objetos = (
  await leer(
    "select type, name, tbl_name, sql from sqlite_master where sql is not null and name not like 'sqlite_%' and name not like '_litestream%' and name not like 'libsql_%' order by case type when 'table' then 0 when 'index' then 1 else 2 end, name",
  )
).rows as unknown as { type: string; name: string; tbl_name: string; sql: string }[];
const tablas = objetos.filter((o) => o.type === "table").map((o) => o.name);

// El esquema tal cual está en el origen (incluida la tabla de migraciones de
// drizzle): así la copia se restaura sin pasos extra.
await copia.execute("pragma foreign_keys = off");
for (const o of objetos.filter((x) => x.type === "table")) await copia.execute(o.sql);

const LOTE = 200;
const conteos: { tabla: string; origen: number; copia: number }[] = [];
for (const tabla of tablas) {
  const q = `"${tabla.replaceAll('"', '""')}"`;
  const total = Number((await leer(`select count(*) as n from ${q}`)).rows[0].n);
  const columnas = ((await leer(`pragma table_info(${q})`)).rows as unknown as { name: string }[]).map((c) => c.name);
  const lista = columnas.map((c) => `"${c.replaceAll('"', '""')}"`).join(", ");
  const marcas = columnas.map(() => "?").join(", ");
  for (let desde = 0; desde < total; desde += LOTE) {
    const filas = (await leer(`select ${lista} from ${q} order by rowid limit ? offset ?`, [LOTE, desde])).rows;
    await copia.batch(
      filas.map((fila) => ({ sql: `insert into ${q} (${lista}) values (${marcas})`, args: columnas.map((c) => fila[c] as InValue) })),
      "write",
    );
  }
  const enCopia = Number((await copia.execute(`select count(*) as n from ${q}`)).rows[0].n);
  conteos.push({ tabla, origen: total, copia: enCopia });
}
for (const o of objetos.filter((x) => x.type !== "table")) await copia.execute(o.sql);
await copia.execute("pragma foreign_keys = on");

console.table(conteos);
const distintas = conteos.filter((c) => c.origen !== c.copia);
origen.close();
copia.close();
if (distintas.length) {
  console.error(`No coinciden: ${distintas.map((c) => c.tabla).join(", ")}`);
  process.exit(1);
}
console.log(`Respaldo listo en ${ruta}: ${tablas.length} tablas, ${conteos.reduce((a, c) => a + c.copia, 0)} filas. Tiene datos REALES: guárdalo en un sitio privado.`);
