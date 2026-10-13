// Borra las zonas de DEMOSTRACIÓN («Comedor (demostración)», `is_demo = 1`)
// de todos los restaurantes, con `deleteZone` (la misma lógica de la app:
// libera antes las mesas ocupadas, conserva los clientes y sus cifras, saca
// las mesas del reparto de meseros y, si era la zona por defecto, pasa a
// serlo el «Comedor principal»).
//
//   npm run db:zonas-demo                      (solo mira: qué se borraría)
//   npm run db:zonas-demo -- --confirmar=BORRAR-ZONAS-DEMO
//
// SOLO toca zonas con `is_demo = 1`: nunca el Comedor principal ni otra zona
// real, ni usuarios, marcas o restaurantes. Los clientes demo se quedan.
// Antes de correrlo en producción: `npm run db:respaldo`.

import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

const { and, eq, inArray, isNotNull, sql } = await import("drizzle-orm");
const { db } = await import("@/lib/db");
const { restaurants, tableLayouts, tables, waiterZoneTables, waitlistEntries } = await import("@/lib/db/schema");
const { deleteZone } = await import("@/lib/layout/delete-zone");

const CONFIRM = "BORRAR-ZONAS-DEMO";

/** Solo el host de la base, para saber dónde se va a escribir (nunca el token). */
function databaseHost(): string {
  const url = process.env.TURSO_DATABASE_URL ?? "";
  try {
    return url.startsWith("file:") ? url : new URL(url).host;
  } catch {
    return "(TURSO_DATABASE_URL no válida)";
  }
}

const zonas = await db
  .select({
    id: tableLayouts.id,
    restaurantId: tableLayouts.restaurantId,
    restaurante: restaurants.name,
    nombre: tableLayouts.name,
    porDefecto: tableLayouts.isDefault,
  })
  .from(tableLayouts)
  .innerJoin(restaurants, eq(restaurants.id, tableLayouts.restaurantId))
  .where(eq(tableLayouts.isDemo, true))
  .orderBy(restaurants.name);

console.log(`Base de datos: ${databaseHost()}`);
console.log(`Zonas de demostración: ${zonas.length}`);
for (const z of zonas) {
  const ids = (await db.select({ id: tables.id }).from(tables).where(eq(tables.layoutId, z.id))).map((t) => t.id);
  const [ocupadas] = await db.select({ n: sql<number>`count(*)` }).from(tables).where(and(eq(tables.layoutId, z.id), isNotNull(tables.currentEntryId)));
  const clientes = ids.length ? (await db.select({ n: sql<number>`count(*)` }).from(waitlistEntries).where(inArray(waitlistEntries.assignedTableId, ids)))[0].n : 0;
  const reparto = ids.length ? (await db.select({ n: sql<number>`count(*)` }).from(waiterZoneTables).where(inArray(waiterZoneTables.tableId, ids)))[0].n : 0;
  console.log(
    `  - ${z.restaurante}: «${z.nombre}» · ${ids.length} mesas, ${Number(ocupadas.n)} ocupadas, ${Number(clientes)} clientes con esa mesa, ${Number(reparto)} en el reparto de meseros${z.porDefecto ? " · ES LA ZONA POR DEFECTO" : ""}`,
  );
}

if (!process.argv.includes(`--confirmar=${CONFIRM}`)) {
  console.log(`\nNo se borró nada. Para borrar: npm run db:zonas-demo -- --confirmar=${CONFIRM}`);
  process.exit(0);
}

let fallos = 0;
for (const z of zonas) {
  const result = await deleteZone({ restaurantId: z.restaurantId, layoutId: z.id });
  if (result.ok) {
    console.log(
      `Borrada «${result.zone}» de ${z.restaurante}: ${result.tables} mesas (${result.released} liberadas antes), ${result.entriesKept} clientes conservados, ${result.waiterLinks} mesas fuera del reparto${result.newDefault ? `; ahora la zona por defecto es «${result.newDefault}»` : ""}.`,
    );
  } else {
    fallos += 1;
    console.log(`NO se borró la de ${z.restaurante}: ${result.error}`);
  }
}
process.exit(fallos ? 1 : 0);
