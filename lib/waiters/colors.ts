// El color de cada mesero a partir del nombre que se apuntó en el cliente.
//
// Al sentar a un cliente se guarda `waitlist_entries.waiter_name` (el nombre
// interno del mesero de esa mesa). En pantalla el mesero se reconoce SOLO por
// su color, así que para las estadísticas y la IA hace falta pasar de ese
// nombre a su color: se busca en las configuraciones de meseros del
// restaurante (la activa primero). Las configuraciones nuevas ya llaman a cada
// mesero por su color («Rojo»), que se reconoce aunque no haya configuración.

import { desc, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { waiterConfigs, waiterZones } from "@/lib/db/schema";

import { paletteHexByName } from "./palette";

/** Clave del mapa: restaurante y nombre interno del mesero. */
export const waiterKey = (restaurantId: string, name: string) => `${restaurantId}|${name}`;

/** Restaurante|nombre → color, de las configuraciones de esos restaurantes. */
export async function waiterColorsByName(restaurantIds: readonly string[]): Promise<Map<string, string>> {
  if (restaurantIds.length === 0) return new Map();
  const rows = await db
    .select({ restaurantId: waiterConfigs.restaurantId, name: waiterZones.waiterName, color: waiterZones.color })
    .from(waiterZones)
    .innerJoin(waiterConfigs, eq(waiterConfigs.id, waiterZones.configId))
    .where(inArray(waiterConfigs.restaurantId, [...restaurantIds]))
    .orderBy(desc(waiterConfigs.isActive), asc(waiterConfigs.sortOrder), asc(waiterZones.position));
  const out = new Map<string, string>();
  for (const row of rows) {
    const key = waiterKey(row.restaurantId, row.name);
    if (!out.has(key)) out.set(key, row.color.toLowerCase());
  }
  return out;
}

/** El color de un mesero apuntado en un cliente, o null si ya no se sabe. */
export function colorOf(map: Map<string, string>, restaurantId: string, name: string | null): string | null {
  if (!name) return null;
  return map.get(waiterKey(restaurantId, name)) ?? paletteHexByName(name);
}
