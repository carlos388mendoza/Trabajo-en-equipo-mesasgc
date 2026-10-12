// Servidor de Socket.IO: rooms por restaurante y handlers de los eventos.
//
// Lo monta `server.ts` (la raíz) sobre el mismo `http.Server` que Next. No
// importa nada de Next: se puede levantar solo, que es lo que hace
// `scripts/verify-realtime.mts`.
//
// Todo lo que llega de un socket es no confiable: el cliente es código que
// cualquiera puede escribir a mano. Cada handler valida con Zod, y el
// restaurante sobre el que se actúa sale de la room en la que el socket entró
// (que pasó por los permisos), nunca del payload.

import type { Server as HttpServer } from "node:http";

import { Server } from "socket.io";

import { restaurantExists } from "@/lib/db/queries/layouts";
import { getCounters } from "@/lib/map/counters";
import { assignTable, releaseTable } from "@/lib/tables/assign";
import {
  addWaitlistEntries,
  addWaitlistEntry,
  deleteWaitlistEntry,
  getWaitlistUndoState,
  hydrateUndo,
  reopenWaitlistEntry,
  resolveWaitlistEntry,
  undoWaitlistAction,
} from "@/lib/waitlist/quick-actions";
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

import { canAssignTables, canJoinOverview, canJoinRestaurant, canModifyWaitlist, identifySocket } from "./auth";
import {
  type Ack,
  OVERVIEW_ROOM,
  MAX_BATCH_ENTRIES,
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
import { runOnce } from "@/lib/offline/operations";

import { emitOverview } from "./overview";
import { type RealtimeServer, setRealtimeServer } from "./registry";

export function attachRealtime(httpServer: HttpServer): RealtimeServer {
  const io: RealtimeServer = new Server(httpServer, {
    // Engine.io cierra al segundo cualquier upgrade de WebSocket que no sea
    // suyo. En este servidor el otro es el HMR de Next (`/_next/hmr`), y si
    // Next tarda más de un segundo en contestar (la primera compilación) se
    // quedaría sin recarga en caliente. Next ya cierra los que no son de
    // nadie.
    destroyUpgrade: false,
  });

  // Identificación en el handshake: sin sesión de Better Auth válida (cookie),
  // no hay conexión.
  io.use(async (socket, next) => {
    try {
      const identity = await identifySocket(socket.handshake);
      if (!identity) return next(new Error("No autorizado"));
      socket.data.userId = identity.userId;
      socket.data.restaurantId = null;
      next();
    } catch (err) {
      console.error("[realtime] error identificando el socket", err);
      next(new Error("No autorizado"));
    }
  });

  io.on("connection", (socket) => {
    socket.on("restaurant:join", async (raw, ack) => {
      await respond(ack, async () => {
        const parsed = joinRestaurantSchema.safeParse(raw);
        if (!parsed.success) return fail("Restaurante no válido.");
        const { restaurantId } = parsed.data;

        if (!(await restaurantExists(restaurantId))) {
          return fail("Ese restaurante no existe.");
        }
        const allowed = await canJoinRestaurant(
          { userId: socket.data.userId },
          restaurantId,
        );
        if (!allowed) return fail("No tienes acceso a este restaurante.");

        // Un socket, un restaurante: así "el restaurante de este socket" no
        // es ambiguo cuando luego pida asignar una mesa.
        const previous = socket.data.restaurantId;
        if (previous && previous !== restaurantId) {
          await socket.leave(roomFor(previous));
        }
        await socket.join(roomFor(restaurantId));
        socket.data.restaurantId = restaurantId;
        // Tras un reinicio, la última acción se recupera de la base.
        await hydrateUndo(restaurantId);
        socket.emit("waitlist:undo-state", getWaitlistUndoState(restaurantId));
        return { ok: true };
      });
    });

    // Mapa general: sala aparte, compatible con estar en un restaurante (el
    // admin que abre el plano en vivo de uno sigue oyendo a todos). No lleva
    // payload: no hay nada que elegir.
    socket.on("overview:join", async (_raw, ack) => {
      await respond(ack, async () => {
        if (!(await canJoinOverview({ userId: socket.data.userId }))) {
          return fail("No tienes acceso al mapa general.");
        }
        await socket.join(OVERVIEW_ROOM);
        return { ok: true, counters: await getCounters() };
      });
    });

    // Asignar y liberar siguen el flujo del README: el cliente pide y espera,
    // el servidor decide, y solo si gana se avisa a toda la room. El que
    // pierde recibe el error por su ack y nadie más se entera.
    socket.on("table:assign", async (raw, ack) => {
      await respond(ack, async () => {
        const restaurantId = socket.data.restaurantId;
        if (!restaurantId) return fail("Primero entra en un restaurante.");
        // Se vuelve a comprobar en CADA evento: el permiso pudo cambiar desde
        // que entró en la room (un admin le quitó el restaurante).
        if (!(await canAssignTables({ userId: socket.data.userId }, restaurantId))) {
          return fail("No tienes permiso para sentar ni liberar mesas en este restaurante.");
        }
        const parsed = assignTableSchema.safeParse(raw);
        if (!parsed.success) return fail("Datos de la asignación no válidos.");

        const { operationId, tableId, entryId } = parsed.data;
        const outcome = await runOnce({ operationId, restaurantId, userId: socket.data.userId, action: "table:assign" }, async () => {
          const result = await assignTable({ restaurantId, tableId, entryId, userId: socket.data.userId });
          if (!result.ok) return fail(result.error);
          return { ok: true as const, table: result.table, entryId: result.entryId, waiterName: result.waiterName };
        });
        // Un reenvío de la cola offline (`repetida`) devuelve la misma
        // respuesta, pero no vuelve a avisar: la room ya lo supo la primera vez.
        if (outcome.kind === "nueva" && outcome.result.ok) {
          io.to(roomFor(restaurantId)).emit("table:assigned", { table: outcome.result.table, entryId: outcome.result.entryId, waiterName: outcome.result.waiterName });
          // Contadores al mapa general, sin esperar: el ack no depende de eso.
          void emitOverview(restaurantId);
        }
        return outcome.result;
      });
    });

    socket.on("table:release", async (raw, ack) => {
      await respond(ack, async () => {
        const restaurantId = socket.data.restaurantId;
        if (!restaurantId) return fail("Primero entra en un restaurante.");
        // Se vuelve a comprobar en CADA evento: el permiso pudo cambiar desde
        // que entró en la room (un admin le quitó el restaurante).
        if (!(await canAssignTables({ userId: socket.data.userId }, restaurantId))) {
          return fail("No tienes permiso para sentar ni liberar mesas en este restaurante.");
        }
        const parsed = releaseTableSchema.safeParse(raw);
        if (!parsed.success) return fail("Datos de la mesa no válidos.");

        const { operationId, tableId, entryId } = parsed.data;
        const outcome = await runOnce({ operationId, restaurantId, userId: socket.data.userId, action: "table:release" }, async () => {
          const result = await releaseTable({ restaurantId, tableId, entryId });
          if (!result.ok) return fail(result.error);
          return { ok: true as const, table: result.table, entryId: result.entryId };
        });
        if (outcome.kind === "nueva" && outcome.result.ok) {
          const released = { table: outcome.result.table, entryId: outcome.result.entryId };
          // Liberar una mesa también se puede deshacer (vuelve a ocuparla con
          // el mismo cliente si sigue libre).
          await registerReleaseUndo(restaurantId, released);
          io.to(roomFor(restaurantId)).emit("table:released", released);
          io.to(roomFor(restaurantId)).emit("waitlist:undo-state", getWaitlistUndoState(restaurantId));
          void emitOverview(restaurantId);
        }
        return outcome.result;
      });
    });

    socket.on("waitlist:add", async (raw, ack) => {
      await respond(ack, async () => {
        const restaurantId = socket.data.restaurantId;
        if (!restaurantId) return fail("Primero entra en un restaurante.");
        if (!(await canModifyWaitlist({ userId: socket.data.userId }, restaurantId))) {
          return fail("No tienes permiso para modificar la lista de espera en este restaurante.");
        }
        const parsed = addOneWaitlistEntrySchema.safeParse(raw);
        if (!parsed.success) return fail("Revisa el nombre y la cantidad de personas.");

        const { operationId, ...input } = parsed.data;
        const outcome = await runOnce({ operationId, restaurantId, userId: socket.data.userId, action: "waitlist:add" }, async () => {
          const result = await addWaitlistEntry(restaurantId, input);
          if (!result.ok) return fail(result.error);
          return { ok: true as const, entry: result.entry, actionId: result.actionId };
        });
        if (outcome.kind === "nueva" && outcome.result.ok) {
          const undo = getWaitlistUndoState(restaurantId);
          io.to(roomFor(restaurantId)).emit("waitlist:changed", { action: "added", entry: outcome.result.entry, undo });
          io.to(roomFor(restaurantId)).emit("waitlist:undo-state", undo);
          // Un cliente más en espera: contadores al mapa general.
          void emitOverview(restaurantId);
        }
        return outcome.result;
      });
    });

    socket.on("waitlist:add-many", async (raw, ack) => {
      await respond(ack, async () => {
        const restaurantId = socket.data.restaurantId;
        if (!restaurantId) return fail("Primero entra en un restaurante.");
        if (!(await canModifyWaitlist({ userId: socket.data.userId }, restaurantId))) {
          return fail("No tienes permiso para modificar la lista de espera en este restaurante.");
        }
        const parsed = addManyWaitlistEntriesSchema.safeParse(raw);
        if (!parsed.success) {
          const tooMany = parsed.error.issues.some((issue) => issue.code === "too_big" && issue.path.length === 1);
          return fail(tooMany
            ? `Se pueden agregar hasta ${MAX_BATCH_ENTRIES} clientes de una vez.`
            : "Revisa el nombre y la cantidad de personas de cada cliente.");
        }

        const { operationId, entries } = parsed.data;
        const outcome = await runOnce({ operationId, restaurantId, userId: socket.data.userId, action: "waitlist:add-many" }, async () => {
          const result = await addWaitlistEntries(restaurantId, entries);
          if (!result.ok) return fail(result.error);
          return { ok: true as const, entries: result.entries, actionId: result.actionId };
        });
        if (outcome.kind === "nueva" && outcome.result.ok) {
          const undo = getWaitlistUndoState(restaurantId);
          for (const entry of outcome.result.entries) {
            io.to(roomFor(restaurantId)).emit("waitlist:changed", { action: "added", entry, undo });
          }
          io.to(roomFor(restaurantId)).emit("waitlist:undo-state", undo);
          void emitOverview(restaurantId);
        }
        return outcome.result;
      });
    });

    socket.on("waitlist:resolve", async (raw, ack) => {
      await respond(ack, async () => {
        const restaurantId = socket.data.restaurantId;
        if (!restaurantId) return fail("Primero entra en un restaurante.");
        if (!(await canModifyWaitlist({ userId: socket.data.userId }, restaurantId))) {
          return fail("No tienes permiso para modificar la lista de espera en este restaurante.");
        }
        const parsed = resolveWaitlistEntrySchema.safeParse(raw);
        if (!parsed.success) return fail("Datos del cliente no válidos.");

        const { operationId, entryId, status } = parsed.data;
        const outcome = await runOnce({ operationId, restaurantId, userId: socket.data.userId, action: "waitlist:resolve" }, async () => {
          const result = await resolveWaitlistEntry(restaurantId, entryId, status, socket.data.userId);
          if (!result.ok) return fail(result.error);
          return { ok: true as const, entry: result.entry, actionId: result.actionId };
        });
        if (outcome.kind === "nueva" && outcome.result.ok) {
          const undo = getWaitlistUndoState(restaurantId);
          io.to(roomFor(restaurantId)).emit("waitlist:changed", { action: "resolved", entry: outcome.result.entry, undo });
          io.to(roomFor(restaurantId)).emit("waitlist:undo-state", undo);
          void emitOverview(restaurantId);
        }
        return outcome.result;
      });
    });

    socket.on("waitlist:reopen", async (raw, ack) => {
      await respond(ack, async () => {
        const restaurantId = socket.data.restaurantId;
        if (!restaurantId) return fail("Primero entra en un restaurante.");
        if (!(await canModifyWaitlist({ userId: socket.data.userId }, restaurantId))) {
          return fail("No tienes permiso para modificar la lista de espera en este restaurante.");
        }
        const parsed = reopenWaitlistEntrySchema.safeParse(raw);
        if (!parsed.success) return fail("Datos del cliente no válidos.");

        const { operationId, entryId } = parsed.data;
        const outcome = await runOnce({ operationId, restaurantId, userId: socket.data.userId, action: "waitlist:reopen" }, async () => {
          const result = await reopenWaitlistEntry(restaurantId, entryId);
          if (!result.ok) return fail(result.error);
          return { ok: true as const, entry: result.entry, actionId: result.actionId };
        });
        if (outcome.kind === "nueva" && outcome.result.ok) {
          const undo = getWaitlistUndoState(restaurantId);
          io.to(roomFor(restaurantId)).emit("waitlist:changed", { action: "reopened", entry: outcome.result.entry, undo });
          io.to(roomFor(restaurantId)).emit("waitlist:undo-state", undo);
          void emitOverview(restaurantId);
        }
        return outcome.result;
      });
    });

    socket.on("waitlist:delete", async (raw, ack) => {
      await respond(ack, async () => {
        const restaurantId = socket.data.restaurantId;
        if (!restaurantId) return fail("Primero entra en un restaurante.");
        if (!(await canModifyWaitlist({ userId: socket.data.userId }, restaurantId))) {
          return fail("No tienes permiso para modificar la lista de espera en este restaurante.");
        }
        const parsed = deleteWaitlistEntrySchema.safeParse(raw);
        if (!parsed.success) return fail("Datos del cliente no válidos.");

        // Si está en una mesa, `deleteWaitlistEntry` no toca nada y contesta
        // «Este cliente está en la Mesa 3. Primero libera la mesa…». Vale
        // igual para lo que llega de la cola sin conexión.
        const { operationId, entryId } = parsed.data;
        const outcome = await runOnce({ operationId, restaurantId, userId: socket.data.userId, action: "waitlist:delete" }, async () => {
          const result = await deleteWaitlistEntry(restaurantId, entryId);
          if (!result.ok) return fail(result.error);
          return { ok: true as const, entry: result.entry, actionId: result.actionId };
        });
        if (outcome.kind === "nueva" && outcome.result.ok) {
          const undo = getWaitlistUndoState(restaurantId);
          // `removed`: es lo que los clientes ya saben quitar de la pantalla, y
          // deshacer devuelve `restored`, la otra mitad del mismo par.
          io.to(roomFor(restaurantId)).emit("waitlist:changed", { action: "removed", entry: outcome.result.entry, undo });
          io.to(roomFor(restaurantId)).emit("waitlist:undo-state", undo);
          void emitOverview(restaurantId);
        }
        return outcome.result;
      });
    });

    socket.on("waitlist:bulk", async (raw, ack) => {
      await respond(ack, async () => {
        const restaurantId = socket.data.restaurantId;
        if (!restaurantId) return fail("Primero entra en un restaurante.");
        const parsed = bulkWaitlistSchema.safeParse(raw);
        if (!parsed.success) return fail("Datos de la acción no válidos.");
        const { action, entryIds } = parsed.data;
        // Liberar toca las mesas; marcar ausente y eliminar, la lista.
        if (action !== "liberar" && !(await canModifyWaitlist({ userId: socket.data.userId }, restaurantId))) {
          return fail("No tienes permiso para modificar la lista de espera en este restaurante.");
        }
        if (action === "liberar" && !(await canAssignTables({ userId: socket.data.userId }, restaurantId))) {
          return fail("No tienes permiso para sentar ni liberar mesas en este restaurante.");
        }
        // Eliminar en grupo: si alguno está en una mesa, no se elimina NADIE y
        // se dice en qué mesas están (la tablet ofrece liberarlas o eliminar
        // solo a los demás).
        if (action === "eliminar") {
          const seated = await occupiedTablesOf(restaurantId, entryIds);
          if (seated.size > 0) {
            const labels = [...seated.values()].sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
            return fail(seatedBulkMessage(seated.size, new Set(entryIds).size, labels));
          }
        }
        const batch = await bulkWaitlist(restaurantId, action, entryIds, socket.data.userId);
        emitBatch(restaurantId, batch);
        return { ok: true as const, ...summary(batch) };
      });
    });

    socket.on("waitlist:cleanup", async (raw, ack) => {
      await respond(ack, async () => {
        const restaurantId = socket.data.restaurantId;
        if (!restaurantId) return fail("Primero entra en un restaurante.");
        if (
          !(await canModifyWaitlist({ userId: socket.data.userId }, restaurantId)) ||
          !(await canAssignTables({ userId: socket.data.userId }, restaurantId))
        ) {
          return fail("No tienes permiso para limpiar la lista y las mesas de este restaurante.");
        }
        const parsed = cleanupWaitlistSchema.safeParse(raw);
        if (!parsed.success) return fail("Elige 12 h, 24 h o 7 días.");
        if (parsed.data.preview) {
          return { ok: true as const, actionId: null, released: 0, changed: 0, removed: 0, preview: await previewCleanup(restaurantId, parsed.data.hours) };
        }
        const batch = await cleanupStale(restaurantId, parsed.data.hours, socket.data.userId);
        emitBatch(restaurantId, batch);
        return { ok: true as const, ...summary(batch) };
      });
    });

    socket.on("tables:release-all", async (raw, ack) => {
      await respond(ack, async () => {
        const restaurantId = socket.data.restaurantId;
        if (!restaurantId) return fail("Primero entra en un restaurante.");
        if (!(await canAssignTables({ userId: socket.data.userId }, restaurantId))) {
          return fail("No tienes permiso para sentar ni liberar mesas en este restaurante.");
        }
        const parsed = releaseAllTablesSchema.safeParse(raw);
        if (!parsed.success) return fail("Para liberar todas las mesas hay que escribir LIBERAR.");
        const batch = await releaseAllTables(restaurantId);
        emitBatch(restaurantId, batch);
        return { ok: true as const, ...summary(batch) };
      });
    });

    socket.on("waitlist:undo", async (raw, ack) => {
      await respond(ack, async () => {
        const restaurantId = socket.data.restaurantId;
        if (!restaurantId) return fail("Primero entra en un restaurante.");
        if (!(await canModifyWaitlist({ userId: socket.data.userId }, restaurantId))) {
          return fail("No tienes permiso para modificar la lista de espera en este restaurante.");
        }
        const parsed = undoWaitlistSchema.safeParse(raw);
        if (!parsed.success) return fail("Datos para deshacer no válidos.");

        const result = await undoWaitlistAction(restaurantId, parsed.data.actionId);
        if (!result.ok) return fail(result.error);
        const undo = getWaitlistUndoState(restaurantId);
        // Deshacer una acción en grupo: vuelven los clientes y se ocupan otra
        // vez las mesas que se habían liberado (si siguen libres).
        if (result.batch) {
          for (const t of result.batch.reoccupied) io.to(roomFor(restaurantId)).emit("table:assigned", t);
          for (const entry of result.batch.restored) io.to(roomFor(restaurantId)).emit("waitlist:changed", { action: "restored", entry, undo });
          io.to(roomFor(restaurantId)).emit("waitlist:undo-state", undo);
          void emitOverview(restaurantId);
          return { ok: true, action: "restored" as const, entry: result.entry };
        }
        // Deshacer «agregar varios» quita a todos: un aviso por cada uno.
        for (const entry of result.entries ?? (result.entry ? [result.entry] : [])) {
          io.to(roomFor(restaurantId)).emit("waitlist:changed", {
            action: result.action,
            entry,
            undo,
          });
        }
        io.to(roomFor(restaurantId)).emit("waitlist:undo-state", undo);
        void emitOverview(restaurantId);
        return { ok: true, action: result.action, entry: result.entry, entries: result.entries };
      });
    });
  });

  /**
   * Avisa a la room de una acción en grupo con los mismos eventos de siempre
   * (uno por mesa o cliente): las pantallas no necesitan nada nuevo para
   * enterarse. El plano en vivo los junta y se vuelve a pedir una vez.
   */
  function emitBatch(restaurantId: string, batch: BatchOutcome) {
    const room = io.to(roomFor(restaurantId));
    const undo = getWaitlistUndoState(restaurantId);
    for (const t of batch.released) room.emit("table:released", t);
    for (const entry of batch.changed) room.emit("waitlist:changed", { action: "resolved", entry, undo });
    for (const entry of batch.removed) room.emit("waitlist:changed", { action: "removed", entry, undo });
    room.emit("waitlist:undo-state", undo);
    void emitOverview(restaurantId);
  }

  setRealtimeServer(io);
  return io;
}

function summary(batch: BatchOutcome) {
  return { actionId: batch.actionId, released: batch.released.length, changed: batch.changed.length, removed: batch.removed.length };
}

function fail(error: string): { ok: false; error: string } {
  return { ok: false, error };
}

/**
 * Ejecuta un handler y contesta por el ack pase lo que pase.
 *
 * Un error inesperado no se le cuenta al cliente (podría llevar detalles de
 * la base de datos): se registra aquí y el cliente recibe un mensaje genérico.
 * Un cliente fabricado puede no mandar ack; entonces solo se ejecuta.
 */
async function respond<T extends object>(
  ack: unknown,
  handler: () => Promise<Ack<T>>,
): Promise<void> {
  let result: Ack<T>;
  try {
    result = await handler();
  } catch (err) {
    console.error("[realtime] error en un handler", err);
    result = fail("Error del servidor. Inténtalo de nuevo.");
  }
  if (typeof ack === "function") ack(result);
}
