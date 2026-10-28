// Registro de avisos en la base: el «Socket.IO» de cuando no hay servidor
// propio (Vercel).
//
// Antes, un aviso («la Mesa 3 se ocupó») se mandaba a la room de Socket.IO,
// que vivía en la memoria de UN proceso. En Vercel hay varias instancias, se
// apagan solas y no dejan conexiones abiertas más de 300 s, así que el aviso se
// guarda aquí (`realtime_events`) y cada pantalla pregunta cada pocos segundos
// «¿qué hay después del aviso N?» (`lib/realtime/client.ts`). Vale igual con
// una instancia o con diez, y en local con `npm run dev`.
//
// Los avisos solo se guardan `EVENT_RETENTION_MS`: una pantalla que estuvo más
// tiempo sin preguntar recibe `reset` y lo vuelve a cargar todo.

import { and, asc, eq, gt, inArray, lt, max, min } from "drizzle-orm";

import { db } from "@/lib/db";
import { realtimeEvents } from "@/lib/db/schema";

/** Cuánto se guarda cada aviso. Más que de sobra para el sondeo de 2–15 s. */
export const EVENT_RETENTION_MS = 10 * 60 * 1000;
/** Como mucho, cuántos avisos se devuelven de una vez. */
const MAX_BATCH = 200;

export type BusEvent = { id: number; event: string; args: unknown[] };

/**
 * Guarda uno o varios avisos para una sala. Se ESPERA (no va en segundo
 * plano): sin servidor propio, lo que no se guardó antes de contestar se
 * puede perder al congelarse la función.
 */
export async function publish(room: string, events: { event: string; args: unknown[] }[]): Promise<void> {
  if (events.length === 0) return;
  const now = new Date();
  await db.insert(realtimeEvents).values(events.map(({ event, args }) => ({ room, event, payload: JSON.stringify(args), createdAt: now })));
  // De vez en cuando se borran los viejos: la tabla se queda pequeña.
  if (Math.random() < 0.05) await prune(now.getTime());
}

export async function prune(now = Date.now()): Promise<void> {
  await db.delete(realtimeEvents).where(lt(realtimeEvents.createdAt, new Date(now - EVENT_RETENTION_MS)));
}

/** El último aviso guardado (de cualquier sala): desde ahí empieza a escuchar quien entra. */
export async function currentCursor(): Promise<number> {
  const [row] = await db.select({ id: max(realtimeEvents.id) }).from(realtimeEvents);
  return row?.id ?? 0;
}

/**
 * Los avisos de estas salas después de `after`. `reset: true` si desde
 * `after` se borraron avisos que esta pantalla no vio: tiene que recargar.
 */
export async function readSince(
  rooms: string[],
  after: number,
): Promise<{ events: BusEvent[]; cursor: number; reset: boolean }> {
  const [bounds] = await db.select({ first: min(realtimeEvents.id), last: max(realtimeEvents.id) }).from(realtimeEvents);
  const first = bounds?.first ?? null;
  const last = bounds?.last ?? 0;
  // Se borraron avisos posteriores a `after` antes de que esta pantalla los
  // viera (o la tabla se vació entera y `after` es de antes).
  if (after > last || (first !== null && after < first - 1)) {
    return { events: [], cursor: last, reset: after !== 0 };
  }
  if (rooms.length === 0) return { events: [], cursor: last, reset: false };
  const rows = await db
    .select({ id: realtimeEvents.id, event: realtimeEvents.event, payload: realtimeEvents.payload })
    .from(realtimeEvents)
    .where(and(inArray(realtimeEvents.room, rooms), gt(realtimeEvents.id, after)))
    .orderBy(asc(realtimeEvents.id))
    .limit(MAX_BATCH);
  const events = rows.map((row) => ({ id: row.id, event: row.event, args: JSON.parse(row.payload) as unknown[] }));
  // Si hubo más de los que caben, el cursor se queda en el último devuelto y
  // la siguiente pregunta trae el resto; si no, salta al último de la tabla.
  const lastSeen = events.length > 0 ? events[events.length - 1].id : 0;
  const cursor = events.length === MAX_BATCH ? lastSeen : Math.max(last, lastSeen);
  return { events, cursor, reset: false };
}

/** Solo para las pruebas. */
export async function clearBusForTests(room?: string): Promise<void> {
  await (room ? db.delete(realtimeEvents).where(eq(realtimeEvents.room, room)) : db.delete(realtimeEvents));
}
