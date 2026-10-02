"use client";

// Estado de la conexión del modo sencillo, siempre a la vista:
//   🟢 Conectado · 🟠 Sincronizando… · 🔴 Sin conexión · «3 cambios pendientes»
//   · 🟢 Sincronizado (unos segundos, después de mandar la cola).
// Debajo, los cambios que el servidor rechazó al sincronizar (otro
// dispositivo se adelantó), hasta que el host diga «Entendido»: un conflicto
// no se esconde.

import { AlertTriangle, CloudOff, RefreshCw, Wifi, CheckCircle2 } from "lucide-react";

import { plural } from "@/components/quick-mode/format";
import type { QueuedOperation } from "@/lib/offline/apply";

export type SyncPhase = "conectado" | "sincronizando" | "sin-conexion" | "sincronizado";

export function syncPhase({ connected, syncing, justSynced }: { connected: boolean; syncing: boolean; justSynced: boolean }): SyncPhase {
  if (!connected) return "sin-conexion";
  if (syncing) return "sincronizando";
  return justSynced ? "sincronizado" : "conectado";
}

const PHASE = {
  conectado: { dot: "bg-estado-libre", text: "Conectado", Icon: Wifi },
  sincronizando: { dot: "bg-estado-reservada", text: "Sincronizando…", Icon: RefreshCw },
  "sin-conexion": { dot: "bg-estado-ocupada", text: "Sin conexión", Icon: CloudOff },
  sincronizado: { dot: "bg-estado-libre", text: "Sincronizado", Icon: CheckCircle2 },
} as const;

export function SyncStatus({ phase, pending }: { phase: SyncPhase; pending: number }) {
  const { dot, text, Icon } = PHASE[phase];
  return (
    <span role="status" aria-live="polite" className="inline-flex flex-wrap items-center gap-2 text-sm text-panel-muted">
      <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${dot} ${phase === "sincronizando" ? "animate-pulse" : ""}`} />
      <Icon aria-hidden size={15} className={phase === "sincronizando" ? "animate-spin" : ""} />
      <span className="font-medium text-panel-text">{text}</span>
      {pending > 0 && (
        <span className="rounded-full bg-estado-reservada/15 px-2 py-0.5 text-xs font-semibold text-estado-reservada">
          {plural(pending, "cambio pendiente", "cambios pendientes")}
        </span>
      )}
    </span>
  );
}

export function ConflictList({ conflicts, onDismiss }: { conflicts: QueuedOperation[]; onDismiss: () => void }) {
  if (conflicts.length === 0) return null;
  return (
    <div role="alert" className="mt-4 rounded-2xl border border-estado-ocupada/50 bg-estado-ocupada/5 p-4 text-sm text-panel-text">
      <p className="flex items-center gap-2 font-semibold">
        <AlertTriangle aria-hidden size={17} className="text-estado-ocupada" />
        {conflicts.length === 1
          ? "Un cambio hecho sin conexión no se pudo aplicar"
          : `${conflicts.length} cambios hechos sin conexión no se pudieron aplicar`}
      </p>
      <p className="mt-1 text-panel-muted">Otro dispositivo los cambió antes. La lista ya muestra lo que hay de verdad.</p>
      <ul className="mt-2 space-y-1">
        {conflicts.map((op) => (
          <li key={op.operationId}>
            <span className="font-medium">{op.label}:</span> <span className="text-panel-muted">{op.error}</span>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onDismiss}
        className="mt-3 inline-flex min-h-10 items-center rounded-xl border border-app-border bg-panel px-4 font-semibold transition hover:bg-app-border/50"
      >
        Entendido
      </button>
    </div>
  );
}
