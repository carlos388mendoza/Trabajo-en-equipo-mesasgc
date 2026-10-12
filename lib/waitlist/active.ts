// Lo que carga el modo sencillo al abrir: SOLO lo activo, no el historial.
//
// Antes, `GET /api/restaurante/[id]/clientes` devolvía todos los clientes del
// restaurante desde el primer día (en KFC Boulevard Morazán, 2280 en
// producción y casi 5000 con los datos de prueba: más de 1,5 MB). La tablet
// los descargaba, los recorría en cada render y los guardaba enteros en la
// copia sin conexión a cada cambio: era lo que la trababa.
//
// El modo sencillo solo necesita:
//  - los que siguen en la fila (en espera o listos), lleguen cuando lleguen;
//  - los que ocupan una mesa ahora (para liberarla);
//  - los de HOY, para «Actividad de hoy» (listos y ausentes del día).
// El historial completo se consulta, paginado, en «Ver clientes»
// (`lib/waitlist/cards.ts`).
//
// Sin nada de Next: lo usan la API y `verify:realtime`.

import { and, asc, eq, gte, inArray, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { ACTIVE_WAITLIST_STATUSES } from "@/lib/db/enums";
import { tables, waitlistEntries } from "@/lib/db/schema";
import { hondurasMidnightUtc, hondurasToday } from "@/lib/time/honduras";

import { snapshot, type WaitlistEntrySnapshot } from "./quick-actions";

export async function listQuickModeEntries(restaurantId: string, now = new Date()): Promise<WaitlistEntrySnapshot[]> {
  const rows = await db
    .select()
    .from(waitlistEntries)
    .where(
      and(
        eq(waitlistEntries.restaurantId, restaurantId),
        or(
          inArray(waitlistEntries.status, [...ACTIVE_WAITLIST_STATUSES]),
          gte(waitlistEntries.arrivedAt, hondurasMidnightUtc(hondurasToday(now))),
          sql`${waitlistEntries.id} in (select ${tables.currentEntryId} from ${tables} where ${tables.restaurantId} = ${restaurantId} and ${tables.currentEntryId} is not null)`,
        ),
      ),
    )
    .orderBy(asc(waitlistEntries.arrivedAt));
  return rows.map((entry) => snapshot(entry));
}
