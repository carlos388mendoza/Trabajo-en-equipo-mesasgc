// Lectura de «Ver clientes»: los clientes de un restaurante en un rango (hoy,
// 7 días, 30 días o todos, en hora de Honduras), con quién los resolvió. Sin
// nada de Next, para probarla desde `verify:realtime`.
//
// `queryWaitlistCards` es la que usa la pantalla: filtra en el SERVIDOR
// (estado, «Ocupando mesa», mesero y nombre sin tildes), pagina de 50 en 50 y
// cuenta cada filtro con una sola consulta agregada. Antes la pantalla traía
// hasta 2000 filas y filtraba en la tablet. `listWaitlistCards` (sin
// paginar) queda para las pruebas.

import { and, desc, eq, gte, inArray, lt, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import { ACTIVE_WAITLIST_STATUSES } from "@/lib/db/enums";
import { tables, user, waitlistEntries } from "@/lib/db/schema";
import { addCalendarDays, hondurasMidnightUtc, hondurasToday } from "@/lib/time/honduras";

import {
  CARD_PAGE_MAX,
  CARD_PAGE_SIZE,
  encodeCardCursor,
  normalizeName,
  type CardCounts,
  type CardFilter,
  type CardRange,
} from "./card-options";
import { snapshot, type WaitlistEntrySnapshot } from "./quick-actions";

export { CARD_RANGES, type CardRange } from "./card-options";

/**
 * Tope de filas por respuesta. Un local con mucho movimiento hace ~200 grupos
 * al día: 7 días caben de sobra, y una base rara no tumba la pantalla.
 */
export const CARD_LIMIT = 2000;

/**
 * Desde qué instante cuenta un rango: medianoche de Honduras de hoy, de hace 6
 * o de hace 29 días; null para «Todos».
 */
export function rangeStart(range: CardRange, now = new Date()): Date | null {
  const today = hondurasToday(now);
  if (range === "todos") return null;
  const back = range === "hoy" ? 0 : range === "7dias" ? 6 : 29;
  return hondurasMidnightUtc(addCalendarDays(today, -back));
}

/**
 * Las cartas del rango, las más recientes primero. Las que siguen esperando
 * salen siempre, aunque hayan llegado antes: son las del montón del modo
 * rápido, y la vista tiene que poder resolverlas.
 */
export async function listWaitlistCards(
  restaurantId: string,
  range: CardRange,
  now = new Date(),
): Promise<WaitlistEntrySnapshot[]> {
  const rows = await db
    .select({ entry: waitlistEntries, resolvedByName: user.name })
    .from(waitlistEntries)
    // Referencia blanda: si el usuario ya no existe, la carta sale sin nombre.
    .leftJoin(user, eq(user.id, waitlistEntries.resolvedByUserId))
    .where(and(
      eq(waitlistEntries.restaurantId, restaurantId),
      or(
        gte(waitlistEntries.arrivedAt, rangeStart(range, now) ?? new Date(0)),
        eq(waitlistEntries.status, "esperando"),
      ),
    ))
    .orderBy(desc(waitlistEntries.arrivedAt))
    .limit(CARD_LIMIT);
  return rows.map(({ entry, resolvedByName }) => snapshot(entry, resolvedByName));
}

export type CardQuery = {
  range: CardRange;
  filter: CardFilter;
  /** Busca por nombre, sin mayúsculas ni tildes. */
  query?: string;
  /** Solo los que atendió ese mesero (`waiter_name`). */
  waiter?: string | null;
  /** La página siguiente: la del cursor que devolvió la anterior. */
  before?: { arrivedAt: number; id: string } | null;
  limit?: number;
};

export type CardPage = {
  entries: WaitlistEntrySnapshot[];
  counts: CardCounts;
  /** Cursor de «Ver más», o null si no hay más. */
  next: string | null;
};

/**
 * Una página de «Ver clientes», con los conteos de cada filtro.
 *
 * Los que siguen en la fila (en espera o listos) y los que ocupan una mesa
 * salen en cualquier rango: son los que hay que poder resolver o liberar,
 * aunque lleven días ahí.
 */
export async function queryWaitlistCards(restaurantId: string, q: CardQuery, now = new Date()): Promise<CardPage> {
  const occupying = sql`${waitlistEntries.id} in (select ${tables.currentEntryId} from ${tables} where ${tables.restaurantId} = ${restaurantId} and ${tables.currentEntryId} is not null)`;
  const start = rangeStart(q.range, now);
  const base: (SQL | undefined)[] = [
    eq(waitlistEntries.restaurantId, restaurantId),
    start ? or(gte(waitlistEntries.arrivedAt, start), inArray(waitlistEntries.status, [...ACTIVE_WAITLIST_STATUSES]), occupying) : undefined,
    q.waiter ? eq(waitlistEntries.waiterName, q.waiter) : undefined,
  ];

  // Búsqueda sin tildes: SQLite no sabe quitarlas, así que se buscan los ids
  // en el servidor con los nombres (columnas ligeras) y se filtra por ellos.
  const needle = normalizeName((q.query ?? "").trim());
  if (needle) {
    const names = await db
      .select({ id: waitlistEntries.id, name: waitlistEntries.customerName })
      .from(waitlistEntries)
      .where(and(...base));
    const ids = names.filter((n) => normalizeName(n.name).includes(needle)).map((n) => n.id);
    if (ids.length === 0) {
      return { entries: [], counts: { todas: 0, esperando: 0, listo: 0, ausente: 0, ocupando: 0 }, next: null };
    }
    base.push(inArray(waitlistEntries.id, ids));
  }

  const [countRow] = await db
    .select({
      todas: sql<number>`count(*)`,
      esperando: sql<number>`coalesce(sum(case when ${waitlistEntries.status} = ${"esperando"} then 1 else 0 end), 0)`,
      listo: sql<number>`coalesce(sum(case when ${waitlistEntries.status} = ${"listo"} then 1 else 0 end), 0)`,
      ausente: sql<number>`coalesce(sum(case when ${waitlistEntries.status} = ${"ausente"} then 1 else 0 end), 0)`,
      ocupando: sql<number>`coalesce(sum(case when ${occupying} then 1 else 0 end), 0)`,
    })
    .from(waitlistEntries)
    .where(and(...base));

  const filter: SQL | undefined =
    q.filter === "todas" ? undefined : q.filter === "ocupando" ? occupying : eq(waitlistEntries.status, q.filter);
  const cursor = q.before
    ? or(
        lt(waitlistEntries.arrivedAt, new Date(q.before.arrivedAt)),
        and(eq(waitlistEntries.arrivedAt, new Date(q.before.arrivedAt)), lt(waitlistEntries.id, q.before.id)),
      )
    : undefined;
  const limit = Math.min(Math.max(1, q.limit ?? CARD_PAGE_SIZE), CARD_PAGE_MAX);
  const rows = await db
    .select({ entry: waitlistEntries, resolvedByName: user.name })
    .from(waitlistEntries)
    .leftJoin(user, eq(user.id, waitlistEntries.resolvedByUserId))
    .where(and(...base, filter, cursor))
    .orderBy(desc(waitlistEntries.arrivedAt), desc(waitlistEntries.id))
    .limit(limit + 1);

  const page = rows.slice(0, limit).map(({ entry, resolvedByName }) => snapshot(entry, resolvedByName));
  const counts: CardCounts = {
    todas: Number(countRow?.todas ?? 0),
    esperando: Number(countRow?.esperando ?? 0),
    listo: Number(countRow?.listo ?? 0),
    ausente: Number(countRow?.ausente ?? 0),
    ocupando: Number(countRow?.ocupando ?? 0),
  };
  return { entries: page, counts, next: rows.length > limit && page.length ? encodeCardCursor(page[page.length - 1]) : null };
}
