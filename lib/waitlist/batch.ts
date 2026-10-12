// Acciones en grupo sobre la lista y las mesas, para limpiar lo que se quedó
// colgado (clientes de hace días que siguen «en espera» o en una mesa):
//
//  - `bulkWaitlist`: liberar mesas, marcar ausentes o eliminar varios clientes
//    elegidos en «Ver clientes». Eliminar NUNCA libera mesas: quien está en
//    una mesa no se elimina hasta que alguien la libere a propósito (ver
//    `lib/waitlist/delete-rule.ts`; el servidor lo comprueba antes);
//  - `cleanupStale`: «Limpiar pendientes antiguos» (marca ausentes a los que
//    siguen en la fila y libera las mesas de los sentados con más de X horas);
//  - `releaseAllTables`: «Liberar todas las mesas» del plano en vivo.
//
// Todas son de UN restaurante (el que el servidor sacó de la room, no del
// payload), con condiciones en cada sentencia para no pisar lo que otra
// tablet cambió un instante antes, y todas se pueden DESHACER como cualquier
// otra acción del modo rápido (`undoBatch`).
//
// Estadísticas: marcar ausente y liberar una mesa CONSERVAN la fila y sus
// cifras; eliminar la quita (ese grupo deja de contar).
//
// Sin nada de Next: lo usan el servidor de Socket.IO y las pruebas.

import { and, eq, inArray, isNotNull, lt, notInArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { ACTIVE_WAITLIST_STATUSES, type TableStatus, type WaitlistStatus } from "@/lib/db/enums";
import { tables, waitlistEntries } from "@/lib/db/schema";
import { MAX_BULK, type BulkAction, type CleanupHours } from "@/lib/realtime/events";
import type { TableOccupancy } from "@/lib/tables/assign";

import { registerBatchUndo, snapshot, type WaitlistEntrySnapshot } from "./quick-actions";

export { BULK_ACTIONS, CLEANUP_HOURS, MAX_BULK, type BulkAction, type CleanupHours } from "@/lib/realtime/events";

const FREE: TableStatus = "libre";
const OCCUPIED: TableStatus = "ocupada";

type EntryRow = typeof waitlistEntries.$inferSelect;

/** Una mesa que se liberó (o se volvió a ocupar al deshacer), para avisar a la room. */
export type TableEvent = { table: TableOccupancy; entryId: string };

export type BatchOutcome = {
  /** Para deshacer; null si no cambió nada. */
  actionId: string | null;
  released: TableEvent[];
  /** Marcados ausentes. */
  changed: WaitlistEntrySnapshot[];
  /** Eliminados. */
  removed: WaitlistEntrySnapshot[];
};

/** Lo que guarda «Deshacer» de una acción en grupo. */
export type BatchUndoData = {
  changed: { before: EntryRow; afterUpdatedAt: number }[];
  removed: EntryRow[];
  released: { tableId: string; entryId: string; versionAfter: number }[];
};

/**
 * Libera las mesas que ocupan esos clientes (o TODAS las ocupadas, con
 * `null`). Una sentencia condicional por mesa: si otra tablet la cambió un
 * instante antes (otra versión u otro cliente), esa mesa se deja como está.
 */
async function releaseTablesOf(
  restaurantId: string,
  entryIds: readonly string[] | null,
  occupiedFilter?: ReturnType<typeof sql>,
): Promise<{ events: TableEvent[]; undo: BatchUndoData["released"] }> {
  if (entryIds && entryIds.length === 0) return { events: [], undo: [] };
  const occupied = await db
    .select({ id: tables.id, layoutId: tables.layoutId, entryId: tables.currentEntryId, version: tables.version })
    .from(tables)
    .where(
      and(
        eq(tables.restaurantId, restaurantId),
        entryIds ? inArray(tables.currentEntryId, [...entryIds]) : isNotNull(tables.currentEntryId),
        occupiedFilter,
      ),
    );
  const events: TableEvent[] = [];
  const undo: BatchUndoData["released"] = [];
  for (const t of occupied) {
    if (!t.entryId) continue;
    const [row] = await db
      .update(tables)
      .set({ currentEntryId: null, status: FREE, version: sql`${tables.version} + 1`, updatedAt: new Date() })
      .where(and(eq(tables.id, t.id), eq(tables.restaurantId, restaurantId), eq(tables.currentEntryId, t.entryId), eq(tables.version, t.version)))
      .returning({ version: tables.version, layoutId: tables.layoutId });
    if (!row) continue;
    events.push({ entryId: t.entryId, table: { tableId: t.id, layoutId: row.layoutId, status: FREE, currentEntryId: null, version: row.version } });
    undo.push({ tableId: t.id, entryId: t.entryId, versionAfter: row.version });
  }
  return { events, undo };
}

/** Marca ausentes a los que siguen en la fila (en espera o listos). */
async function markAbsent(
  restaurantId: string,
  where: ReturnType<typeof and>,
  userId: string | null,
): Promise<{ changed: WaitlistEntrySnapshot[]; undo: BatchUndoData["changed"] }> {
  const before = await db
    .select()
    .from(waitlistEntries)
    .where(and(eq(waitlistEntries.restaurantId, restaurantId), inArray(waitlistEntries.status, [...ACTIVE_WAITLIST_STATUSES]), where));
  if (before.length === 0) return { changed: [], undo: [] };
  const now = new Date();
  const after = await db
    .update(waitlistEntries)
    .set({ status: "ausente" satisfies WaitlistStatus, seatedAt: null, resolvedAt: now, resolvedByUserId: userId, updatedAt: now })
    .where(
      and(
        eq(waitlistEntries.restaurantId, restaurantId),
        inArray(waitlistEntries.id, before.map((r) => r.id)),
        inArray(waitlistEntries.status, [...ACTIVE_WAITLIST_STATUSES]),
      ),
    )
    .returning();
  const byId = new Map(before.map((r) => [r.id, r]));
  return {
    changed: after.map((row) => snapshot(row)),
    undo: after.map((row) => ({ before: byId.get(row.id)!, afterUpdatedAt: row.updatedAt.getTime() })),
  };
}

/**
 * Elimina clientes que NO ocupan ninguna mesa. El servidor ya rechazó la orden
 * si alguno estaba en una mesa; esta condición es la red de seguridad para la
 * carrera (alguien lo sentó en el mismo instante): ese no se borra.
 */
async function removeEntries(restaurantId: string, entryIds: readonly string[]): Promise<EntryRow[]> {
  if (entryIds.length === 0) return [];
  const occupiedNow = db
    .select({ id: tables.currentEntryId })
    .from(tables)
    .where(and(eq(tables.restaurantId, restaurantId), isNotNull(tables.currentEntryId)));
  return db
    .delete(waitlistEntries)
    .where(and(eq(waitlistEntries.restaurantId, restaurantId), inArray(waitlistEntries.id, [...entryIds]), notInArray(waitlistEntries.id, occupiedNow)))
    .returning();
}

function finish(
  restaurantId: string,
  label: string,
  released: { events: TableEvent[]; undo: BatchUndoData["released"] },
  absent: { changed: WaitlistEntrySnapshot[]; undo: BatchUndoData["changed"] },
  removed: EntryRow[],
): BatchOutcome {
  const nothing = released.events.length === 0 && absent.changed.length === 0 && removed.length === 0;
  const actionId = nothing
    ? null
    : registerBatchUndo(restaurantId, label, { changed: absent.undo, removed, released: released.undo });
  return { actionId, released: released.events, changed: absent.changed, removed: removed.map((row) => snapshot(row)) };
}

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/**
 * Una acción sobre varios clientes elegidos en «Ver clientes»:
 *  - `liberar`: libera las mesas que ocupan (siguen sentados en el historial);
 *  - `ausente`: marca ausentes a los que siguen en la fila (los demás, igual);
 *  - `eliminar`: los elimina de la lista (solo a los que no están en una mesa).
 */
export async function bulkWaitlist(
  restaurantId: string,
  action: BulkAction,
  entryIds: readonly string[],
  userId: string | null,
  label?: string,
): Promise<BatchOutcome> {
  const ids = [...new Set(entryIds)].slice(0, MAX_BULK);
  const released = action === "liberar" ? await releaseTablesOf(restaurantId, ids) : { events: [], undo: [] };
  const absent = action === "ausente" ? await markAbsent(restaurantId, inArray(waitlistEntries.id, ids), userId) : { changed: [], undo: [] };
  const removed = action === "eliminar" ? await removeEntries(restaurantId, ids) : [];
  const defaultLabel =
    action === "liberar"
      ? `Liberar ${plural(released.events.length, "mesa", "mesas")}`
      : action === "ausente"
        ? `Marcar ausentes a ${plural(absent.changed.length, "cliente", "clientes")}`
        : `Eliminar a ${plural(removed.length, "cliente", "clientes")}`;
  return finish(restaurantId, label ?? defaultLabel, released, absent, removed);
}

/**
 * Qué clientes de esa lista están ahora en una mesa de este restaurante, con
 * el nombre de la mesa (para decir «está en la Mesa 3»). Vacío si ninguno.
 */
export async function occupiedTablesOf(restaurantId: string, entryIds: readonly string[]): Promise<Map<string, string>> {
  if (entryIds.length === 0) return new Map();
  const rows = await db
    .select({ entryId: tables.currentEntryId, label: tables.label })
    .from(tables)
    .where(and(eq(tables.restaurantId, restaurantId), inArray(tables.currentEntryId, [...entryIds])));
  return new Map(rows.filter((r) => r.entryId).map((r) => [r.entryId!, r.label]));
}

/**
 * «Liberar mesa» de UNA mesa (`table:release`, desde «Ver clientes», el
 * plano o la cola sin conexión) también se puede deshacer: vuelve a ocupar la
 * mesa con el mismo cliente si sigue libre. Se guarda como una acción en grupo
 * de una sola mesa.
 */
export async function registerReleaseUndo(restaurantId: string, event: TableEvent): Promise<string> {
  const [row] = await db.select({ label: tables.label }).from(tables).where(eq(tables.id, event.table.tableId)).limit(1);
  return registerBatchUndo(restaurantId, `Liberar ${row?.label ?? "la mesa"}`, {
    changed: [],
    removed: [],
    released: [{ tableId: event.table.tableId, entryId: event.entryId, versionAfter: event.table.version }],
  });
}

function cutoffFor(hours: CleanupHours, now: Date): Date {
  return new Date(now.getTime() - hours * 60 * 60 * 1000);
}

/** Las mesas «viejas»: su cliente se sentó antes del corte, o ya no existe. */
function staleOccupiedFilter(cutoff: Date) {
  return sql`not exists (select 1 from ${waitlistEntries} where ${waitlistEntries.id} = ${tables.currentEntryId} and coalesce(${waitlistEntries.seatedAt}, ${waitlistEntries.arrivedAt}) >= ${cutoff.getTime()})`;
}

/** Cuántos tocaría «Limpiar pendientes antiguos», sin cambiar nada (para la confirmación). */
export async function previewCleanup(
  restaurantId: string,
  hours: CleanupHours,
  now = new Date(),
): Promise<{ absent: number; tables: number }> {
  const cutoff = cutoffFor(hours, now);
  const [absent] = await db
    .select({ n: sql<number>`count(*)` })
    .from(waitlistEntries)
    .where(and(eq(waitlistEntries.restaurantId, restaurantId), inArray(waitlistEntries.status, [...ACTIVE_WAITLIST_STATUSES]), lt(waitlistEntries.arrivedAt, cutoff)));
  const [occupied] = await db
    .select({ n: sql<number>`count(*)` })
    .from(tables)
    .where(and(eq(tables.restaurantId, restaurantId), isNotNull(tables.currentEntryId), staleOccupiedFilter(cutoff)));
  return { absent: Number(absent?.n ?? 0), tables: Number(occupied?.n ?? 0) };
}

/**
 * «Limpiar pendientes antiguos»: marca ausentes a los que siguen en la fila
 * desde hace más de `hours` y libera las mesas de los sentados desde hace más
 * de `hours`. Se puede deshacer.
 */
export async function cleanupStale(
  restaurantId: string,
  hours: CleanupHours,
  userId: string | null,
  now = new Date(),
): Promise<BatchOutcome> {
  const cutoff = cutoffFor(hours, now);
  const released = await releaseTablesOf(restaurantId, null, staleOccupiedFilter(cutoff));
  const absent = await markAbsent(restaurantId, lt(waitlistEntries.arrivedAt, cutoff), userId);
  const label = `Limpiar pendientes de más de ${hours === 168 ? "7 días" : `${hours} h`}`;
  return finish(restaurantId, label, released, absent, []);
}

/** «Liberar todas las mesas» del restaurante (empezar el día limpio). Se puede deshacer. */
export async function releaseAllTables(restaurantId: string): Promise<BatchOutcome> {
  const released = await releaseTablesOf(restaurantId, null);
  return finish(restaurantId, `Liberar todas las mesas (${released.events.length})`, released, { changed: [], undo: [] }, []);
}

/**
 * Deshace una acción en grupo, hasta donde se pueda sin pisar lo que pasó
 * después:
 *  - los eliminados vuelven tal cual (mismo id y misma hora de llegada);
 *  - los marcados ausentes vuelven a su estado si nadie los tocó desde
 *    entonces (\`updatedAt\` igual);
 *  - las mesas liberadas se vuelven a ocupar con el mismo cliente si siguen
 *    libres y nadie las tocó (\`version\` igual).
 */
export async function undoBatch(
  restaurantId: string,
  data: BatchUndoData,
): Promise<{ restored: WaitlistEntrySnapshot[]; reoccupied: TableEvent[]; skipped: number }> {
  let skipped = 0;
  const restored: WaitlistEntrySnapshot[] = [];

  for (const row of data.removed) {
    const [exists] = await db.select({ id: waitlistEntries.id }).from(waitlistEntries).where(eq(waitlistEntries.id, row.id)).limit(1);
    if (exists) {
      skipped += 1;
      continue;
    }
    const [back] = await db.insert(waitlistEntries).values(row).returning();
    restored.push(snapshot(back));
  }

  for (const { before, afterUpdatedAt } of data.changed) {
    const [back] = await db
      .update(waitlistEntries)
      .set({
        status: before.status,
        calledAt: before.calledAt,
        seatedAt: before.seatedAt,
        resolvedAt: before.resolvedAt,
        resolvedByUserId: before.resolvedByUserId,
        updatedAt: new Date(),
      })
      .where(and(eq(waitlistEntries.id, before.id), eq(waitlistEntries.restaurantId, restaurantId), eq(waitlistEntries.updatedAt, new Date(afterUpdatedAt))))
      .returning();
    if (back) restored.push(snapshot(back));
    else skipped += 1;
  }

  const reoccupied: TableEvent[] = [];
  for (const t of data.released) {
    const [row] = await db
      .update(tables)
      .set({ currentEntryId: t.entryId, status: OCCUPIED, version: sql`${tables.version} + 1`, updatedAt: new Date() })
      .where(
        and(
          eq(tables.id, t.tableId),
          eq(tables.restaurantId, restaurantId),
          sql`${tables.currentEntryId} is null`,
          eq(tables.version, t.versionAfter),
          sql`exists (select 1 from ${waitlistEntries} where ${waitlistEntries.id} = ${t.entryId} and ${waitlistEntries.restaurantId} = ${restaurantId})`,
        ),
      )
      .returning({ version: tables.version, layoutId: tables.layoutId });
    if (row) reoccupied.push({ entryId: t.entryId, table: { tableId: t.tableId, layoutId: row.layoutId, status: OCCUPIED, currentEntryId: t.entryId, version: row.version } });
    else skipped += 1;
  }
  return { restored, reoccupied, skipped };
}
