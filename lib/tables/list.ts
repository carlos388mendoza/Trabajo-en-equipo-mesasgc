// Mesas de un restaurante para «Sentar» en el modo sencillo: solo las que
// admiten clientes (mesas con sillas o butacas), con su zona, su estado y su
// versión. La decisión de si una mesa sigue libre NO se toma aquí: la toma el
// UPDATE condicional de `assignTable`. Esto es solo lo que se le enseña al
// host, y lo que la tablet guarda para seguir trabajando sin conexión.
//
// Sin nada de Next: lo usa la API y lo prueba `verify:realtime`.

import { asc, desc, eq, inArray, and } from "drizzle-orm";

import { db } from "@/lib/db";
import { SEATABLE_ELEMENT_KEYS, type TableStatus } from "@/lib/db/enums";
import { elementTypes, tableLayouts, tables } from "@/lib/db/schema";

export type SeatableTable = {
  id: string;
  label: string;
  capacity: number | null;
  status: TableStatus;
  currentEntryId: string | null;
  version: number;
  layoutId: string;
  layoutName: string;
};

export async function listSeatableTables(restaurantId: string): Promise<SeatableTable[]> {
  const rows = await db
    .select({
      id: tables.id,
      label: tables.label,
      capacity: tables.capacity,
      status: tables.status,
      currentEntryId: tables.currentEntryId,
      version: tables.version,
      layoutId: tables.layoutId,
      layoutName: tableLayouts.name,
    })
    .from(tables)
    .innerJoin(elementTypes, eq(elementTypes.id, tables.elementTypeId))
    .innerJoin(tableLayouts, eq(tableLayouts.id, tables.layoutId))
    .where(and(eq(tables.restaurantId, restaurantId), inArray(elementTypes.key, [...SEATABLE_ELEMENT_KEYS])))
    // El plano por defecto primero, y dentro de cada zona por nombre de mesa.
    .orderBy(desc(tableLayouts.isDefault), asc(tableLayouts.sortOrder), asc(tableLayouts.name), asc(tables.label));
  return rows.map((row) => ({ ...row, status: row.status as TableStatus }));
}
