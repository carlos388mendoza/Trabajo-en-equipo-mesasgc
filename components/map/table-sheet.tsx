"use client";

// Ficha de una mesa del plano en vivo: se abre al tocar la mesa.
//
// En la mesa del plano solo cabe lo esencial (nombre, cliente en corto y
// tiempo). Aquí va todo: estado, mesero, cliente, personas, hora de llegada,
// cuánto lleva y la nota, con las acciones que permita el rol:
//
//  - libre: «Sentar» (elige a alguien de la fila);
//  - ocupada: «Liberar mesa» y, con la regla de siempre, «Eliminar cliente»
//    solo después de liberar (`lib/waitlist/delete-rule.ts`). Mientras la
//    mesa siga ocupada, «Eliminar cliente» se ve atenuado y al tocarlo explica
//    que primero hay que liberar la mesa.
//
// El servidor vuelve a comprobar cada cosa (permiso, restaurante, mesa
// ocupada); esta ficha solo evita pedir lo que se sabe que va a fallar.

import { useEffect, useState } from "react";
import { Armchair, DoorOpen, Trash2, UsersRound, X } from "lucide-react";

import type { Ack, TableChange } from "@/lib/realtime/events";
import type { LayoutElement } from "@/lib/layout/types";
import { durationBetween } from "@/lib/time/duration";
import { HONDURAS_TIME_ZONE } from "@/lib/time/honduras";
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
  /** El mesero de la mesa en la configuración activa. */
  waiter: { color: string; label: string } | null;
  /** false para analítica: sin datos del cliente. */
  showNames: boolean;
  now: number;
  actions: TableSheetActions;
  onClose: () => void;
  /** Un aviso que se queda en el plano al cerrar la ficha. */
  onNotice: (text: string) => void;
};

const STATUS_TEXT: Record<string, string> = { libre: "Libre", ocupada: "Ocupada", reservada: "Reservada" };

const hour = new Intl.DateTimeFormat("es-HN", { timeZone: HONDURAS_TIME_ZONE, hour: "2-digit", minute: "2-digit", hour12: false });

/** El paso en que está la ficha. */
type Step =
  | { kind: "info" }
  | { kind: "release-first" }
  | { kind: "released"; entryId: string; name: string }
  | { kind: "confirm-delete"; entryId: string; name: string }
  | { kind: "seat"; list: WaitlistEntrySnapshot[] | null };

export function TableSheet({ element, waiter, showNames, now, actions, onClose, onNotice }: Props) {
  const [step, setStep] = useState<Step>({ kind: "info" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const occupied = element.currentEntryId !== null;
  const status = occupied ? "ocupada" : element.status === "reservada" ? "reservada" : "libre";
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
    // La ficha se queda abierta: ahora se puede eliminar al cliente si hace falta.
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
    onNotice(`${entry.customerName} se sentó en ${element.label}.${waiter ? ` Lo atiende ${waiter.label}.` : ""}`);
    onClose();
  }

  const buttonBase = "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-4 font-semibold transition disabled:opacity-45";
  const primary = `${buttonBase} bg-accent text-accent-text hover:opacity-90`;
  const secondary = `${buttonBase} border border-app-border text-panel-text hover:bg-app-border/50`;

  return (
    <div
      role="dialog"
      aria-labelledby="ficha-mesa-titulo"
      className="fixed inset-x-0 bottom-0 z-40 mx-auto max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-t-3xl bg-panel p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] text-panel-text shadow-2xl ring-1 ring-app-border sm:bottom-3 sm:rounded-3xl"
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 id="ficha-mesa-titulo" className="truncate text-2xl font-bold">{element.label}</h2>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-sm">
            <span
              className={`rounded-full px-2.5 py-0.5 font-semibold ${
                status === "ocupada"
                  ? "bg-estado-ocupada text-app-bg"
                  : status === "reservada"
                    ? "bg-estado-reservada text-app-bg"
                    : "bg-app-bg text-panel-text ring-1 ring-app-border"
              }`}
            >
              {STATUS_TEXT[status]}
            </span>
            {element.capacity ? <span className="text-panel-muted">{element.capacity} lugares</span> : null}
            <span className="flex items-center gap-1.5 text-panel-muted">
              {waiter ? (
                <>
                  <span aria-hidden className="h-3 w-3 rounded-full" style={{ backgroundColor: waiter.color }} />
                  Lo atiende <strong className="text-panel-text">{waiter.label}</strong>
                </>
              ) : (
                "Sin mesero"
              )}
            </span>
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Cerrar" className="-mr-2 -mt-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl hover:bg-app-border/60">
          <X aria-hidden size={20} />
        </button>
      </div>

      {occupied && showNames && step.kind !== "released" ? (
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 rounded-2xl bg-app-bg p-4 text-sm">
          <dt className="text-panel-muted">Cliente</dt>
          <dd className="break-words font-semibold">{element.occupantName}</dd>
          {detail ? (
            <>
              <dt className="text-panel-muted">Personas</dt>
              <dd className="flex items-center gap-1.5">
                <UsersRound aria-hidden size={15} /> {detail.partySize}
              </dd>
              <dt className="text-panel-muted">Llegó</dt>
              <dd>{hour.format(detail.arrivedAt)}</dd>
            </>
          ) : null}
          {element.seatedAt ? (
            <>
              <dt className="text-panel-muted">Ocupada desde hace</dt>
              <dd className="font-semibold">{durationBetween(element.seatedAt, now)}</dd>
            </>
          ) : null}
          {detail?.notes ? (
            <>
              <dt className="text-panel-muted">Nota</dt>
              <dd className="break-words">{detail.notes}</dd>
            </>
          ) : null}
        </dl>
      ) : occupied && !showNames ? (
        <p className="mt-4 rounded-2xl bg-app-bg p-4 text-sm text-panel-muted">Ocupada. Los datos del cliente no se muestran con este rol.</p>
      ) : null}

      {error ? (
        <p role="alert" className="mt-3 rounded-xl border border-estado-ocupada/40 px-3 py-2 text-sm">{error}</p>
      ) : null}

      {/* Mesa ocupada: liberar, y eliminar SOLO después de liberar. */}
      {occupied && step.kind === "info" && (actions.release || actions.deleteEntry) ? (
        <div className="mt-4 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
          {actions.release ? (
            <button type="button" disabled={busy} onClick={() => void release()} className={`${primary} sm:flex-1`}>
              <DoorOpen aria-hidden size={18} />
              {busy ? "Liberando…" : "Liberar mesa"}
            </button>
          ) : null}
          {actions.deleteEntry && showNames ? (
            <div className="flex flex-col sm:flex-1">
              <button
                type="button"
                disabled={busy}
                onClick={() => setStep({ kind: "release-first" })}
                aria-describedby="ficha-eliminar-ayuda"
                className={`${secondary} opacity-55`}
              >
                <Trash2 aria-hidden size={18} /> Eliminar cliente
              </button>
              <span id="ficha-eliminar-ayuda" className="mt-1 text-center text-xs text-panel-muted">{RELEASE_FIRST_HINT}</span>
            </div>
          ) : null}
        </div>
      ) : null}

      {occupied && step.kind === "release-first" ? (
        <div className="mt-4 rounded-2xl border border-estado-reservada/50 p-4">
          <p className="font-semibold">{seatedDeleteMessage(element.label)}</p>
          <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" disabled={busy} onClick={() => setStep({ kind: "info" })} className={secondary}>Cancelar</button>
            {actions.release ? (
              <button type="button" disabled={busy} onClick={() => void release()} className={primary}>
                <DoorOpen aria-hidden size={18} /> {busy ? "Liberando…" : "Liberar mesa"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {step.kind === "released" ? (
        <div className="mt-4 rounded-2xl border border-estado-libre/50 p-4">
          <p role="status" className="font-semibold">{releasedNowMessage(element.label)}</p>
          <p className="mt-1 text-sm text-panel-muted">
            {step.name} sigue en el historial. Liberar se puede deshacer con «Deshacer» en el modo sencillo.
          </p>
          <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" onClick={onClose} className={secondary}>Listo</button>
            {actions.deleteEntry ? (
              <button
                type="button"
                disabled={busy}
                onClick={() => setStep({ kind: "confirm-delete", entryId: step.entryId, name: step.name })}
                className={`${buttonBase} border border-estado-ocupada text-estado-ocupada hover:bg-estado-ocupada/10`}
              >
                <Trash2 aria-hidden size={18} /> Eliminar cliente
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      {step.kind === "confirm-delete" ? (
        <div className="mt-4 rounded-2xl border border-estado-ocupada/50 p-4">
          <p className="font-semibold">¿Eliminar a {step.name} de la lista?</p>
          <p className="mt-1 text-sm text-panel-muted">
            Deja de contar en las estadísticas. Se puede deshacer con «Deshacer» en el modo sencillo enseguida después.
          </p>
          <div className="mt-3 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <button type="button" disabled={busy} onClick={onClose} className={secondary}>Cancelar</button>
            <button
              type="button"
              disabled={busy}
              onClick={() => void remove(step.entryId, step.name)}
              className={`${buttonBase} border border-estado-ocupada bg-estado-ocupada text-app-bg hover:opacity-90`}
            >
              <Trash2 aria-hidden size={18} /> {busy ? "Eliminando…" : "Aceptar"}
            </button>
          </div>
        </div>
      ) : null}

      {/* Mesa libre: sentar a alguien de la fila. */}
      {!occupied && status === "libre" && step.kind === "info" && actions.assign && actions.loadWaiting ? (
        <div className="mt-4">
          <button type="button" onClick={() => void openSeat()} className={`${primary} w-full`}>
            <Armchair aria-hidden size={18} /> Sentar
          </button>
        </div>
      ) : null}

      {step.kind === "seat" ? (
        <div className="mt-4">
          <p className="text-sm font-semibold">¿A quién sientas en {element.label}?</p>
          {step.list === null ? (
            <p role="status" className="mt-2 text-sm text-panel-muted">Cargando la lista de espera…</p>
          ) : step.list.length === 0 ? (
            <p className="mt-2 text-sm text-panel-muted">No hay nadie esperando.</p>
          ) : (
            <ul className="mt-2 grid gap-2">
              {step.list.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void seat(entry)}
                    className="flex min-h-12 w-full items-center gap-3 rounded-xl border border-app-border px-3 text-left hover:bg-app-border/50 disabled:opacity-45"
                  >
                    <span className="min-w-0 flex-1 truncate font-semibold">{entry.customerName}</span>
                    <span className="flex shrink-0 items-center gap-1 text-sm text-panel-muted">
                      <UsersRound aria-hidden size={15} /> {entry.partySize}
                    </span>
                    <span className="shrink-0 text-sm tabular-nums text-panel-muted">{durationBetween(entry.arrivedAt, now)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button type="button" onClick={() => setStep({ kind: "info" })} className={`${secondary} mt-3 w-full`}>Cancelar</button>
        </div>
      ) : null}
    </div>
  );
}
