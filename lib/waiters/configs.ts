// Zonas de meseros: lectura y escritura de las configuraciones.
//
// Un restaurante guarda varias configuraciones («2 meseros», «3 meseros»…) y
// UNA está activa. Cada una reparte sus mesas entre N meseros, cada uno con
// nombre y color. La activa decide de qué color sale cada mesa en el plano en
// vivo y qué mesero se apunta al sentar a un cliente (`waiterForTable`).
//
// Sin nada de Next: la llaman las server actions de `app/restaurante/[id]/
// meseros-actions.ts` (que antes comprueban `meseros:gestionar`) y la prueba
// `verify:editor`. Las reglas que no se fían del navegador están aquí:
//
//  - la configuración tiene que ser de ESTE restaurante;
//  - las mesas también, y tienen que ser mesas (no un baño ni una pared);
//  - las zonas que llegan son exactamente las de la configuración;
//  - bloqueo optimista con `version`: si otra tablet guardó antes, se avisa
//    en vez de pisar su reparto.
//
// Nunca toca `tables`: el reparto de meseros vive aparte y no cambia ni la
// estructura ni la ocupación.

import { randomUUID } from "node:crypto";

import { type SQLWrapper, and, asc, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { SEATABLE_ELEMENT_KEYS } from "@/lib/db/enums";
import {
  elementTypes,
  restaurants,
  tableLayouts,
  tables,
  waiterConfigs,
  waiterZoneTables,
  waiterZones,
} from "@/lib/db/schema";

import { MAX_WAITERS, WAITER_COLORS, autoBalance, defaultConfigName, defaultWaiterName } from "./balance";

/** Tope de configuraciones guardadas por restaurante. */
export const MAX_CONFIGS = 12;

export type WaiterZone = {
  id: string;
  position: number;
  waiterName: string;
  color: string;
  tableIds: string[];
};

export type WaiterConfig = {
  id: string;
  name: string;
  waiterCount: number;
  isActive: boolean;
  version: number;
  isDemo: boolean;
  zones: WaiterZone[];
};

/** Lo que el plano pinta en cada mesa: su mesero en la configuración activa. */
export type WaiterMark = { zoneId: string; waiterName: string; color: string; position: number };

export type WaiterResult<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

const CONFLICT = "Otro dispositivo cambió esta configuración. Se recargó con lo último guardado.";
const NOT_FOUND = "Esa configuración de meseros no existe en este restaurante.";

/** Todas las configuraciones de un restaurante, con sus zonas y mesas. */
export async function listWaiterConfigs(restaurantId: string): Promise<WaiterConfig[]> {
  const configs = await db
    .select()
    .from(waiterConfigs)
    .where(eq(waiterConfigs.restaurantId, restaurantId))
    .orderBy(asc(waiterConfigs.waiterCount), asc(waiterConfigs.sortOrder), asc(waiterConfigs.name));
  if (configs.length === 0) return [];
  const ids = configs.map((c) => c.id);
  const [zones, links] = await Promise.all([
    db.select().from(waiterZones).where(inArray(waiterZones.configId, ids)).orderBy(asc(waiterZones.position)),
    db.select().from(waiterZoneTables).where(inArray(waiterZoneTables.configId, ids)),
  ]);
  const tablesByZone = new Map<string, string[]>();
  for (const link of links) {
    const list = tablesByZone.get(link.zoneId) ?? [];
    list.push(link.tableId);
    tablesByZone.set(link.zoneId, list);
  }
  return configs.map((c) => ({
    id: c.id,
    name: c.name,
    waiterCount: c.waiterCount,
    isActive: c.isActive,
    version: c.version,
    isDemo: c.isDemo,
    zones: zones
      .filter((z) => z.configId === c.id)
      .map((z) => ({
        id: z.id,
        position: z.position,
        waiterName: z.waiterName,
        color: z.color,
        tableIds: (tablesByZone.get(z.id) ?? []).sort(),
      })),
  }));
}

/** Mesa → mesero de la configuración activa. Vacío si no hay ninguna activa. */
export async function getActiveWaiterMarks(restaurantId: string): Promise<Record<string, WaiterMark>> {
  const rows = await db
    .select({
      tableId: waiterZoneTables.tableId,
      zoneId: waiterZones.id,
      waiterName: waiterZones.waiterName,
      color: waiterZones.color,
      position: waiterZones.position,
    })
    .from(waiterZoneTables)
    .innerJoin(waiterZones, eq(waiterZones.id, waiterZoneTables.zoneId))
    .innerJoin(waiterConfigs, eq(waiterConfigs.id, waiterZoneTables.configId))
    .where(and(eq(waiterConfigs.restaurantId, restaurantId), eq(waiterConfigs.isActive, true)));
  const out: Record<string, WaiterMark> = {};
  for (const { tableId, ...mark } of rows) out[tableId] = mark;
  return out;
}

/**
 * Subconsulta SQL con el nombre del mesero que atiende una mesa ahora (el de
 * la configuración activa), o NULL. La usa `assignTable` dentro del mismo
 * UPDATE que sienta al cliente: así el mesero apuntado es el de ESE instante,
 * sin una lectura previa que pudiera quedarse vieja.
 */
export function waiterNameForTableSql(tableId: string | SQLWrapper) {
  return sql<string | null>`(select ${waiterZones.waiterName} from ${waiterZoneTables}
    inner join ${waiterZones} on ${waiterZones.id} = ${waiterZoneTables.zoneId}
    inner join ${waiterConfigs} on ${waiterConfigs.id} = ${waiterZoneTables.configId}
    where ${waiterZoneTables.tableId} = ${tableId} and ${waiterConfigs.isActive} = 1 limit 1)`;
}

/** Mesas de un restaurante (solo las sentables), con su posición para repartir. */
async function seatableTablesForBalance(restaurantId: string) {
  return db
    .select({ id: tables.id, layoutId: tables.layoutId, x: tables.x, y: tables.y, sortOrder: tableLayouts.sortOrder, isDefault: tableLayouts.isDefault })
    .from(tables)
    .innerJoin(elementTypes, eq(elementTypes.id, tables.elementTypeId))
    .innerJoin(tableLayouts, eq(tableLayouts.id, tables.layoutId))
    .where(and(eq(tables.restaurantId, restaurantId), inArray(elementTypes.key, [...SEATABLE_ELEMENT_KEYS])));
}

export type CreateWaiterConfigInput = {
  restaurantId: string;
  waiterCount: number;
  name?: string;
  /** Para los datos de demostración: la configuración sale marcada `is_demo`. */
  demoBatchId?: string;
};

/**
 * Crea una configuración con N meseros («Mesero 1», «Mesero 2»…) y las mesas
 * ya repartidas en bloques equilibrados. Si el restaurante no tenía ninguna
 * activa, esta queda activa: así el plano tiene colores desde el primer día.
 */
export async function createWaiterConfig(input: CreateWaiterConfigInput): Promise<WaiterResult<{ config: WaiterConfig }>> {
  const { restaurantId, waiterCount } = input;
  if (!Number.isInteger(waiterCount) || waiterCount < 1 || waiterCount > MAX_WAITERS) {
    return { ok: false, error: `Elige entre 1 y ${MAX_WAITERS} meseros.` };
  }
  const [restaurant] = await db.select({ id: restaurants.id }).from(restaurants).where(eq(restaurants.id, restaurantId)).limit(1);
  if (!restaurant) return { ok: false, error: "Ese restaurante no existe." };

  const existing = await db
    .select({ id: waiterConfigs.id, isActive: waiterConfigs.isActive, sortOrder: waiterConfigs.sortOrder })
    .from(waiterConfigs)
    .where(eq(waiterConfigs.restaurantId, restaurantId));
  if (existing.length >= MAX_CONFIGS) {
    return { ok: false, error: `Ya hay ${MAX_CONFIGS} configuraciones guardadas. Borra una que no uses.` };
  }

  const list = await seatableTablesForBalance(restaurantId);
  const layoutOrder = [...new Map(
    [...list]
      .sort((a, b) => Number(b.isDefault) - Number(a.isDefault) || a.sortOrder - b.sortOrder)
      .map((t) => [t.layoutId, t.layoutId]),
  ).keys()];
  const balance = autoBalance(list, waiterCount, layoutOrder);

  const configId = randomUUID();
  const zones = Array.from({ length: waiterCount }, (_, i) => ({
    id: randomUUID(),
    configId,
    position: i + 1,
    waiterName: defaultWaiterName(i + 1),
    color: WAITER_COLORS[i % WAITER_COLORS.length],
  }));
  const links = [...balance.entries()].map(([tableId, zone]) => ({ configId, tableId, zoneId: zones[zone].id }));
  const now = new Date();

  // Un batch (una transacción): o se crea todo o nada. Activa solo si el
  // restaurante no tiene ninguna activa EN ESE MOMENTO (lo decide el propio
  // INSERT, no la lectura de arriba, que podría haberse quedado vieja).
  const values = {
    id: configId,
    restaurantId,
    name: input.name?.trim() || defaultConfigName(waiterCount),
    waiterCount,
    isActive: false,
    sortOrder: existing.reduce((max, c) => Math.max(max, c.sortOrder), -1) + 1,
    isDemo: Boolean(input.demoBatchId),
    demoBatchId: input.demoBatchId ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await db.batch([
    db.insert(waiterConfigs).values(values),
    db.insert(waiterZones).values(zones),
    ...(links.length > 0 ? [db.insert(waiterZoneTables).values(links)] : []),
    db
      .update(waiterConfigs)
      .set({ isActive: true })
      .where(
        and(
          eq(waiterConfigs.id, configId),
          sql`not exists (select 1 from ${waiterConfigs} as other where other.restaurant_id = ${restaurantId} and other.is_active = 1)`,
        ),
      ),
  ]);

  const config = (await listWaiterConfigs(restaurantId)).find((c) => c.id === configId)!;
  return { ok: true, config };
}

export type SaveWaiterConfigInput = {
  restaurantId: string;
  configId: string;
  /** La versión que el navegador tenía al empezar a editar. */
  version: number;
  name: string;
  zones: { id: string; waiterName: string; color: string }[];
  /** Mesa → zona. Una mesa que no aparece queda sin mesero. */
  assignments: { tableId: string; zoneId: string }[];
};

/** Guarda nombre, meseros (nombre y color) y el reparto de mesas de una configuración. */
export async function saveWaiterConfig(input: SaveWaiterConfigInput): Promise<WaiterResult<{ version: number }>> {
  const { restaurantId, configId } = input;
  const [config] = await db
    .select({ id: waiterConfigs.id, version: waiterConfigs.version })
    .from(waiterConfigs)
    .where(and(eq(waiterConfigs.id, configId), eq(waiterConfigs.restaurantId, restaurantId)))
    .limit(1);
  if (!config) return { ok: false, error: NOT_FOUND };
  if (config.version !== input.version) return { ok: false, error: CONFLICT };

  // Las zonas: exactamente las de la configuración, ni una más ni una menos.
  const zoneRows = await db.select({ id: waiterZones.id }).from(waiterZones).where(eq(waiterZones.configId, configId));
  const zoneIds = new Set(zoneRows.map((z) => z.id));
  const incoming = new Set(input.zones.map((z) => z.id));
  if (incoming.size !== input.zones.length || incoming.size !== zoneIds.size || [...incoming].some((id) => !zoneIds.has(id))) {
    return { ok: false, error: "Los meseros no coinciden con los de esta configuración. Recarga la página." };
  }

  // Las mesas: de este restaurante, sentables, y cada una una sola vez.
  const tableIds = input.assignments.map((a) => a.tableId);
  if (new Set(tableIds).size !== tableIds.length) {
    return { ok: false, error: "Una mesa no puede tener dos meseros en la misma configuración." };
  }
  if (input.assignments.some((a) => !zoneIds.has(a.zoneId))) {
    return { ok: false, error: "Los meseros no coinciden con los de esta configuración. Recarga la página." };
  }
  if (tableIds.length > 0) {
    const valid = await db
      .select({ id: tables.id })
      .from(tables)
      .innerJoin(elementTypes, eq(elementTypes.id, tables.elementTypeId))
      .where(and(eq(tables.restaurantId, restaurantId), inArray(tables.id, tableIds), inArray(elementTypes.key, [...SEATABLE_ELEMENT_KEYS])));
    if (valid.length !== tableIds.length) {
      return { ok: false, error: "Alguna mesa no es de este restaurante o no admite clientes." };
    }
  }

  // Todo en UN batch: la base lo ejecuta como una sola transacción, sin idas
  // y vueltas (una petición en Turso) y sin que dos tablets que guardan a la
  // vez se bloqueen entre sí, como pasaría con dos transacciones interactivas.
  //
  // La primera sentencia es la que decide: sube la versión solo si sigue
  // siendo la que el navegador tenía, y deja su marca (`save_token`). Las
  // demás solo hacen algo si la marca es ESTA: si otra tablet ganó, la
  // versión ya no coincide, la marca no se escribe y nada de lo suyo se aplica.
  const token = randomUUID();
  const mine = sql`exists (select 1 from ${waiterConfigs} where ${waiterConfigs.id} = ${configId} and ${waiterConfigs.saveToken} = ${token})`;
  const [bumped] = await db.batch([
    db
      .update(waiterConfigs)
      .set({ name: input.name.trim(), version: sql`${waiterConfigs.version} + 1`, saveToken: token, updatedAt: new Date() })
      .where(and(eq(waiterConfigs.id, configId), eq(waiterConfigs.version, input.version)))
      .returning({ version: waiterConfigs.version }),
    ...input.zones.map((zone) =>
      db
        .update(waiterZones)
        .set({ waiterName: zone.waiterName.trim(), color: zone.color.toLowerCase() })
        .where(and(eq(waiterZones.id, zone.id), eq(waiterZones.configId, configId), mine)),
    ),
    db.delete(waiterZoneTables).where(and(eq(waiterZoneTables.configId, configId), mine)),
    // Cada fila del reparto sale de un SELECT sobre la propia configuración
    // filtrada por la marca: sin marca, no hay fila que insertar.
    ...input.assignments.map((a) =>
      db.insert(waiterZoneTables).select(
        db
          .select({
            configId: sql`${configId}`.as("config_id"),
            tableId: sql`${a.tableId}`.as("table_id"),
            zoneId: sql`${a.zoneId}`.as("zone_id"),
          })
          .from(waiterConfigs)
          .where(and(eq(waiterConfigs.id, configId), eq(waiterConfigs.saveToken, token))),
      ),
    ),
  ]);
  if (bumped.length === 0) return { ok: false, error: CONFLICT };
  return { ok: true, version: bumped[0].version };
}

/**
 * Marca una configuración como la activa (y desmarca la anterior). Es el «un
 * toque» del selector «Meseros activos: 2 | 3 | 4».
 *
 * Primero se desmarca y luego se marca, en un batch: el índice único parcial
 * (`waiter_configs_one_active_idx`) no deja dos activas ni un instante.
 */
export async function activateWaiterConfig(input: { restaurantId: string; configId: string }): Promise<WaiterResult<{ name: string }>> {
  const [config] = await db
    .select({ id: waiterConfigs.id, name: waiterConfigs.name })
    .from(waiterConfigs)
    .where(and(eq(waiterConfigs.id, input.configId), eq(waiterConfigs.restaurantId, input.restaurantId)))
    .limit(1);
  if (!config) return { ok: false, error: NOT_FOUND };
  const now = new Date();
  await db.batch([
    db
      .update(waiterConfigs)
      .set({ isActive: false, updatedAt: now })
      .where(and(eq(waiterConfigs.restaurantId, input.restaurantId), eq(waiterConfigs.isActive, true))),
    db.update(waiterConfigs).set({ isActive: true, updatedAt: now }).where(eq(waiterConfigs.id, config.id)),
  ]);
  return { ok: true, name: config.name };
}

/**
 * Borra una configuración (sus zonas y su reparto se van en cascada). Si era
 * la activa, pasa a activa la siguiente que quede, para que el plano no se
 * quede sin meseros por un borrado.
 */
export async function deleteWaiterConfig(input: { restaurantId: string; configId: string }): Promise<WaiterResult> {
  const [config] = await db
    .select({ id: waiterConfigs.id, isActive: waiterConfigs.isActive })
    .from(waiterConfigs)
    .where(and(eq(waiterConfigs.id, input.configId), eq(waiterConfigs.restaurantId, input.restaurantId)))
    .limit(1);
  if (!config) return { ok: false, error: NOT_FOUND };
  // En un batch: borrar y, si se quedó sin activa, activar la primera que
  // quede. La condición va en el UPDATE, así que sirve aunque la borrada no
  // fuera la activa (no hace nada).
  await db.batch([
    db.delete(waiterConfigs).where(eq(waiterConfigs.id, config.id)),
    db
      .update(waiterConfigs)
      .set({ isActive: true })
      .where(
        and(
          eq(
            waiterConfigs.id,
            sql`(select id from ${waiterConfigs} where restaurant_id = ${input.restaurantId} order by waiter_count, sort_order limit 1)`,
          ),
          sql`not exists (select 1 from ${waiterConfigs} as other where other.restaurant_id = ${input.restaurantId} and other.is_active = 1)`,
        ),
      ),
  ]);
  return { ok: true };
}
