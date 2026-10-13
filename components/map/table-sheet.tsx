"use client";

// Panel de una mesa del plano en vivo: se abre al tocar la mesa, abajo, con
// el mismo aspecto que tuvo siempre el de «Liberar mesa» (caja redondeada,
// una línea con quién está y desde cuándo, botones de 44 px).
//
// Acciones, cada una solo con su permiso:
//
//  - libre: «Sentar» (elige a alguien de la fila);
//  - ocupada: «Liberar mesa» y, con la regla de siempre, «Eliminar cliente»
//    solo después de liberar (`lib/waitlist/delete-rule.ts`). Mientras la
//    mesa siga ocupada, «Eliminar cliente» se ve atenuado y al tocarlo explica
//    que primero hay que liberar la mesa.
//
// El servidor vuelve a comprobar cada cosa (permiso, restaurante, mesa
// ocupada); este panel solo evita pedir lo que se sabe que va a fallar.

import { useEffect, useState } from "react";
import { Armchair, DoorOpen, Trash2, X } from "lucide-react";

import type { Ack, TableChange } from "@/lib/realtime/events";
import type { LayoutElement } from "@/lib/layout/types";
import { durationBetween } from "@/lib/time/duration";
import { HONDURAS_TIME_ZONE } from "@/lib/time/honduras";
import { waiterColorName } from "@/lib/waiters/palette";
import { RELEASE_FIRST_HINT, releasedNowMessage, seatedDeleteMessage } from "@/lib/waitlist/delete-rule";
import type { WaitlistEntrySnapshot } from "@/lib/waitlist/quick-actions";

export type TableSheetActions = {
  /** `mesas:asignar`. */
  release?: (payload: { tableId: string; entryId: string }) => Promise<Ack<TableChange>>;
  assign?: (payload: { tableId: string; entryId: string }) => Promise<Ack<TableChange>>;
  /** Los que esperan (en espera o listos), para «Sentar». */
  loadWaiting?: () => Promise<WaitlistEntrySnapshot[] | null>;
  /** `rapido:modificar`: eliminar al cliente (solo si ya no tiene mesa). */
  deleteEntry?: (entryId: string) => Promise<Ack<object>>;
};

type Props = {
  element: LayoutElement;
  /** El mesero de la mesa en la configuración activa (se le reconoce por su color). */
  waiter: { color: string; label: string } | null;
  /** false para analítica: sin datos del cliente. */
  showNames: boolean;
  now: number;
  actions: TableSheetActions;
  onClose: () => void;
  /** Un aviso que se queda en el plano al cerrar el panel. */
  onNotice: (text: string) => void;
};

const hour = new Intl.DateTimeFormat("es-HN", { timeZone: HONDURAS_TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false });

/** El paso en que está el panel. */
type Step =
  | { kind: "info" }
  | { kind: "release-first" }
  | { kind: "released"; entryId: string; name: string }
  | { kind: "confirm-delete"; entryId: string; name: string }
  | { kind: "seat"; list: WaitlistEntrySnapshot[] | null };

// Los botones de siempre del panel (los del antiguo «Liberar mesa»).
const PRIMARY =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-text hover:bg-accent/85 disabled:opacity-50";
const SECONDARY =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl px-4 text-sm font-semibold text-panel-text ring-1 ring-app-border hover:bg-app-border/60 disabled:opacity-50";
const DANGER =
  "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl bg-estado-ocupada px-4 text-sm font-semibold text-app-bg hover:opacity-90 disabled:opacity-50";

export function TableSheet({ element, waiter, showNames, now, actions, onClose, onNotice }: Props) {
  const [step, setStep] = useState<Step>({ kind: "info" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const occupied = element.currentEntryId !== null;
  const detail = element.occupantDetail ?? null;

  // Esc cierra.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function run<T extends object>(work: () => Promise<Ack<T>>): Promise<(T & { ok: true }) | null> {
    setBusy(true);
    setError(null);
    try {
      const result = await work();
      if (!result.ok) {
        setError(result.error);
        return null;
      }
      return result as T & { ok: true };
    } finally {
      setBusy(false);
    }
  }

  async function release() {
    if (!actions.release || !element.currentEntryId) return;
    const entryId = element.currentEntryId;
    const name = element.occupantName ?? "el cliente";
    const ok = await run(() => actions.release!({ tableId: element.id, entryId }));
    if (!ok) return;
    // El panel se queda abierto: ahora se puede eliminar al cliente si hace falta.
    setStep({ kind: "released", entryId, name });
  }

  async function remove(entryId: string, name: string) {
    if (!actions.deleteEntry) return;
    const ok = await run(() => actions.deleteEntry!(entryId));
    if (!ok) return;
    onNotice(`Se eliminó a ${name}. Puedes deshacerlo con «Deshacer» en el modo sencillo.`);
    onClose();
  }

  async function openSeat() {
    if (!actions.loadWaiting) return;
    setStep({ kind: "seat", list: null });
    const list = await actions.loadWaiting();
    if (list === null) {
      setError("No se pudo cargar la lista de espera.");
      setStep({ kind: "info" });
      return;
    }
    setStep({ kind: "seat", list });
  }

  async function seat(entry: WaitlistEntrySnapshot) {
    if (!actions.assign) return;
    const ok = await run(() => actions.assign!({ tableId: element.id, entryId: entry.id }));
    if (!ok) return;
    onNotice(`${entry.customerName} se sentó en ${element.label}.`);
    onClose();
  }

  // La línea de debajo del nombre: quién está y desde cuándo (como antes).
  const summary = occupied
    ? showNames && element.occupantName
      ? `Ocupada por ${element.occupantName}${detail ? ` · ${detail.partySize} ${detail.partySize === 1 ? "persona" : "personas"}` : ""}${
          element.seatedAt ? ` · desde hace ${durationBetween(element.seatedAt, now)}` : ""
        }`
      : "Ocupada"
    : element.status === "reservada"
      ? "Reservada"
      : "Libre";

  return (
    <div
      role="dialog"
      aria-label={`Mesa ${element.label}`}
      className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 mx-auto max-h-[80dvh] max-w-md overflow-y-auto rounded-2xl bg-panel p-4 text-panel-text shadow-2xl ring-1 ring-app-border"
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-2 font-semibold">
            {waiter ? (
              <span
                className="h-3.5 w-3.5 shrink-0 rounded-full ring-2 ring-panel"
                style={{ backgroundColor: waiter.color }}
                title={`Mesero ${waiterColorName(waiter.color)}`}
              >
                <span className="sr-only">Mesero {waiterColorName(waiter.color)}</span>
              </span>
            ) : null}
            {element.label}
          </p>
          <p className="text-sm text-panel-muted">{step.kind === "released" ? "Libre" : summary}</p>
          {occupied && showNames && detail && step.kind === "info" ? (
            <p className="text-sm text-panel-muted">
              Llegó a las {hour.format(detail.arrivedAt)}
              {detail.notes ? ` · ${detail.notes}` : ""}
            </p>
          ) : null}
        </div>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl hover:bg-app-border/60">
          <X aria-hidden size={18} />
        </button>
      </div>

      {error ? (
        <p role="alert" className="mt-3 rounded-xl px-3 py-2 text-sm ring-1 ring-estado-ocupada/40">{error}</p>
      ) : null}

      {/* Mesa ocupada: liberar, y eliminar SOLO después de liberar. */}
      {occupied && step.kind === "info" && (actions.release || (actions.deleteEntry && showNames)) ? (
        <div className="mt-3 flex flex-wrap items-start gap-2">
          {actions.release ? (
            <button type="button" disabled={busy} onClick={() => void release()} className={PRIMARY}>
              <DoorOpen aria-hidden size={17} />
              {busy ? "Liberando…" : "Liberar mesa"}
            </button>
          ) : null}
          {actions.deleteEntry && showNames ? (
            <div className="flex flex-col items-center">
              <button
                type="button"
                disabled={busy}
                onClick={() => setStep({ kind: "release-first" })}
                aria-describedby="panel-eliminar-ayuda"
                className={`${SECONDARY} opacity-55`}
              >
                <Trash2 aria-hidden size={17} /> Eliminar cliente
              </button>
              <span id="panel-eliminar-ayuda" className="mt-0.5 text-xs text-panel-muted">{RELEASE_FIRST_HINT}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {occupied && step.kind === "release-first" ? (
        <div className="mt-3">
          <p className="text-sm font-semibold">{seatedDeleteMessage(element.label)}</p>
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <button type="button" disabled={busy} onClick={() => setStep({ kind: "info" })} className={SECONDARY}>Cancelar</button>
            {actions.release ? (
              <button type="button" disabled={busy} onClick={() => void release()} className={PRIMARY}>
                <DoorOpen aria-hidden size={17} /> {busy ? "Liberando…" : "Liberar mesa"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {step.kind === "released" ? (
        <div className="mt-3">
          <p role="status" className="text-sm font-semibold">{releasedNowMessage(element.label)}</p>
          <p className="text-sm text-panel-muted">Liberar se puede deshacer con «Deshacer» en el modo sencillo.</p>
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <button type="button" onClick={onClose} className={SECONDARY}>Listo</button>
            {actions.deleteEntry ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => setStep({ kind: "confirm-delete", entryId: step.entryId, name: step.name })}
                className={`${SECONDARY} text-estado-ocupada`}
              >
                <Trash2 aria-hidden size={17} /> Eliminar cliente
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {step.kind === "confirm-delete" ? (
        <div className="mt-3">
          <p className="text-sm font-semibold">¿Eliminar a {step.name} de la lista?</p>
          <p className="text-sm text-panel-muted">Deja de contar en las estadísticas. Se puede deshacer enseguida en el modo sencillo.</p>
          <div className="mt-2 flex flex-wrap justify-end gap-2">
            <button type="button" disabled={busy} onClick={onClose} className={SECONDARY}>Cancelar</button>
            <button type="button" disabled={busy} onClick={() => void remove(step.entryId, step.name)} className={DANGER}>
              <Trash2 aria-hidden size={17} /> {busy ? "Eliminando…" : "Aceptar"}
            </button>
          </div>
        </div>
      ) : null}

      {/* Mesa libre: sentar a alguien de la fila. */}
      {!occupied && element.status !== "reservada" && step.kind === "info" && actions.assign && actions.loadWaiting ? (
        <div className="mt-3 flex">
          <button type="button" onClick={() => void openSeat()} className={PRIMARY}>
            <Armchair aria-hidden size={17} /> Sentar
          </button>
        </div>
      ) : null}

      {step.kind === "seat" ? (
        <div className="mt-3">
          <p className="text-sm font-semibold">¿A quién sientas en {element.label}?</p>
          {step.list === null ? (
            <p role="status" className="mt-1 text-sm text-panel-muted">Cargando la lista de espera…</p>
          ) : step.list.length === 0 ? (
            <p className="mt-1 text-sm text-panel-muted">No hay nadie esperando.</p>
          ) : (
            <ul className="mt-2 grid max-h-60 gap-1.5 overflow-y-auto">
              {step.list.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void seat(entry)}
                    className="flex min-h-11 w-full items-center gap-3 rounded-xl px-3 text-left text-sm ring-1 ring-app-border hover:bg-app-border/60 disabled:opacity-50"
                  >
                    <span className="min-w-0 flex-1 truncate font-semibold">{entry.customerName}</span>
                    <span className="shrink-0 text-panel-muted">
                      {entry.partySize} {entry.partySize === 1 ? "persona" : "personas"} · {durationBetween(entry.arrivedAt, now)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex justify-end">
            <button type="button" onClick={() => setStep({ kind: "info" })} className={SECONDARY}>Cancelar</button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
