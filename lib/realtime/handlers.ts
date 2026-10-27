// Los eventos de tiempo real, sin Socket.IO: sentar, liberar, la lista de
// espera, deshacer... Es la misma lógica que tenía `lib/realtime/server.ts`,
// pero llega por una petición HTTP (`app/api/tiempo-real/route.ts`) y avisa a
// las demás pantallas guardando el aviso en la base (`lib/realtime/bus.ts`).
// Así funciona en Vercel, donde no hay un proceso que guarde rooms en memoria.
//
// No importa nada de Next: lo usan la ruta de la app y `scripts/verify-realtime.mts`.
//
// Todo lo que llega es no confiable: cada evento valida con Zod y vuelve a
// comprobar los permisos del usuario en ESE restaurante (antes bastaba con la
// room, que había pasado por los permisos al entrar; ahora no hay room
// guardada, así que se mira en cada petición).

import { restaurantExists } from "@/lib/db/queries/layouts";
import { logServerError } from "@/lib/log";
import { getCounters } from "@/lib/map/counters";
import { runOnce } from "@/lib/offline/operations";
import { assignTable, releaseTable } from "@/lib/tables/assign";
import {
  bulkWaitlist,
  cleanupStale,
  occupiedTablesOf,
  previewCleanup,
  registerReleaseUndo,
  releaseAllTables,
  type BatchOutcome,
} from "@/lib/waitlist/batch";
import { seatedBulkMessage } from "@/lib/waitlist/delete-rule";
import {
  addWaitlistEntries,
  addWaitlistEntry,
  deleteWaitlistEntry,
  flushUndo,
  readUndoState,
  reopenWaitlistEntry,
  resolveWaitlistEntry,
  undoWaitlistAction,
} from "@/lib/waitlist/quick-actions";

import { canAssignTables, canJoinOverview, canJoinRestaurant, canModifyWaitlist, type SocketIdentity } from "./auth";
import { publish } from "./bus";
import { emitOverview } from "./overview";
import {
  type Ack,
  MAX_BATCH_ENTRIES,
  OVERVIEW_ROOM,
  type ServerToClientEvents,
  addManyWaitlistEntriesSchema,
  addOneWaitlistEntrySchema,
  assignTableSchema,
  bulkWaitlistSchema,
  cleanupWaitlistSchema,
  deleteWaitlistEntrySchema,
  joinRestaurantSchema,
  releaseAllTablesSchema,
  releaseTableSchema,
  reopenWaitlistEntrySchema,
  resolveWaitlistEntrySchema,
  roomFor,
  undoWaitlistSchema,
} from "./events";

type Notice = { event: keyof ServerToClientEvents; args: unknown[] };

export type RealtimeReply = {
  /** La respuesta para quien preguntó (lo que antes era el ack del socket). */
  ack: Ack<Record<string, unknown>>;
  /** Avisos solo para quien preguntó (antes, `socket.emit` a sí mismo). */
  self: Notice[];
};

/** Los eventos que se pueden mandar. Cualquier otro se rechaza. */
export const REALTIME_EVENTS = [
  "restaurant:join",
  "overview:join",
  "table:assign",
  "table:release",
  "waitlist:add",
  "waitlist:add-many",
  "waitlist:resolve",
  "waitlist:reopen",
  "waitlist:delete",
  "waitlist:bulk",
  "waitlist:cleanup",
  "tables:release-all",
  "waitlist:undo",
] as const;
export type RealtimeEventName = (typeof REALTIME_EVENTS)[number];

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

const notice = <E extends keyof ServerToClientEvents>(event: E, ...args: Parameters<ServerToClientEvents[E]>): Notice => ({ event, args });

/** Avisa a todas las pantallas de un restaurante. */
export async function broadcast(restaurantId: string, notices: Notice[]): Promise<void> {
  await publish(roomFor(restaurantId), notices);
}

/** Contadores al mapa general (ver `lib/realtime/overview.ts`). */
const publishOverview = emitOverview;

/**
 * Atiende un evento. `restaurantId` es el restaurante en el que está la
 * pantalla (lo que antes era la room del socket); `null` si todavía no entró.
 * Un error inesperado no se le cuenta al cliente (podría llevar detalles de
 * la base): se registra y contesta un mensaje genérico.
 */
export async function handleRealtimeEvent(
  identity: SocketIdentity,
  restaurantId: string | null,
  event: string,
  raw: unknown,
): Promise<RealtimeReply> {
  const self: Notice[] = [];
  try {
    const ack = await dispatch(identity, restaurantId, event, raw, self);
    return { ack, self };
  } catch (err) {
    logServerError("[realtime] error en un handler", err);
    return { ack: fail("Error del servidor. Inténtalo de nuevo."), self: [] };
  }
}

async function dispatch(
  identity: SocketIdentity,
  joined: string | null,
  event: string,
  raw: unknown,
  self: Notice[],
): Promise<Ack<Record<string, unknown>>> {
  if (event === "restaurant:join") {
    const parsed = joinRestaurantSchema.safeParse(raw);
    if (!parsed.success) return fail("Restaurante no válido.");
    const { restaurantId } = parsed.data;
    if (!(await restaurantExists(restaurantId))) return fail("Ese restaurante no existe.");
    if (!(await canJoinRestaurant(identity, restaurantId))) return fail("No tienes acceso a este restaurante.");
    // Quien entra (o vuelve tras una caída) ve si hay algo que deshacer.
    self.push(notice("waitlist:undo-state", await readUndoState(restaurantId)));
    return { ok: true };
  }

  // Mapa general: no lleva payload, no hay nada que elegir.
  if (event === "overview:join") {
    if (!(await canJoinOverview(identity))) return fail("No tienes acceso al mapa general.");
    return { ok: true, counters: await getCounters() };
  }

  if (!(REALTIME_EVENTS as readonly string[]).includes(event)) return fail("Evento desconocido.");
  const restaurantId = joined;
  if (!restaurantId) return fail("Primero entra en un restaurante.");
  // El acceso al restaurante se comprueba en CADA evento con el permiso
  // concreto (canAssignTables / canModifyWaitlist), que ya implica acceso.
  // Hacer un canJoinRestaurant genérico antes devolvía «No tienes acceso…»
  // en lugar del mensaje con «permiso», que es lo que esperan las pruebas.
  const { userId } = identity;

  const undoNotices = async (): Promise<{ undo: Awaited<ReturnType<typeof readUndoState>> }> => {
    await flushUndo(restaurantId);
    return { undo: await readUndoState(restaurantId) };
  };

  /** Una acción en grupo: los mismos avisos de siempre (uno por mesa o cliente). */
  const batchNotices = async (batch: BatchOutcome): Promise<void> => {
    const { undo } = await undoNotices();
    await broadcast(restaurantId, [
      ...batch.released.map((t) => notice("table:released", t)),
      ...batch.changed.map((entry) => notice("waitlist:changed", { action: "resolved", entry, undo })),
      ...batch.removed.map((entry) => notice("waitlist:changed", { action: "removed", entry, undo })),
      notice("waitlist:undo-state", undo),
    ]);
    await publishOverview(restaurantId);
  };
  const summary = (batch: BatchOutcome) => ({ actionId: batch.actionId, released: batch.released.length, changed: batch.changed.length, removed: batch.removed.length });

  switch (event as RealtimeEventName) {
    // Asignar y liberar siguen el flujo del README: el cliente pide y espera,
    // el servidor decide, y solo si gana se avisa a todo el restaurante. El que
    // pierde recibe el error en su respuesta y nadie más se entera.
    case "table:assign": {
      if (!(await canAssignTables(identity, restaurantId))) return fail("No tienes permiso para sentar ni liberar mesas en este restaurante.");
      const parsed = assignTableSchema.safeParse(raw);
      if (!parsed.success) return fail("Datos de la asignación no válidos.");
      const { operationId, tableId, entryId } = parsed.data;
      const outcome = await runOnce({ operationId, restaurantId, userId, action: "table:assign" }, async () => {
        const result = await assignTable({ restaurantId, tableId, entryId, userId });
        if (!result.ok) return fail(result.error);
        return { ok: true as const, table: result.table, entryId: result.entryId, waiterName: result.waiterName };
      });
      // Un reenvío de la cola offline (`repetida`) devuelve la misma
      // respuesta, pero no vuelve a avisar: ya se supo la primera vez.
      if (outcome.kind === "nueva" && outcome.result.ok) {
        const r = outcome.result;
        await broadcast(restaurantId, [notice("table:assigned", { table: r.table, entryId: r.entryId, waiterName: r.waiterName })]);
        await publishOverview(restaurantId);
      }
      return outcome.result;
    }

    case "table:release": {
      if (!(await canAssignTables(identity, restaurantId))) return fail("No tienes permiso para sentar ni liberar mesas en este restaurante.");
      const parsed = releaseTableSchema.safeParse(raw);
      if (!parsed.success) return fail("Datos de la mesa no válidos.");
      const { operationId, tableId, entryId } = parsed.data;
      const outcome = await runOnce({ operationId, restaurantId, userId, action: "table:release" }, async () => {
        const result = await releaseTable({ restaurantId, tableId, entryId });
        if (!result.ok) return fail(result.error);
        return { ok: true as const, table: result.table, entryId: result.entryId };
      });
      if (outcome.kind === "nueva" && outcome.result.ok) {
        const released = { table: outcome.result.table, entryId: outcome.result.entryId };
        // Liberar una mesa también se puede deshacer (vuelve a ocuparla con el
        // mismo cliente si sigue libre).
        await registerReleaseUndo(restaurantId, released);
        const { undo } = await undoNotices();
        await broadcast(restaurantId, [notice("table:released", released), notice("waitlist:undo-state", undo)]);
        await publishOverview(restaurantId);
      }
      return outcome.result;
    }

    case "waitlist:add": {
      if (!(await canModifyWaitlist(identity, restaurantId))) return fail("No tienes permiso para modificar la lista de espera en este restaurante.");
      const parsed = addOneWaitlistEntrySchema.safeParse(raw);
      if (!parsed.success) return fail("Revisa el nombre y la cantidad de personas.");
      const { operationId, ...input } = parsed.data;
      const outcome = await runOnce({ operationId, restaurantId, userId, action: "waitlist:add" }, async () => {
        const result = await addWaitlistEntry(restaurantId, input);
        if (!result.ok) return fail(result.error);
        return { ok: true as const, entry: result.entry, actionId: result.actionId };
      });
      if (outcome.kind === "nueva" && outcome.result.ok) {
        const { undo } = await undoNotices();
        await broadcast(restaurantId, [notice("waitlist:changed", { action: "added", entry: outcome.result.entry, undo }), notice("waitlist:undo-state", undo)]);
        await publishOverview(restaurantId);
      }
      return outcome.result;
    }

    case "waitlist:add-many": {
      if (!(await canModifyWaitlist(identity, restaurantId))) return fail("No tienes permiso para modificar la lista de espera en este restaurante.");
      const parsed = addManyWaitlistEntriesSchema.safeParse(raw);
      if (!parsed.success) {
        const tooMany = parsed.error.issues.some((issue) => issue.code === "too_big" && issue.path.length === 1);
        return fail(tooMany
          ? `Se pueden agregar hasta ${MAX_BATCH_ENTRIES} clientes de una vez.`
          : "Revisa el nombre y la cantidad de personas de cada cliente.");
      }
      const { operationId, entries } = parsed.data;
      const outcome = await runOnce({ operationId, restaurantId, userId, action: "waitlist:add-many" }, async () => {
        const result = await addWaitlistEntries(restaurantId, entries);
        if (!result.ok) return fail(result.error);
        return { ok: true as const, entries: result.entries, actionId: result.actionId };
      });
      if (outcome.kind === "nueva" && outcome.result.ok) {
        const { undo } = await undoNotices();
        await broadcast(restaurantId, [
          ...outcome.result.entries.map((entry) => notice("waitlist:changed", { action: "added", entry, undo })),
          notice("waitlist:undo-state", undo),
        ]);
        await publishOverview(restaurantId);
      }
      return outcome.result;
    }

    case "waitlist:resolve": {
      if (!(await canModifyWaitlist(identity, restaurantId))) return fail("No tienes permiso para modificar la lista de espera en este restaurante.");
      const parsed = resolveWaitlistEntrySchema.safeParse(raw);
      if (!parsed.success) return fail("Datos del cliente no válidos.");
      const { operationId, entryId, status } = parsed.data;
      const outcome = await runOnce({ operationId, restaurantId, userId, action: "waitlist:resolve" }, async () => {
        const result = await resolveWaitlistEntry(restaurantId, entryId, status, userId);
        if (!result.ok) return fail(result.error);
        return { ok: true as const, entry: result.entry, actionId: result.actionId };
      });
      if (outcome.kind === "nueva" && outcome.result.ok) {
        const { undo } = await undoNotices();
        await broadcast(restaurantId, [notice("waitlist:changed", { action: "resolved", entry: outcome.result.entry, undo }), notice("waitlist:undo-state", undo)]);
        await publishOverview(restaurantId);
      }
      return outcome.result;
    }

    case "waitlist:reopen": {
      if (!(await canModifyWaitlist(identity, restaurantId))) return fail("No tienes permiso para modificar la lista de espera en este restaurante.");
      const parsed = reopenWaitlistEntrySchema.safeParse(raw);
      if (!parsed.success) return fail("Datos del cliente no válidos.");
      const { operationId, entryId } = parsed.data;
      const outcome = await runOnce({ operationId, restaurantId, userId, action: "waitlist:reopen" }, async () => {
        const result = await reopenWaitlistEntry(restaurantId, entryId);
        if (!result.ok) return fail(result.error);
        return { ok: true as const, entry: result.entry, actionId: result.actionId };
      });
      if (outcome.kind === "nueva" && outcome.result.ok) {
        const { undo } = await undoNotices();
        await broadcast(restaurantId, [notice("waitlist:changed", { action: "reopened", entry: outcome.result.entry, undo }), notice("waitlist:undo-state", undo)]);
        await publishOverview(restaurantId);
      }
      return outcome.result;
    }

    case "waitlist:delete": {
      if (!(await canModifyWaitlist(identity, restaurantId))) return fail("No tienes permiso para modificar la lista de espera en este restaurante.");
      const parsed = deleteWaitlistEntrySchema.safeParse(raw);
      if (!parsed.success) return fail("Datos del cliente no válidos.");
      // Si está en una mesa, `deleteWaitlistEntry` no toca nada y contesta
      // «Este cliente está en la Mesa 3. Primero libera la mesa…». Vale igual
      // para lo que llega de la cola sin conexión.
      const { operationId, entryId } = parsed.data;
      const outcome = await runOnce({ operationId, restaurantId, userId, action: "waitlist:delete" }, async () => {
        const result = await deleteWaitlistEntry(restaurantId, entryId);
        if (!result.ok) return fail(result.error);
        return { ok: true as const, entry: result.entry, actionId: result.actionId };
      });
      if (outcome.kind === "nueva" && outcome.result.ok) {
        const { undo } = await undoNotices();
        // `removed`: es lo que las pantallas ya saben quitar, y deshacer
        // devuelve `restored`, la otra mitad del mismo par.
        await broadcast(restaurantId, [notice("waitlist:changed", { action: "removed", entry: outcome.result.entry, undo }), notice("waitlist:undo-state", undo)]);
        await publishOverview(restaurantId);
      }
      return outcome.result;
    }

    case "waitlist:bulk": {
      const parsed = bulkWaitlistSchema.safeParse(raw);
      if (!parsed.success) return fail("Datos de la acción no válidos.");
      const { action, entryIds } = parsed.data;
      // Liberar toca las mesas; marcar ausente y eliminar, la lista.
      if (action !== "liberar" && !(await canModifyWaitlist(identity, restaurantId))) {
        return fail("No tienes permiso para modificar la lista de espera en este restaurante.");
      }
      if (action === "liberar" && !(await canAssignTables(identity, restaurantId))) {
        return fail("No tienes permiso para sentar ni liberar mesas en este restaurante.");
      }
      // Eliminar en grupo: si alguno está en una mesa, no se elimina NADIE y
      // se dice en qué mesas están.
      if (action === "eliminar") {
        const seated = await occupiedTablesOf(restaurantId, entryIds);
        if (seated.size > 0) {
          const labels = [...seated.values()].sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
          return fail(seatedBulkMessage(seated.size, new Set(entryIds).size, labels));
        }
      }
      const batch = await bulkWaitlist(restaurantId, action, entryIds, userId);
      await batchNotices(batch);
      return { ok: true as const, ...summary(batch) };
    }

    case "waitlist:cleanup": {
      if (!(await canModifyWaitlist(identity, restaurantId)) || !(await canAssignTables(identity, restaurantId))) {
        return fail("No tienes permiso para limpiar la lista y las mesas de este restaurante.");
      }
      const parsed = cleanupWaitlistSchema.safeParse(raw);
      if (!parsed.success) return fail("Elige 12 h, 24 h o 7 días.");
      if (parsed.data.preview) {
        return { ok: true as const, actionId: null, released: 0, changed: 0, removed: 0, preview: await previewCleanup(restaurantId, parsed.data.hours) };
      }
      const batch = await cleanupStale(restaurantId, parsed.data.hours, userId);
      await batchNotices(batch);
      return { ok: true as const, ...summary(batch) };
    }

    case "tables:release-all": {
      if (!(await canAssignTables(identity, restaurantId))) return fail("No tienes permiso para sentar ni liberar mesas en este restaurante.");
      const parsed = releaseAllTablesSchema.safeParse(raw);
      if (!parsed.success) return fail("Para liberar todas las mesas hay que escribir LIBERAR.");
      const batch = await releaseAllTables(restaurantId);
      await batchNotices(batch);
      return { ok: true as const, ...summary(batch) };
    }

    case "waitlist:undo": {
      if (!(await canModifyWaitlist(identity, restaurantId))) return fail("No tienes permiso para modificar la lista de espera en este restaurante.");
      const parsed = undoWaitlistSchema.safeParse(raw);
      if (!parsed.success) return fail("Datos para deshacer no válidos.");
      const result = await undoWaitlistAction(restaurantId, parsed.data.actionId);
      if (!result.ok) return fail(result.error);
      const { undo } = await undoNotices();
      // Deshacer una acción en grupo: vuelven los clientes y se ocupan otra
      // vez las mesas que se habían liberado (si siguen libres).
      if (result.batch) {
        await broadcast(restaurantId, [
          ...result.batch.reoccupied.map((t) => notice("table:assigned", t)),
          ...result.batch.restored.map((entry) => notice("waitlist:changed", { action: "restored", entry, undo })),
          notice("waitlist:undo-state", undo),
        ]);
        await publishOverview(restaurantId);
        return { ok: true, action: "restored" as const, entry: result.entry };
      }
      // Deshacer «agregar varios» quita a todos: un aviso por cada uno.
      await broadcast(restaurantId, [
        ...(result.entries ?? (result.entry ? [result.entry] : [])).map((entry) => notice("waitlist:changed", { action: result.action, entry, undo })),
        notice("waitlist:undo-state", undo),
      ]);
      await publishOverview(restaurantId);
      return { ok: true, action: result.action, entry: result.entry, entries: result.entries };
    }

    default:
      return fail("Evento desconocido.");
  }
}

/**
 * Las salas que puede leer este usuario de las que pide. Un restaurante sin
 * permiso, o el mapa general sin `mapa:ver`, simplemente no se lee (como antes
 * el socket que salía de la sala al perder el permiso).
 */
export async function allowedRooms(identity: SocketIdentity, requested: { restaurantId?: string | null; overview?: boolean }): Promise<string[]> {
  const rooms: string[] = [];
  if (requested.restaurantId && (await canJoinRestaurant(identity, requested.restaurantId))) rooms.push(roomFor(requested.restaurantId));
  if (requested.overview && (await canJoinOverview(identity))) rooms.push(OVERVIEW_ROOM);
  return rooms;
}
