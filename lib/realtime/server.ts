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
  addWaitlistEntry,
  getWaitlistUndoState,
  resolveWaitlistEntry,
  undoWaitlistAction,
} from "@/lib/waitlist/quick-actions";

import { canAssignTables, canJoinOverview, canJoinRestaurant, canModifyWaitlist, identifySocket } from "./auth";
import {
  type Ack,
  OVERVIEW_ROOM,
  addWaitlistEntrySchema,
  assignTableSchema,
  joinRestaurantSchema,
  releaseTableSchema,
  resolveWaitlistEntrySchema,
  roomFor,
  undoWaitlistSchema,
} from "./events";
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

        const result = await assignTable({
          restaurantId,
          ...parsed.data,
          userId: socket.data.userId,
        });
        if (!result.ok) return fail(result.error);

        const change = { table: result.table, entryId: result.entryId };
        io.to(roomFor(restaurantId)).emit("table:assigned", change);
        // Contadores al mapa general, sin esperar: el ack no depende de eso.
        void emitOverview(restaurantId);
        return { ok: true, ...change };
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

        const result = await releaseTable({ restaurantId, ...parsed.data });
        if (!result.ok) return fail(result.error);

        const change = { table: result.table, entryId: result.entryId };
        io.to(roomFor(restaurantId)).emit("table:released", change);
        void emitOverview(restaurantId);
        return { ok: true, ...change };
      });
    });

    socket.on("waitlist:add", async (raw, ack) => {
      await respond(ack, async () => {
        const restaurantId = socket.data.restaurantId;
        if (!restaurantId) return fail("Primero entra en un restaurante.");
        if (!(await canModifyWaitlist({ userId: socket.data.userId }, restaurantId))) {
          return fail("No tienes permiso para modificar la lista de espera en este restaurante.");
        }
        const parsed = addWaitlistEntrySchema.safeParse(raw);
        if (!parsed.success) return fail("Revisa el nombre y la cantidad de personas.");

        const result = await addWaitlistEntry(restaurantId, parsed.data);
        if (!result.ok) return fail(result.error);
        const undo = getWaitlistUndoState(restaurantId);
        const change = { action: "added" as const, entry: result.entry, undo };
        io.to(roomFor(restaurantId)).emit("waitlist:changed", change);
        io.to(roomFor(restaurantId)).emit("waitlist:undo-state", undo);
        return { ok: true, entry: result.entry, actionId: result.actionId };
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

        const result = await resolveWaitlistEntry(
          restaurantId,
          parsed.data.entryId,
          parsed.data.status,
        );
        if (!result.ok) return fail(result.error);
        const undo = getWaitlistUndoState(restaurantId);
        io.to(roomFor(restaurantId)).emit("waitlist:changed", {
          action: "resolved",
          entry: result.entry,
          undo,
        });
        io.to(roomFor(restaurantId)).emit("waitlist:undo-state", undo);
        return { ok: true, entry: result.entry, actionId: result.actionId };
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
        io.to(roomFor(restaurantId)).emit("waitlist:changed", {
          action: result.action,
          entry: result.entry,
          undo,
        });
        io.to(roomFor(restaurantId)).emit("waitlist:undo-state", undo);
        return { ok: true, action: result.action, entry: result.entry };
      });
    });
  });

  setRealtimeServer(io);
  return io;
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
