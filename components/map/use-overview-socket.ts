"use client";

// Conexión del mapa general con la sala `overview`.
//
// Entra en la sala por la conexión de tiempo real (`lib/realtime/client.ts`,
// HTTP con sondeo corto), vuelve a entrar tras cada reconexión (y entonces
// recarga todos los contadores), y los actualiza con cada `overview:counters`. Además pide los contadores cada 30 s por una server
// action: si el socket se cae, o si un cambio no avisa (los clientes que
// añade el modo rápido, hasta que llame a `emitOverview`), el mapa se pone al
// día solo.

import { useCallback, useEffect, useState } from "react";

import { loadOverviewCounters } from "@/app/mapa/actions";
import type { RealtimeStatus } from "@/components/realtime/use-restaurant-socket";
import { createRealtimeClient } from "@/lib/realtime/client";
import type { Ack, RestaurantCounters } from "@/lib/realtime/events";

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
    const socket = createRealtimeClient({ fastMs: 5_000, slowMs: 30_000 });

    const join = () => {
      socket.timeout(ACK_TIMEOUT_MS).emit("overview:join", {}, (err, raw) => {
        const res = raw as Ack<{ counters: RestaurantCounters[] }> | undefined;
        if (err || !res || !res.ok) {
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
    socket.connect();

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
