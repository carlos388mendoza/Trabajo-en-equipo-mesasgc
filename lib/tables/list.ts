// Mesas de un restaurante para «Sentar» en el modo sencillo: solo las que
// admiten clientes (mesas con sillas o butacas), con su zona, su estado y su
// versión. La decisión de si una mesa sigue libre NO se toma aquí: la toma el
// UPDATE condicional de `assignTable`. Esto es solo lo que se le enseña al
// host, y lo que la tablet guarda para seguir trabajando sin conexión.
//
// Sin nada de Next: lo usa la API y lo prueba `verify:realtime`.

import { asc, desc, eq, inArray, and, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { SEATABLE_ELEMENT_KEYS, type TableStatus } from "@/lib/db/enums";
import { elementTypes, tableLayouts, tables, waiterConfigs, waiterZoneTables, waiterZones } from "@/lib/db/schema";

export type SeatableTable = {
  id: string;
  label: string;
  capacity: number | null;
  status: TableStatus;
  currentEntryId: string | null;
  version: number;
  layoutId: string;
  layoutName: string;
  /** Mesero de la mesa en la configuración activa (y su color), o null. */
  waiterName: string | null;
  waiterColor: string | null;
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
      waiterName: waiterZones.waiterName,
      waiterColor: waiterZones.color,
    })
    .from(tables)
    .innerJoin(elementTypes, eq(elementTypes.id, tables.elementTypeId))
    .innerJoin(tableLayouts, eq(tableLayouts.id, tables.layoutId))
    // Solo el reparto de la configuración ACTIVA (una por restaurante).
    .leftJoin(
      waiterZoneTables,
      and(
        eq(waiterZoneTables.tableId, tables.id),
        sql`exists (select 1 from ${waiterConfigs} where ${waiterConfigs.id} = ${waiterZoneTables.configId} and ${waiterConfigs.isActive} = 1)`,
      ),
    )
    .leftJoin(waiterZones, eq(waiterZones.id, waiterZoneTables.zoneId))
    .where(and(eq(tables.restaurantId, restaurantId), inArray(elementTypes.key, [...SEATABLE_ELEMENT_KEYS])))
    // El plano por defecto primero, y dentro de cada zona por nombre de mesa.
    .orderBy(desc(tableLayouts.isDefault), asc(tableLayouts.sortOrder), asc(tableLayouts.name), asc(tables.label));
  return rows.map((row) => ({ ...row, status: row.status as TableStatus }));
}
