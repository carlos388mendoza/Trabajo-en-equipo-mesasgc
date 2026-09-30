// Consultas de la estructura de mesas.
//
// Todo lo que el editor necesita leer de la base de datos. Vive aquí y no en
// los componentes, para que las Server Components sean solo presentación.

import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { asLayoutRotation } from "@/lib/db/enums";
import {
  elementTypes,
  restaurants,
  tableLayouts,
  tables,
  waitlistEntries,
} from "@/lib/db/schema";
import type { ElementTypeInfo, LayoutPayload, LayoutSummary } from "@/lib/layout/types";

/** Catálogo completo de tipos: alimenta la paleta del editor. */
export async function getElementTypes(): Promise<ElementTypeInfo[]> {
  const rows = await db
    .select()
    .from(elementTypes)
    .orderBy(asc(elementTypes.sortOrder), asc(elementTypes.label));

  return rows.map((t) => ({
    id: t.id,
    key: t.key,
    label: t.label,
    color: t.color,
    icon: t.icon,
    width: t.width,
    height: t.height,
    defaultCapacity: t.defaultCapacity,
  }));
}

/** Zonas de un restaurante, en el orden en que las pinte la galería. */
export async function getLayoutsForRestaurant(
  restaurantId: string,
): Promise<LayoutSummary[]> {
  return db
    .select({
      id: tableLayouts.id,
      name: tableLayouts.name,
      sortOrder: tableLayouts.sortOrder,
      isDefault: tableLayouts.isDefault,
    })
    .from(tableLayouts)
    .where(eq(tableLayouts.restaurantId, restaurantId))
    .orderBy(asc(tableLayouts.sortOrder), asc(tableLayouts.name));
}

/**
 * Una zona con todos sus elementos.
 *
 * `restaurantId` entra en el WHERE aunque no haga falta para el filtro de
 * tablas: es lo que impide que alguien pida la zona de otro restaurante
 * cambiando el id de la URL.
 */
export async function getLayout(
  layoutId: string,
  restaurantId: string,
): Promise<LayoutPayload | null> {
  const layout = await db.query.tableLayouts.findFirst({
    where: and(
      eq(tableLayouts.id, layoutId),
      eq(tableLayouts.restaurantId, restaurantId),
    ),
    // El cliente sentado viaja con la mesa para pintar su nombre y los minutos
    // que lleva. Es solo lectura: el guardado del editor no lo manda.
    with: {
      tables: {
        with: { currentEntry: { columns: { customerName: true, seatedAt: true } } },
      },
    },
  });

  if (!layout) return null;

  return {
    id: layout.id,
    restaurantId: layout.restaurantId,
    name: layout.name,
    width: layout.width,
    height: layout.height,
    version: layout.version,
    rotation: asLayoutRotation(layout.rotation),
    elements: layout.tables.map((t) => ({
      id: t.id,
      elementTypeId: t.elementTypeId,
      label: t.label,
      x: t.x,
      y: t.y,
      width: t.width,
      height: t.height,
      rotation: t.rotation,
      capacity: t.capacity,
      status: t.status,
      currentEntryId: t.currentEntryId,
      ...occupantOf(t.currentEntryId ? t.currentEntry : null),
    })),
  };
}

function occupantOf(
  entry: { customerName: string; seatedAt: Date | null } | null | undefined,
): { occupantName: string | null; seatedAt: number | null } {
  return {
    occupantName: entry?.customerName ?? null,
    // En milisegundos: los datos que van al Client Component son JSON plano.
    seatedAt: entry?.seatedAt ? entry.seatedAt.getTime() : null,
  };
}

/**
 * Quién está sentado en una mesa ahora mismo.
 *
 * La usa el editor cuando un evento en vivo avisa de una asignación: el aviso
 * dice qué cliente es, no cómo se llama. Devuelve null si la mesa no es de
 * ese restaurante o está libre.
 */
export async function getTableOccupant(
  restaurantId: string,
  tableId: string,
): Promise<{ entryId: string; occupantName: string; seatedAt: number | null } | null> {
  const [row] = await db
    .select({
      entryId: waitlistEntries.id,
      customerName: waitlistEntries.customerName,
      seatedAt: waitlistEntries.seatedAt,
    })
    .from(tables)
    .innerJoin(waitlistEntries, eq(waitlistEntries.id, tables.currentEntryId))
    .where(and(eq(tables.id, tableId), eq(tables.restaurantId, restaurantId)))
    .limit(1);
  if (!row) return null;
  return {
    entryId: row.entryId,
    occupantName: row.customerName,
    seatedAt: row.seatedAt ? row.seatedAt.getTime() : null,
  };
}

/** ¿Existe el restaurante? Para distinguir 404 de "aún no tiene zonas". */
export async function restaurantExists(restaurantId: string): Promise<boolean> {
  const row = await db
    .select({ id: restaurants.id })
    .from(restaurants)
    .where(eq(restaurants.id, restaurantId))
    .limit(1);
  return row.length > 0;
}

/**
 * Qué elementoTypeId existen realmente.
 *
 * El editor los saca de `element_types`, pero el guardado vuelve a
 * comprobarlo en el servidor: si alguien manipulase la petición podría
 * colgar un `element_type_id` inventado y romper la integridad referencial.
 */
export async function getValidElementTypeIds(): Promise<Set<string>> {
  const rows = await db.select({ id: elementTypes.id }).from(elementTypes);
  return new Set(rows.map((r) => r.id));
}

/** Devuelve el id de una mesa SOLO si pertenece a esa zona. */
export async function getTablesInLayout(
  layoutId: string,
): Promise<{ id: string; currentEntryId: string | null }[]> {
  return db
    .select({ id: tables.id, currentEntryId: tables.currentEntryId })
    .from(tables)
    .where(eq(tables.layoutId, layoutId));
}

/**
 * De los ids que envía el cliente, cuáles están guardados en OTRA zona.
 *
 * Es la comprobación que impide que alguien mueva la mesa de un restaurante
 * imponiendo su id: el `UPDATE` la encontraría por id y la reescribiría. Se
 * filtra por zona, así que los ids nuevos del editor (que aún no están en
 * ninguna) no salen aquí y sí se pueden crear.
 */
export async function findElementIdsInOtherLayouts(
  layoutId: string,
  candidateIds: string[],
): Promise<string[]> {
  if (candidateIds.length === 0) return [];

  const rows = await db
    .select({ id: tables.id, layoutId: tables.layoutId })
    .from(tables)
    .where(inArray(tables.id, candidateIds));

  return rows.filter((r) => r.layoutId !== layoutId).map((r) => r.id);
}
