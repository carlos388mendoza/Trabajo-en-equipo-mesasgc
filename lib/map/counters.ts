// Contadores agregados de cada restaurante: lo que pinta el mapa general.
//
// Es lo ÚNICO que viaja por la sala `overview` de Socket.IO: números, sin
// nombres ni ids de clientes. Así el mapa general se puede enseñar a quien ve
// todos los restaurantes (admin, analitica) sin repartir datos personales.
//
// No importa nada de Next: lo usan la página /mapa, `emitOverview` (el
// servidor de Socket.IO) y `scripts/verify-realtime.mts`.

import { and, avg, count, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { ACTIVE_WAITLIST_STATUSES, SEATABLE_ELEMENT_KEYS } from "@/lib/db/enums";
import { elementTypes, tables, waitlistEntries } from "@/lib/db/schema";

export type { RestaurantCounters } from "@/lib/realtime/events";
import type { RestaurantCounters } from "@/lib/realtime/events";

/** Umbrales de la alerta del marcador, en minutos de espera media. */
export const WAIT_WARNING_MIN = 20;
export const WAIT_DANGER_MIN = 40;

export type WaitLevel = "normal" | "alerta" | "critica";

/**
 * Espera media actual en minutos, calculada en el navegador a partir de la
 * llegada media: así sigue subiendo sola sin que el servidor mande nada.
 */
export function averageWaitMinutes(counters: Pick<RestaurantCounters, "averageArrivedAt" | "waiting">, now: number): number {
  if (counters.waiting === 0 || counters.averageArrivedAt === null) return 0;
  return Math.max(0, Math.floor((now - counters.averageArrivedAt) / 60_000));
}

export function waitLevel(minutes: number): WaitLevel {
  if (minutes > WAIT_DANGER_MIN) return "critica";
  if (minutes > WAIT_WARNING_MIN) return "alerta";
  return "normal";
}

function empty(restaurantId: string): RestaurantCounters {
  return {
    restaurantId,
    tablesTotal: 0,
    tablesOccupied: 0,
    tablesReserved: 0,
    waiting: 0,
    averageArrivedAt: null,
  };
}

/**
 * Contadores de varios restaurantes (o de todos, sin `ids`). Dos consultas
 * agrupadas, no una por restaurante: el mapa las pide todas a la vez.
 */
export async function getCounters(ids?: string[]): Promise<RestaurantCounters[]> {
  if (ids && ids.length === 0) return [];

  const tableRows = await db
    .select({
      restaurantId: tables.restaurantId,
      total: count(),
      occupied: sql<number>`sum(case when ${tables.currentEntryId} is not null then 1 else 0 end)`,
      reserved: sql<number>`sum(case when ${tables.currentEntryId} is null and ${tables.status} = 'reservada' then 1 else 0 end)`,
    })
    .from(tables)
    .innerJoin(elementTypes, eq(elementTypes.id, tables.elementTypeId))
    .where(
      and(
        inArray(elementTypes.key, [...SEATABLE_ELEMENT_KEYS]),
        ids ? inArray(tables.restaurantId, ids) : undefined,
      ),
    )
    .groupBy(tables.restaurantId);

  const waitRows = await db
    .select({
      restaurantId: waitlistEntries.restaurantId,
      waiting: count(),
      averageArrivedAt: avg(waitlistEntries.arrivedAt),
    })
    .from(waitlistEntries)
    .where(
      and(
        inArray(waitlistEntries.status, [...ACTIVE_WAITLIST_STATUSES]),
        ids ? inArray(waitlistEntries.restaurantId, ids) : undefined,
      ),
    )
    .groupBy(waitlistEntries.restaurantId);

  const byId = new Map<string, RestaurantCounters>();
  const get = (id: string) => {
    let row = byId.get(id);
    if (!row) byId.set(id, (row = empty(id)));
    return row;
  };
  for (const id of ids ?? []) get(id);
  for (const r of tableRows) {
    const row = get(r.restaurantId);
    row.tablesTotal = Number(r.total);
    row.tablesOccupied = Number(r.occupied ?? 0);
    row.tablesReserved = Number(r.reserved ?? 0);
  }
  for (const r of waitRows) {
    const row = get(r.restaurantId);
    row.waiting = Number(r.waiting);
    // `avg` de SQLite devuelve texto con decimales: se redondea al ms.
    row.averageArrivedAt = r.averageArrivedAt === null ? null : Math.round(Number(r.averageArrivedAt));
  }
  return [...byId.values()];
}

/** Contadores de un restaurante. Existe o no, siempre devuelve una fila. */
export async function getRestaurantCounters(restaurantId: string): Promise<RestaurantCounters> {
  const [row] = await getCounters([restaurantId]);
  return row ?? empty(restaurantId);
}

/**
 * Contadores con la espera media ya calculada «ahora», para páginas del
 * servidor que no se actualizan en vivo (/inicio). El mapa, en cambio, la
 * calcula en el navegador para que avance sola.
 */
export async function getCountersWithWait(ids: string[], now = Date.now()): Promise<(RestaurantCounters & { minutes: number })[]> {
  return (await getCounters(ids)).map((c) => ({ ...c, minutes: averageWaitMinutes(c, now) }));
}
