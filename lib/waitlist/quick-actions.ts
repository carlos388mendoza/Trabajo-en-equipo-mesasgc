// Escrituras del modo rápido y deshacer de una acción por restaurante.
// La última acción vive en memoria del proceso: no requiere cambios al esquema.

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { ACTIVE_WAITLIST_STATUSES, type WaitlistStatus } from "@/lib/db/enums";
import { user, waitlistEntries } from "@/lib/db/schema";
// Cuántos clientes se pueden agregar de una vez («Varios» del formulario).
import { MAX_BATCH_ENTRIES } from "@/lib/realtime/events";

export type WaitlistEntrySnapshot = {
  id: string;
  customerName: string;
  partySize: number;
  notes: string | null;
  status: WaitlistStatus;
  arrivedAt: number;
  calledAt: number | null;
  seatedAt: number | null;
  /** Cuándo lo marcaron listo o ausente (null si sigue esperando). */
  resolvedAt: number | null;
  /** Nombre de quien lo resolvió, para «Ver todas las cartas». */
  resolvedByName: string | null;
  updatedAt: number;
};

export type UndoState = { actionId: string; label: string };

/** Lo que una acción cambia de la fila y deshacer devuelve tal cual. */
type Restorable = {
  status: WaitlistStatus;
  calledAt: Date | null;
  seatedAt: Date | null;
  resolvedAt: Date | null;
  resolvedByUserId: string | null;
};

type UndoRecord = {
  actionId: string;
  entryId: string;
  entryUpdatedAt: Date;
  /** `added-many`: varios de una vez; deshacer los quita todos (`entryIds`). */
  kind: "added" | "added-many" | "resolved" | "reopened";
  entryIds?: string[];
  /** Estado en que dejó la fila la acción: deshacer solo vale si sigue así. */
  statusAfter: WaitlistStatus;
  label: string;
  previous?: Restorable;
  busy: boolean;
};

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

const undoByRestaurant = new Map<string, UndoRecord>();

/** Estados desde los que se puede volver a la espera: los que resolvió el modo rápido. */
const REOPENABLE_STATUSES: readonly WaitlistStatus[] = ["listo", "ausente"];

export function snapshot(
  entry: typeof waitlistEntries.$inferSelect,
  resolvedByName: string | null = null,
): WaitlistEntrySnapshot {
  return {
    id: entry.id,
    customerName: entry.customerName,
    partySize: entry.partySize,
    notes: entry.notes,
    status: entry.status as WaitlistStatus,
    arrivedAt: entry.arrivedAt.getTime(),
    calledAt: entry.calledAt?.getTime() ?? null,
    seatedAt: entry.seatedAt?.getTime() ?? null,
    resolvedAt: entry.resolvedAt?.getTime() ?? null,
    resolvedByName: entry.resolvedByUserId ? resolvedByName : null,
    updatedAt: entry.updatedAt.getTime(),
  };
}

/** Nombre del usuario que resolvió la fila; referencia blanda, puede no existir ya. */
async function resolverName(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const [row] = await db.select({ name: user.name }).from(user).where(eq(user.id, userId)).limit(1);
  return row?.name ?? null;
}

async function snapshotWithName(entry: typeof waitlistEntries.$inferSelect): Promise<WaitlistEntrySnapshot> {
  return snapshot(entry, await resolverName(entry.resolvedByUserId));
}

function restorable(entry: typeof waitlistEntries.$inferSelect): Restorable {
  return {
    status: entry.status as WaitlistStatus,
    calledAt: entry.calledAt,
    seatedAt: entry.seatedAt,
    resolvedAt: entry.resolvedAt,
    resolvedByUserId: entry.resolvedByUserId,
  };
}

export function getWaitlistUndoState(restaurantId: string): UndoState | null {
  const record = undoByRestaurant.get(restaurantId);
  return record && !record.busy
    ? { actionId: record.actionId, label: record.label }
    : null;
}

export async function addWaitlistEntry(
  restaurantId: string,
  input: { customerName: string; partySize: number; notes?: string },
): Promise<Result<{ entry: WaitlistEntrySnapshot; actionId: string }>> {
  const now = new Date();
  const [entry] = await db
    .insert(waitlistEntries)
    .values({
      id: crypto.randomUUID(),
      restaurantId,
      customerName: input.customerName,
      partySize: input.partySize,
      notes: input.notes || null,
      status: "esperando",
      arrivedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  const actionId = crypto.randomUUID();
  undoByRestaurant.set(restaurantId, {
    actionId,
    entryId: entry.id,
    entryUpdatedAt: now,
    kind: "added",
    statusAfter: "esperando",
    label: `Agregar a ${entry.customerName}`,
    busy: false,
  });
  return { ok: true, entry: snapshot(entry), actionId };
}


/**
 * Agrega varios grupos de una vez, en el orden de la lista: cada uno llega 1
 * ms después del anterior, así la fila respeta el orden de las filas del
 * formulario. Es un solo INSERT de varias filas, que SQLite aplica entero o
 * nada. Deshacer los quita a todos juntos.
 */
export async function addWaitlistEntries(
  restaurantId: string,
  inputs: { customerName: string; partySize: number; notes?: string }[],
): Promise<Result<{ entries: WaitlistEntrySnapshot[]; actionId: string }>> {
  if (inputs.length === 0) return { ok: false, error: "No hay clientes para agregar." };
  if (inputs.length > MAX_BATCH_ENTRIES) {
    return { ok: false, error: `Se pueden agregar hasta ${MAX_BATCH_ENTRIES} clientes de una vez.` };
  }
  const now = Date.now();
  const rows = inputs.map((input, index) => {
    const at = new Date(now + index);
    return {
      id: crypto.randomUUID(),
      restaurantId,
      customerName: input.customerName,
      partySize: input.partySize,
      notes: input.notes || null,
      status: "esperando",
      arrivedAt: at,
      createdAt: at,
      updatedAt: at,
    };
  });
  const inserted = await db.insert(waitlistEntries).values(rows).returning();
  const entries = inserted.map((entry) => snapshot(entry)).sort((a, b) => a.arrivedAt - b.arrivedAt);

  const actionId = crypto.randomUUID();
  undoByRestaurant.set(restaurantId, {
    actionId,
    entryId: entries[0].id,
    entryUpdatedAt: new Date(now),
    entryIds: entries.map((entry) => entry.id),
    kind: "added-many",
    statusAfter: "esperando",
    label: `Agregar ${entries.length} ${entries.length === 1 ? "cliente" : "clientes"}`,
    busy: false,
  });
  return { ok: true, entries, actionId };
}

/**
 * Deshace un «agregar varios»: los quita a todos o a ninguno. Si alguno ya
 * cambió (otro host lo marcó listo), no se toca nada.
 */
async function undoAddMany(
  restaurantId: string,
  record: UndoRecord,
): Promise<Result<{ entries: WaitlistEntrySnapshot[] }>> {
  const ids = record.entryIds ?? [];
  return db.transaction(async (tx) => {
    const current = await tx
      .select()
      .from(waitlistEntries)
      .where(and(
        inArray(waitlistEntries.id, ids),
        eq(waitlistEntries.restaurantId, restaurantId),
        eq(waitlistEntries.status, "esperando"),
      ));
    // Sin cambios desde que se agregaron: su `updatedAt` es su llegada.
    const untouched = current.filter((entry) => entry.updatedAt.getTime() === entry.arrivedAt.getTime());
    if (untouched.length !== ids.length) {
      return { ok: false as const, error: "Algún cliente ya cambió y no se puede deshacer el grupo." };
    }
    await tx.delete(waitlistEntries).where(and(
      inArray(waitlistEntries.id, ids),
      eq(waitlistEntries.restaurantId, restaurantId),
    ));
    return { ok: true as const, entries: untouched.map((entry) => snapshot(entry)) };
  });
}

export async function resolveWaitlistEntry(
  restaurantId: string,
  entryId: string,
  status: "listo" | "ausente",
  userId: string | null = null,
): Promise<Result<{ entry: WaitlistEntrySnapshot; actionId: string }>> {
  const [current] = await db
    .select()
    .from(waitlistEntries)
    .where(and(eq(waitlistEntries.id, entryId), eq(waitlistEntries.restaurantId, restaurantId)))
    .limit(1);

  if (!current || !ACTIVE_WAITLIST_STATUSES.includes(current.status as WaitlistStatus)) {
    return { ok: false, error: "Este cliente ya fue atendido por otro dispositivo" };
  }

  const now = new Date();
  const [updated] = await db
    .update(waitlistEntries)
    .set({
      status,
      ...(status === "listo" ? { calledAt: now } : {}),
      seatedAt: null,
      resolvedAt: now,
      resolvedByUserId: userId,
      updatedAt: now,
    })
    .where(and(
      eq(waitlistEntries.id, entryId),
      eq(waitlistEntries.restaurantId, restaurantId),
      eq(waitlistEntries.status, current.status),
      eq(waitlistEntries.updatedAt, current.updatedAt),
      inArray(waitlistEntries.status, ACTIVE_WAITLIST_STATUSES),
    ))
    .returning();

  if (!updated) {
    return { ok: false, error: "Este cliente ya fue atendido por otro dispositivo" };
  }

  const actionId = crypto.randomUUID();
  undoByRestaurant.set(restaurantId, {
    actionId,
    entryId,
    entryUpdatedAt: now,
    kind: "resolved",
    statusAfter: status,
    label: `${status === "listo" ? "Marcar listo" : "Marcar ausente"} a ${current.customerName}`,
    previous: restorable(current),
    busy: false,
  });
  return { ok: true, entry: await snapshotWithName(updated), actionId };
}

/**
 * Devuelve a la espera a un cliente que el modo rápido marcó listo o ausente
 * («Ver todas las cartas»). Conserva su hora de llegada, así que recupera su
 * lugar en la fila. Un sentado no vuelve: tiene mesa, y eso se deshace
 * liberándola.
 */
export async function reopenWaitlistEntry(
  restaurantId: string,
  entryId: string,
): Promise<Result<{ entry: WaitlistEntrySnapshot; actionId: string }>> {
  const [current] = await db
    .select()
    .from(waitlistEntries)
    .where(and(eq(waitlistEntries.id, entryId), eq(waitlistEntries.restaurantId, restaurantId)))
    .limit(1);

  if (!current) return { ok: false, error: "Ese cliente no existe en este restaurante." };
  if (!REOPENABLE_STATUSES.includes(current.status as WaitlistStatus)) {
    return {
      ok: false,
      error: current.status === "esperando"
        ? "Este cliente ya está en la espera."
        : "Este cliente ya tiene mesa y no puede volver a la espera.",
    };
  }

  const now = new Date();
  const [updated] = await db
    .update(waitlistEntries)
    .set({
      status: "esperando",
      // Si vuelve, no se le avisó de verdad: fuera de las estadísticas de aviso.
      calledAt: null,
      resolvedAt: null,
      resolvedByUserId: null,
      updatedAt: now,
    })
    .where(and(
      eq(waitlistEntries.id, entryId),
      eq(waitlistEntries.restaurantId, restaurantId),
      eq(waitlistEntries.status, current.status),
      eq(waitlistEntries.updatedAt, current.updatedAt),
    ))
    .returning();

  if (!updated) {
    return { ok: false, error: "Este cliente cambió en otro dispositivo. Vuelve a intentarlo." };
  }

  const actionId = crypto.randomUUID();
  undoByRestaurant.set(restaurantId, {
    actionId,
    entryId,
    entryUpdatedAt: now,
    kind: "reopened",
    statusAfter: "esperando",
    label: `Volver a la espera a ${current.customerName}`,
    previous: restorable(current),
    busy: false,
  });
  return { ok: true, entry: snapshot(updated), actionId };
}

export async function undoWaitlistAction(
  restaurantId: string,
  actionId: string,
): Promise<Result<{
  action: "removed" | "restored";
  entry: WaitlistEntrySnapshot;
  /** Solo al deshacer «agregar varios»: todos los que se quitaron (`entry` es el primero). */
  entries?: WaitlistEntrySnapshot[];
}>> {
  const record = undoByRestaurant.get(restaurantId);
  if (!record || record.actionId !== actionId || record.busy) {
    return { ok: false, error: "La última acción ya cambió o fue deshecha." };
  }
  record.busy = true;

  try {
    if (record.kind === "added-many") {
      const result = await undoAddMany(restaurantId, record);
      if (!result.ok) {
        record.busy = false;
        return result;
      }
      if (undoByRestaurant.get(restaurantId) === record) undoByRestaurant.delete(restaurantId);
      return { ok: true, action: "removed", entry: result.entries[0], entries: result.entries };
    }

    if (record.kind === "added") {
      const [removed] = await db
        .delete(waitlistEntries)
        .where(and(
          eq(waitlistEntries.id, record.entryId),
          eq(waitlistEntries.restaurantId, restaurantId),
          eq(waitlistEntries.status, "esperando"),
          eq(waitlistEntries.updatedAt, record.entryUpdatedAt),
        ))
        .returning();
      if (!removed) {
        record.busy = false;
        return { ok: false, error: "El cliente ya cambió y no se puede deshacer esa acción." };
      }
      if (undoByRestaurant.get(restaurantId) === record) undoByRestaurant.delete(restaurantId);
      return { ok: true, action: "removed", entry: snapshot(removed) };
    }

    const previous = record.previous;
    if (!previous) {
      record.busy = false;
      return { ok: false, error: "No se pudo deshacer esa acción." };
    }
    const [restored] = await db
      .update(waitlistEntries)
      .set({ ...previous, updatedAt: new Date() })
      .where(and(
        eq(waitlistEntries.id, record.entryId),
        eq(waitlistEntries.restaurantId, restaurantId),
        eq(waitlistEntries.status, record.statusAfter),
        eq(waitlistEntries.updatedAt, record.entryUpdatedAt),
      ))
      .returning();
    if (!restored) {
      record.busy = false;
      return { ok: false, error: "El cliente ya cambió y no se puede deshacer esa acción." };
    }
    if (undoByRestaurant.get(restaurantId) === record) undoByRestaurant.delete(restaurantId);
    return { ok: true, action: "restored", entry: await snapshotWithName(restored) };
  } catch (error) {
    record.busy = false;
    throw error;
  }
}
