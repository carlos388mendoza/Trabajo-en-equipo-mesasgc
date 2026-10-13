// Borrar una zona entera (el plano y sus mesas) de un restaurante.
//
// Hasta ahora la app no borraba zonas: el editor borra mesas, nunca la zona.
// Esta función es la que se usó para quitar los «Comedor (demostración)»
// (ver `scripts/db-borrar-zonas-demo.mts`), con las mismas reglas que el resto
// de la app:
//
//  1. Las mesas ocupadas se liberan PRIMERO con la lógica normal
//     (`releaseTable`, la misma sentencia condicional que «Liberar mesa»).
//  2. Los clientes NO se borran: conservan su historial y sus cifras. Solo se
//     les quita el puntero a una mesa que deja de existir (`assigned_table_id`
//     a null, lo mismo que haría la clave foránea ON DELETE SET NULL).
//  3. Las mesas salen de las configuraciones de meseros (el reparto); las
//     configuraciones y sus meseros se quedan.
//  4. Si era la zona por defecto, pasa a serlo el «Comedor principal» del
//     restaurante (o, si no hay, la primera zona que quede).
//  5. Todo es del MISMO restaurante: la zona se busca con su `restaurant_id`.
//
// No se puede borrar la única zona de un restaurante.
//
// Sin nada de Next: la usan el script y `verify:editor`.

import { and, asc, eq, inArray, isNotNull, ne } from "drizzle-orm";

import { db } from "@/lib/db";
import { tableLayouts, tables, waiterZoneTables, waitlistEntries } from "@/lib/db/schema";
import { releaseTable } from "@/lib/tables/assign";

import { setDefaultLayout } from "./default";

export type DeleteZoneResult =
  | {
      ok: true;
      zone: string;
      /** Mesas borradas con la zona. */
      tables: number;
      /** Mesas que estaban ocupadas y se liberaron antes. */
      released: number;
      /** Clientes que apuntaban a esas mesas (se quedan, sin el puntero). */
      entriesKept: number;
      /** Mesas que salieron del reparto de meseros. */
      waiterLinks: number;
      /** La nueva zona por defecto, si la borrada lo era. */
      newDefault: string | null;
    }
  | { ok: false; error: string };

export async function deleteZone(input: { restaurantId: string; layoutId: string }): Promise<DeleteZoneResult> {
  const { restaurantId, layoutId } = input;
  const [zone] = await db
    .select({ id: tableLayouts.id, name: tableLayouts.name, isDefault: tableLayouts.isDefault })
    .from(tableLayouts)
    .where(and(eq(tableLayouts.id, layoutId), eq(tableLayouts.restaurantId, restaurantId)))
    .limit(1);
  if (!zone) return { ok: false, error: "Esa zona no existe en este restaurante." };

  const others = await db
    .select({ id: tableLayouts.id, name: tableLayouts.name })
    .from(tableLayouts)
    .where(and(eq(tableLayouts.restaurantId, restaurantId), ne(tableLayouts.id, layoutId)))
    .orderBy(asc(tableLayouts.sortOrder), asc(tableLayouts.name));
  if (others.length === 0) return { ok: false, error: "Es la única zona del restaurante: no se puede borrar." };

  // 4. La zona por defecto, antes de borrar (el índice admite una sola).
  let newDefault: string | null = null;
  if (zone.isDefault) {
    const target = others.find((z) => z.name.trim().toLocaleLowerCase("es") === "comedor principal") ?? others[0];
    const result = await setDefaultLayout({ restaurantId, layoutId: target.id });
    if (!result.ok) return result;
    newDefault = target.name;
  }

  // 1. Liberar las ocupadas con la lógica normal.
  const occupied = await db
    .select({ id: tables.id, entryId: tables.currentEntryId })
    .from(tables)
    .where(and(eq(tables.layoutId, layoutId), eq(tables.restaurantId, restaurantId), isNotNull(tables.currentEntryId)));
  let released = 0;
  for (const t of occupied) {
    const result = await releaseTable({ restaurantId, tableId: t.id, entryId: t.entryId! });
    if (!result.ok) return { ok: false, error: `No se pudo liberar una mesa (${result.error}). No se borró la zona.` };
    released += 1;
  }

  const ids = (
    await db
      .select({ id: tables.id })
      .from(tables)
      .where(and(eq(tables.layoutId, layoutId), eq(tables.restaurantId, restaurantId)))
  ).map((t) => t.id);

  // Si alguien sentó a un cliente en una de esas mesas mientras tanto, no se
  // borra nada (se puede volver a correr).
  const [again] = await db
    .select({ id: tables.id })
    .from(tables)
    .where(and(eq(tables.layoutId, layoutId), isNotNull(tables.currentEntryId)))
    .limit(1);
  if (again) return { ok: false, error: "Se ocupó una mesa de esa zona mientras tanto. No se borró nada." };

  // 2 y 3, y el borrado: en un solo batch (todo o nada).
  const [kept, links] = await Promise.all([
    ids.length
      ? db.select({ id: waitlistEntries.id }).from(waitlistEntries).where(inArray(waitlistEntries.assignedTableId, ids))
      : Promise.resolve([]),
    ids.length ? db.select({ id: waiterZoneTables.tableId }).from(waiterZoneTables).where(inArray(waiterZoneTables.tableId, ids)) : Promise.resolve([]),
  ]);
  const statements = [];
  if (ids.length) {
    statements.push(
      db.update(waitlistEntries).set({ assignedTableId: null }).where(inArray(waitlistEntries.assignedTableId, ids)),
      db.delete(waiterZoneTables).where(inArray(waiterZoneTables.tableId, ids)),
      db.delete(tables).where(and(inArray(tables.id, ids), eq(tables.restaurantId, restaurantId))),
    );
  }
  statements.push(db.delete(tableLayouts).where(and(eq(tableLayouts.id, layoutId), eq(tableLayouts.restaurantId, restaurantId))));
  await db.batch(statements as [(typeof statements)[number], ...(typeof statements)[number][]]);

  return { ok: true, zone: zone.name, tables: ids.length, released, entriesKept: kept.length, waiterLinks: links.length, newDefault };
}
