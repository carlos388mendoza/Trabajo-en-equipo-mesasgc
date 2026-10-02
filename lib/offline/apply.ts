// Modo offline del modo sencillo: qué es una operación en cola y cómo se ve la
// lista mientras esa operación todavía no llegó al servidor.
//
// Lo que se pinta es SIEMPRE: datos del servidor (los últimos que se conocen)
// + las operaciones pendientes aplicadas en orden. Nunca se «inventa» un
// estado que no salga de ahí, así que:
//   - deshacer sin conexión es quitar la última operación de la cola;
//   - al sincronizar, cada operación confirmada pasa a formar parte de los
//     datos del servidor, y una rechazada deja de aplicarse (y se avisa);
//   - al final se vuelve a leer todo del servidor: la verdad es la suya.
//
// Funciones puras, sin IndexedDB ni React: las usa el navegador y las prueba
// `scripts/verify-realtime.mts`.

import type { TableStatus, WaitlistStatus } from "@/lib/db/enums";
import type { SeatableTable } from "@/lib/tables/list";
import type { WaitlistEntrySnapshot } from "@/lib/waitlist/quick-actions";

/** Los eventos de Socket.IO que se pueden dejar en cola sin conexión. */
export const OFFLINE_ACTIONS = [
  "waitlist:add",
  "waitlist:add-many",
  "waitlist:resolve",
  "waitlist:reopen",
  "waitlist:delete",
  "table:assign",
  "table:release",
] as const;
export type OfflineAction = (typeof OFFLINE_ACTIONS)[number];

/**
 * - `pendiente`: esperando conexión.
 * - `enviando`: salió hacia el servidor y no ha vuelto el ack.
 * - `conflicto`: el servidor la rechazó; se enseña hasta que el host la acepte.
 */
export type OperationState = "pendiente" | "enviando" | "conflicto";

export type NewGuestPayload = {
  customerName: string;
  partySize: number;
  notes: string;
  entryId: string;
  arrivedAt: number;
};

export type OperationPayload =
  | { action: "waitlist:add"; data: NewGuestPayload }
  | { action: "waitlist:add-many"; data: { entries: NewGuestPayload[] } }
  | { action: "waitlist:resolve"; data: { entryId: string; status: "listo" | "ausente" } }
  | { action: "waitlist:reopen"; data: { entryId: string } }
  | { action: "waitlist:delete"; data: { entryId: string } }
  | { action: "table:assign"; data: { tableId: string; entryId: string } }
  | { action: "table:release"; data: { tableId: string; entryId: string } };

export type QueuedOperation = OperationPayload & {
  /** UUID: el servidor lo usa para no aplicar dos veces un reenvío. */
  operationId: string;
  /** De quién y de qué restaurante es: la cola nunca se mezcla entre usuarios. */
  userId: string;
  restaurantId: string;
  /** El cliente (o la mesa) sobre el que actúa, para mostrarlo y agrupar. */
  targetId: string;
  /** Texto corto para la lista de pendientes y los conflictos («Marcar listo a Ana»). */
  label: string;
  /** Orden estricto de la cola. */
  sequence: number;
  createdAt: number;
  state: OperationState;
  attempts: number;
  /** El motivo del rechazo, si lo hubo. */
  error?: string;
};

export type LocalView = { entries: WaitlistEntrySnapshot[]; tables: SeatableTable[] };

/** Las que todavía cuentan para lo que se ve: no las rechazadas. */
export function liveOperations(ops: readonly QueuedOperation[]): QueuedOperation[] {
  return ops.filter((op) => op.state !== "conflicto").sort((a, b) => a.sequence - b.sequence);
}

function newEntry(data: NewGuestPayload, now: number): WaitlistEntrySnapshot {
  return {
    id: data.entryId,
    customerName: data.customerName,
    partySize: data.partySize,
    notes: data.notes || null,
    status: "esperando",
    arrivedAt: data.arrivedAt,
    calledAt: null,
    seatedAt: null,
    resolvedAt: null,
    resolvedByName: null,
    assignedTableId: null,
    isDemo: false,
    updatedAt: now,
  };
}

/**
 * La lista y las mesas como quedarán cuando lleguen las operaciones
 * pendientes. Una operación que ya no tiene sentido sobre estos datos (resolver
 * a alguien que ya no espera, ocupar una mesa ya ocupada) NO se aplica: el
 * servidor la va a rechazar, y pintar su efecto sería una pantalla falsa.
 */
export function applyOperations(
  base: LocalView,
  ops: readonly QueuedOperation[],
  now = Date.now(),
): LocalView {
  const entries = new Map(base.entries.map((entry) => [entry.id, { ...entry }]));
  const tables = new Map(base.tables.map((table) => [table.id, { ...table }]));
  const set = (id: string, patch: Partial<WaitlistEntrySnapshot>) => {
    const current = entries.get(id);
    if (current) entries.set(id, { ...current, ...patch, updatedAt: now });
  };
  const active = (status: WaitlistStatus) => status === "esperando" || status === "listo";

  for (const op of liveOperations(ops)) {
    switch (op.action) {
      case "waitlist:add":
        if (!entries.has(op.data.entryId)) entries.set(op.data.entryId, newEntry(op.data, now));
        break;
      case "waitlist:add-many":
        for (const data of op.data.entries) if (!entries.has(data.entryId)) entries.set(data.entryId, newEntry(data, now));
        break;
      case "waitlist:resolve": {
        const entry = entries.get(op.data.entryId);
        if (!entry || !active(entry.status)) break;
        set(entry.id, {
          status: op.data.status,
          resolvedAt: op.createdAt,
          ...(op.data.status === "listo" ? { calledAt: op.createdAt } : {}),
        });
        break;
      }
      case "waitlist:reopen": {
        const entry = entries.get(op.data.entryId);
        if (!entry || (entry.status !== "listo" && entry.status !== "ausente")) break;
        set(entry.id, { status: "esperando", calledAt: null, resolvedAt: null, resolvedByName: null });
        break;
      }
      case "waitlist:delete": {
        // Con mesa ocupada no se borra (lo mismo que el servidor).
        const seated = [...tables.values()].some((table) => table.currentEntryId === op.data.entryId);
        if (!seated) entries.delete(op.data.entryId);
        break;
      }
      case "table:assign": {
        const table = tables.get(op.data.tableId);
        const entry = entries.get(op.data.entryId);
        if (!table || !entry || table.currentEntryId !== null || !active(entry.status)) break;
        tables.set(table.id, { ...table, currentEntryId: entry.id, status: "ocupada" as TableStatus });
        set(entry.id, { status: "sentado", seatedAt: op.createdAt, assignedTableId: table.id });
        break;
      }
      case "table:release": {
        const table = tables.get(op.data.tableId);
        if (!table || table.currentEntryId !== op.data.entryId) break;
        tables.set(table.id, { ...table, currentEntryId: null, status: "libre" as TableStatus });
        break;
      }
    }
  }
  return {
    entries: [...entries.values()].sort((a, b) => a.arrivedAt - b.arrivedAt),
    tables: [...tables.values()],
  };
}

/** El payload que viaja por el socket: el de la operación más su id. */
export function socketPayload(op: QueuedOperation): Record<string, unknown> {
  return { ...op.data, operationId: op.operationId };
}

/**
 * ¿Es definitivo el rechazo? Un error de permiso o de sesión no es un
 * conflicto del restaurante: hay que volver a entrar, no descartar el cambio.
 */
export function isRetryableRejection(error: string): boolean {
  return /Primero entra en un restaurante|sesión terminó|No autorizado/i.test(error);
}
