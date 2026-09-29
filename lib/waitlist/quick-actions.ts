// Escrituras del modo rápido y deshacer de una acción por restaurante.
// La última acción vive en memoria del proceso: no requiere cambios al esquema.

import { and, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { ACTIVE_WAITLIST_STATUSES, type WaitlistStatus } from "@/lib/db/enums";
import { waitlistEntries } from "@/lib/db/schema";

export type WaitlistEntrySnapshot = {
  id: string;
  customerName: string;
  partySize: number;
  notes: string | null;
  status: WaitlistStatus;
  arrivedAt: number;
  calledAt: number | null;
  seatedAt: number | null;
  updatedAt: number;
};

export type UndoState = { actionId: string; label: string };

type UndoRecord = {
  actionId: string;
  entryId: string;
  entryUpdatedAt: Date;
  kind: "added" | "resolved";
  resolvedStatus?: "listo" | "ausente";
  label: string;
  previous?: {
    status: WaitlistStatus;
    calledAt: Date | null;
    seatedAt: Date | null;
  };
  busy: boolean;
};

type Result<T> = ({ ok: true } & T) | { ok: false; error: string };

const undoByRestaurant = new Map<string, UndoRecord>();

function snapshot(entry: typeof waitlistEntries.$inferSelect): WaitlistEntrySnapshot {
  return {
    id: entry.id,
    customerName: entry.customerName,
    partySize: entry.partySize,
    notes: entry.notes,
    status: entry.status as WaitlistStatus,
    arrivedAt: entry.arrivedAt.getTime(),
    calledAt: entry.calledAt?.getTime() ?? null,
    seatedAt: entry.seatedAt?.getTime() ?? null,
    updatedAt: entry.updatedAt.getTime(),
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
    label: `Agregar a ${entry.customerName}`,
    busy: false,
  });
  return { ok: true, entry: snapshot(entry), actionId };
}

export async function resolveWaitlistEntry(
  restaurantId: string,
  entryId: string,
  status: "listo" | "ausente",
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
    resolvedStatus: status,
    label: `${status === "listo" ? "Marcar listo" : "Marcar ausente"} a ${current.customerName}`,
    previous: {
      status: current.status as WaitlistStatus,
      calledAt: current.calledAt,
      seatedAt: current.seatedAt,
    },
    busy: false,
  });
  return { ok: true, entry: snapshot(updated), actionId };
}

export async function undoWaitlistAction(
  restaurantId: string,
  actionId: string,
): Promise<Result<{ action: "removed" | "restored"; entry: WaitlistEntrySnapshot }>> {
  const record = undoByRestaurant.get(restaurantId);
  if (!record || record.actionId !== actionId || record.busy) {
    return { ok: false, error: "La última acción ya cambió o fue deshecha." };
  }
  record.busy = true;

  try {
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
      .set({
        status: previous.status,
        calledAt: previous.calledAt,
        seatedAt: previous.seatedAt,
        updatedAt: new Date(),
      })
      .where(and(
        eq(waitlistEntries.id, record.entryId),
        eq(waitlistEntries.restaurantId, restaurantId),
        eq(waitlistEntries.status, record.resolvedStatus ?? "esperando"),
        eq(waitlistEntries.updatedAt, record.entryUpdatedAt),
      ))
      .returning();
    if (!restored) {
      record.busy = false;
      return { ok: false, error: "El cliente ya cambió y no se puede deshacer esa acción." };
    }
    if (undoByRestaurant.get(restaurantId) === record) undoByRestaurant.delete(restaurantId);
    return { ok: true, action: "restored", entry: snapshot(restored) };
  } catch (error) {
    record.busy = false;
    throw error;
  }
}
