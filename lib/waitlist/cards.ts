// Lectura de «Ver todas las cartas»: todos los clientes de un restaurante en
// un rango (hoy o los últimos 7 días, en hora de Honduras), con quién los
// resolvió. Sin nada de Next, para probarla desde `verify:realtime`.

import { and, desc, eq, gte, or } from "drizzle-orm";

import { db } from "@/lib/db";
import { user, waitlistEntries } from "@/lib/db/schema";
import { addCalendarDays, hondurasMidnightUtc, hondurasToday } from "@/lib/time/honduras";

import { snapshot, type WaitlistEntrySnapshot } from "./quick-actions";

export const CARD_RANGES = ["hoy", "7dias"] as const;
export type CardRange = (typeof CARD_RANGES)[number];

/**
 * Tope de filas por respuesta. Un local con mucho movimiento hace ~200 grupos
 * al día: 7 días caben de sobra, y una base rara no tumba la pantalla.
 */
export const CARD_LIMIT = 2000;

/** Desde qué instante cuenta un rango: medianoche de Honduras de hoy o de hace 6 días. */
export function rangeStart(range: CardRange, now = new Date()): Date {
  const today = hondurasToday(now);
  return hondurasMidnightUtc(range === "hoy" ? today : addCalendarDays(today, -6));
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
        gte(waitlistEntries.arrivedAt, rangeStart(range, now)),
        eq(waitlistEntries.status, "esperando"),
      ),
    ))
    .orderBy(desc(waitlistEntries.arrivedAt))
    .limit(CARD_LIMIT);
  return rows.map(({ entry, resolvedByName }) => snapshot(entry, resolvedByName));
}
