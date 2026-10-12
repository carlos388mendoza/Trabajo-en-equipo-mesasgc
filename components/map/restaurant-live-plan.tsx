"use client";

// El plano en vivo de /restaurante/[id]/mapa, conectado por el canal que le
// toca a quien lo mira:
//
//  - "restaurante": la room del restaurante (host y admin). Cualquier aviso
//    (sentar, liberar, guardar el plano) vuelve a pedir el plano.
//  - "overview": la sala del mapa general (analitica, que no entra en las
//    rooms porque en ellas viajan ids de clientes). Se recarga cuando cambian
//    los contadores de ESTE restaurante.
//
// En los dos casos hay además un respaldo cada 30 s.

import { useEffect, useRef, useState } from "react";
import { Radio, WifiOff } from "lucide-react";

import { LivePlan, type LivePlanProps } from "@/components/map/live-plan";
import { FALLBACK_REFRESH_MS, useOverviewSocket } from "@/components/map/use-overview-socket";
import { type RealtimeStatus, useRestaurantSocket } from "@/components/realtime/use-restaurant-socket";
import type { LivePlan as LivePlanData } from "@/lib/map/queries";
import type { WaitlistEntrySnapshot } from "@/lib/waitlist/quick-actions";

type Props = {
  restaurantId: string;
  initialPlan: LivePlanData;
  live: "restaurante" | "overview";
  /** `meseros:gestionar` en este restaurante. */
  canManageWaiters?: boolean;
  startEditingWaiters?: boolean;
  /** Modo inmersivo de la tablet en horizontal (ver `LivePlan`). */
  immersive?: LivePlanProps["immersive"];
  /** `mesas:asignar`: puede sentar y liberar mesas desde el plano (una o todas). */
  canReleaseTables?: boolean;
  /** `rapido:modificar`: puede eliminar a un cliente desde la ficha de la mesa (ya liberada). */
  canDeleteClients?: boolean;
};

export function RestaurantLivePlan(props: Props) {
  return props.live === "restaurante" ? <ViaRestaurantRoom {...props} /> : <ViaOverview {...props} />;
}

/** Un número que sube solo cada 30 s: el respaldo si un aviso se pierde. */
function useFallbackTick(): number {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") setTick((t) => t + 1);
    }, FALLBACK_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, []);
  return tick;
}

function ViaRestaurantRoom({ restaurantId, initialPlan, canManageWaiters, startEditingWaiters, immersive, canReleaseTables, canDeleteClients }: Props) {
  const [events, setEvents] = useState(0);
  const tick = useFallbackTick();
  // Varios avisos seguidos (liberar todas las mesas, limpiar pendientes,
  // agregar varios) piden el plano UNA vez, 400 ms después del último: cada
  // petición recalcula el plano entero en el servidor y redibuja el lienzo.
  const pending = useRef<number | null>(null);
  const bump = () => {
    if (pending.current !== null) window.clearTimeout(pending.current);
    pending.current = window.setTimeout(() => {
      pending.current = null;
      setEvents((n) => n + 1);
    }, 400);
  };
  useEffect(() => () => {
    if (pending.current !== null) window.clearTimeout(pending.current);
  }, []);
  const { status, assignTable, releaseTable, releaseAllTables, deleteEntry } = useRestaurantSocket(restaurantId, {
    "table:assigned": bump,
    "table:released": bump,
    "layout:updated": bump,
    "structure:changed": bump,
    // Otra tablet activó, guardó o borró una configuración de meseros.
    "waiters:changed": bump,
    // Alguien entró a la fila, se resolvió o se deshizo: cambia el número del
    // botón «Lista de espera».
    "waitlist:changed": bump,
  });
  return (
    <LivePlan
      restaurantId={restaurantId}
      initialPlan={initialPlan}
      refreshSignal={`${events}-${tick}`}
      toolbar={<LiveBadge status={status} />}
      canManageWaiters={canManageWaiters}
      startEditingWaiters={startEditingWaiters}
      immersive={immersive}
      tableActions={{
        release: canReleaseTables ? releaseTable : undefined,
        releaseAll: canReleaseTables ? releaseAllTables : undefined,
        assign: canReleaseTables && immersive?.waitlistHref ? assignTable : undefined,
        // Para «Sentar» desde la ficha: los que siguen en la fila.
        loadWaiting: canReleaseTables && immersive?.waitlistHref ? () => loadWaiting(restaurantId) : undefined,
        deleteEntry: canDeleteClients ? deleteEntry : undefined,
      }}
    />
  );
}

/** Los que esperan (en espera o listos), del primero que llegó al último. */
async function loadWaiting(restaurantId: string): Promise<WaitlistEntrySnapshot[] | null> {
  try {
    const res = await fetch(`/api/restaurante/${restaurantId}/clientes`, { cache: "no-store" });
    if (!res.ok) return null;
    const { entries } = (await res.json()) as { entries: WaitlistEntrySnapshot[] };
    return entries.filter((e) => e.status === "esperando" || e.status === "listo").sort((a, b) => a.arrivedAt - b.arrivedAt);
  } catch {
    return null;
  }
}

function ViaOverview({ restaurantId, initialPlan, immersive }: Props) {
  const { counters, status } = useOverviewSocket([]);
  const tick = useFallbackTick();
  const mine = counters[restaurantId];
  return (
    <LivePlan
      restaurantId={restaurantId}
      initialPlan={initialPlan}
      refreshSignal={`${mine ? JSON.stringify(mine) : ""}-${tick}`}
      toolbar={<LiveBadge status={status} />}
      immersive={immersive}
    />
  );
}

function LiveBadge({ status }: { status: RealtimeStatus }) {
  return (
    <span
      className={`flex items-center gap-1.5 rounded-full bg-panel px-3 py-1.5 text-xs font-semibold ring-1 ring-app-border ${
        status === "en-vivo" ? "text-estado-libre" : "text-panel-muted"
      }`}
    >
      {status === "en-vivo" ? <Radio aria-hidden size={14} /> : <WifiOff aria-hidden size={14} />}
      {status === "en-vivo" ? "En vivo" : status === "conectando" ? "Conectando…" : "Sin conexión: se actualiza cada 30 s"}
    </span>
  );
}
