"use client";

// Conexión del mapa general con la sala `overview`.
//
// Entra en la sala (y vuelve a entrar tras cada reconexión), guarda los
// contadores de todos los restaurantes y los actualiza con cada
// `overview:counters`. Además pide los contadores cada 30 s por una server
// action: si el socket se cae, o si un cambio no avisa (los clientes que
// añade el modo rápido, hasta que llame a `emitOverview`), el mapa se pone al
// día solo.

import { useCallback, useEffect, useState } from "react";
import { io, type Socket } from "socket.io-client";

import { loadOverviewCounters } from "@/app/mapa/actions";
import type { RealtimeStatus } from "@/components/realtime/use-restaurant-socket";
import type { ClientToServerEvents, RestaurantCounters, ServerToClientEvents } from "@/lib/realtime/events";

type ClientSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

const ACK_TIMEOUT_MS = 5_000;
export const FALLBACK_REFRESH_MS = 30_000;

function toMap(list: RestaurantCounters[]): Record<string, RestaurantCounters> {
  return Object.fromEntries(list.map((c) => [c.restaurantId, c]));
}

export function useOverviewSocket(initial: RestaurantCounters[]) {
  const [counters, setCounters] = useState(() => toMap(initial));
  const [status, setStatus] = useState<RealtimeStatus>("conectando");

  const merge = useCallback((list: RestaurantCounters[]) => {
    setCounters((prev) => ({ ...prev, ...toMap(list) }));
  }, []);

  useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SOCKET_URL || undefined;
    const socket: ClientSocket = url ? io(url) : io();

    const join = () => {
      socket.timeout(ACK_TIMEOUT_MS).emit("overview:join", {}, (err, res) => {
        if (err || !res.ok) {
          setStatus("sin-conexion");
          return;
        }
        setStatus("en-vivo");
        merge(res.counters);
      });
    };

    socket.on("connect", join);
    socket.on("disconnect", () => setStatus("sin-conexion"));
    socket.on("connect_error", () => setStatus("sin-conexion"));
    socket.on("overview:counters", (c) => merge([c]));

    return () => {
      socket.disconnect();
    };
  }, [merge]);

  // Respaldo: cada 30 s, y solo con la pestaña visible.
  useEffect(() => {
    const timer = window.setInterval(async () => {
      if (document.visibilityState !== "visible") return;
      const res = await loadOverviewCounters().catch(() => null);
      if (res?.ok) merge(res.counters);
    }, FALLBACK_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [merge]);

  return { counters, status };
}
