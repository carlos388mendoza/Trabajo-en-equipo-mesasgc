// El plano por defecto de cada restaurante: la zona que se abre al entrar en
// el editor y en el plano en vivo.
//
// Lo eligen los usuarios del restaurante (y el admin) desde el editor, con
// `editor:guardar`. Solo puede haber una por restaurante: lo garantiza el
// índice único parcial `table_layouts_one_default_idx`. Por eso se desmarca
// la anterior ANTES de marcar la nueva, en un mismo batch.
//
// Sin nada de Next: lo llaman la server action del editor y `verify:editor`.

import { and, asc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { tableLayouts } from "@/lib/db/schema";

export type DefaultLayoutResult = { ok: true; name: string } | { ok: false; error: string };

/** Marca esta zona como el plano por defecto de su restaurante. */
export async function setDefaultLayout(input: { restaurantId: string; layoutId: string }): Promise<DefaultLayoutResult> {
  const [layout] = await db
    .select({ id: tableLayouts.id, name: tableLayouts.name })
    .from(tableLayouts)
    .where(and(eq(tableLayouts.id, input.layoutId), eq(tableLayouts.restaurantId, input.restaurantId)))
    .limit(1);
  if (!layout) return { ok: false, error: "Esa zona no existe en este restaurante." };
  await db.batch([
    db
      .update(tableLayouts)
      .set({ isDefault: false })
      .where(and(eq(tableLayouts.restaurantId, input.restaurantId), eq(tableLayouts.isDefault, true))),
    db.update(tableLayouts).set({ isDefault: true }).where(eq(tableLayouts.id, layout.id)),
  ]);
  return { ok: true, name: layout.name };
}

/**
 * Si el restaurante tiene zonas pero ninguna por defecto (datos viejos, o se
 * borró la que lo era), marca la primera. No crea zonas: un restaurante nuevo
 * ya nace con su «Comedor principal» por defecto (`createRestaurant`).
 *
 * Devuelve el id de la zona por defecto, o null si no tiene ninguna zona.
 */
export async function ensureDefaultLayout(restaurantId: string): Promise<string | null> {
  const zones = await db
    .select({ id: tableLayouts.id, isDefault: tableLayouts.isDefault })
    .from(tableLayouts)
    .where(eq(tableLayouts.restaurantId, restaurantId))
    .orderBy(asc(tableLayouts.sortOrder), asc(tableLayouts.name));
  if (zones.length === 0) return null;
  const current = zones.find((z) => z.isDefault);
  if (current) return current.id;
  await db.update(tableLayouts).set({ isDefault: true }).where(eq(tableLayouts.id, zones[0].id));
  return zones[0].id;
}
