"use client";

// Conexión en tiempo real de una pantalla con su restaurante.
//
// Abre el socket, entra en la room del restaurante (y vuelve a entrar tras
// cada reconexión: una room no sobrevive a un socket nuevo) y expone
// `assignTable` / `releaseTable`, que devuelven la respuesta del servidor.
//
// Lo usa el editor; el modo rápido (Miembro B) puede usarlo igual.

import { useCallback, useEffect, useRef, useState } from "react";
import { io, type Socket } from "socket.io-client";

import type {
  Ack,
  AssignTableInput,
  ClientToServerEvents,
  ReleaseTableInput,
  ServerToClientEvents,
  TableChange,
} from "@/lib/realtime/events";

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export type RealtimeStatus = "conectando" | "en-vivo" | "sin-conexion";

export type RealtimeHandlers = Partial<ServerToClientEvents>;

// Los eventos que se reenvían a `handlers`. Una lista fija en vez de
// `onAny` para que TypeScript compruebe cada nombre.
const FORWARDED = [
  "table:assigned",
  "table:released",
  "layout:updated",
  "structure:changed",
] as const satisfies readonly (keyof ServerToClientEvents)[];

const ACK_TIMEOUT_MS = 5_000;

export function useRestaurantSocket(restaurantId: string, handlers: RealtimeHandlers) {
  const socketRef = useRef<ClientSocket | null>(null);
  const [status, setStatus] = useState<RealtimeStatus>("conectando");
  const [joinError, setJoinError] = useState<string | null>(null);

  // Los handlers cambian en cada render; guardarlos en un ref evita
  // reconectar el socket cada vez.
  const handlersRef = useRef(handlers);
  useEffect(() => {
    handlersRef.current = handlers;
  });

  useEffect(() => {
    // Vacío = mismo origen que la página, que es como lo sirve `server.ts`.
    const url = process.env.NEXT_PUBLIC_SOCKET_URL || undefined;
    const socket: ClientSocket = url ? io(url) : io();
    socketRef.current = socket;

    const join = () => {
      socket
        .timeout(ACK_TIMEOUT_MS)
        .emit("restaurant:join", { restaurantId }, (err, res) => {
          if (err) {
            setStatus("sin-conexion");
            setJoinError("El servidor no respondió.");
          } else if (res.ok) {
            setStatus("en-vivo");
            setJoinError(null);
          } else {
            setStatus("sin-conexion");
            setJoinError(res.error);
          }
        });
    };

    socket.on("connect", join);
    socket.on("disconnect", () => setStatus("sin-conexion"));
    socket.on("connect_error", () => setStatus("sin-conexion"));

    for (const event of FORWARDED) {
      socket.on(event, (...args: unknown[]) => {
        const handler = handlersRef.current[event] as
          | ((...a: unknown[]) => void)
          | undefined;
        handler?.(...args);
      });
    }

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
  }, [restaurantId]);

  const request = useCallback(
    async (
      event: "table:assign" | "table:release",
      payload: AssignTableInput | ReleaseTableInput,
    ): Promise<Ack<TableChange>> => {
      const socket = socketRef.current;
      if (!socket?.connected) {
        return { ok: false, error: "Sin conexión con el servidor." };
      }
      try {
        return await socket.timeout(ACK_TIMEOUT_MS).emitWithAck(event, payload);
      } catch {
        return { ok: false, error: "El servidor no respondió. Inténtalo de nuevo." };
      }
    },
    [],
  );

  /** Pide sentar a un cliente. No pintes la mesa ocupada hasta que diga ok. */
  const assignTable = useCallback(
    (payload: AssignTableInput) => request("table:assign", payload),
    [request],
  );

  const releaseTable = useCallback(
    (payload: ReleaseTableInput) => request("table:release", payload),
    [request],
  );

  return { status, joinError, assignTable, releaseTable };
}
