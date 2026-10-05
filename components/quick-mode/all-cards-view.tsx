"use client";

// «Ver todas las cartas»: todas las del restaurante (en espera, listas,
// ausentes y sentadas) de hoy o de los últimos 7 días, con filtros por estado
// y un buscador por nombre. Una en espera se marca lista o ausente; una lista
// o ausente vuelve a la espera. Todo pasa por el socket del modo rápido, así
// que se puede deshacer igual que un deslizamiento, y los cambios de otras
// tablets llegan en vivo (`subscribe`).
//
// Los datos salen de `GET /api/restaurante/[id]/cartas`, que exige
// `rapido:ver`: el host solo ve las de sus restaurantes y analitica ninguna.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Armchair, Check, Clock3, DoorOpen, LayoutGrid, RotateCcw, Search, Trash2, Undo2, UsersRound, X } from "lucide-react";

import {
  arrivalLabel,
  minutes,
  minutesBetween,
  people,
  plural,
  waitColor,
} from "@/components/quick-mode/format";
import { DemoTag } from "@/components/quick-mode/demo-tag";
import { Overlay, SheetHandle, useSheetDrag } from "@/components/quick-mode/overlay";
import type { WaitlistStatus } from "@/lib/db/enums";
import type { WaitlistChange, WaitlistUndoState } from "@/lib/realtime/events";
import type { WaitlistEntrySnapshot } from "@/lib/waitlist/quick-actions";
import type { SeatableTable } from "@/lib/tables/list";
import { addCalendarDays, hondurasMidnightUtc, hondurasToday } from "@/lib/time/honduras";

/**
 * Desde cuándo cuenta un rango, en el navegador (lo mismo que `rangeStart`
 * de `lib/waitlist/cards.ts`, que no se puede importar aquí: usa la base).
 */
function rangeStartMs(range: CardRange, now: number): number {
  const today = hondurasToday(new Date(now));
  return hondurasMidnightUtc(range === "hoy" ? today : addCalendarDays(today, -6)).getTime();
}
import type { CardRange } from "@/lib/waitlist/cards";

export type StatusFilter = "todas" | Extract<WaitlistStatus, "esperando" | "listo" | "ausente">;

const RANGES: { value: CardRange; label: string }[] = [
  { value: "hoy", label: "Hoy" },
  { value: "7dias", label: "Últimos 7 días" },
];

const FILTERS: { value: StatusFilter; label: string }[] = [
  { value: "todas", label: "Todas" },
  { value: "esperando", label: "En espera" },
  { value: "listo", label: "Listo" },
  { value: "ausente", label: "Ausente" },
];

const STATUS_LABEL: Record<WaitlistStatus, string> = {
  esperando: "En espera",
  listo: "Listo",
  ausente: "Ausente",
  sentado: "Sentado",
};

const STATUS_STYLE: Record<WaitlistStatus, string> = {
  esperando: "border-accent/40 text-accent",
  listo: "border-estado-libre/50 text-estado-libre",
  ausente: "border-estado-ocupada/50 text-estado-ocupada",
  sentado: "border-app-border text-panel-muted",
};

type AllCardsViewProps = {
  open: boolean;
  restaurantId: string;
  initialFilter: StatusFilter;
  now: number;
  connected: boolean;
  undoState: WaitlistUndoState;
  onClose: () => void;
  /** Registra un oyente de los cambios en vivo; devuelve cómo quitarlo. */
  subscribe: (listener: (change: WaitlistChange) => void) => () => void;
  onResolve: (entryId: string, status: "listo" | "ausente") => Promise<boolean>;
  onReopen: (entryId: string) => Promise<boolean>;
  onDelete: (entryId: string) => Promise<boolean>;
  onUndo: () => Promise<void>;
  /**
   * Lo que la tablet ya sabe (con la cola aplicada): se usa si no hay red para
   * pedir las cartas al servidor, o mientras llegan.
   */
  localEntries: WaitlistEntrySnapshot[];
  /** Aplica la cola sin conexión encima de lo que vino del servidor. */
  applyPending: (entries: WaitlistEntrySnapshot[]) => WaitlistEntrySnapshot[];
  /** Mesas (con la cola aplicada): para saber quién tiene mesa y liberarla. */
  tables: SeatableTable[];
  onSeat: (entry: WaitlistEntrySnapshot) => void;
  onRelease: (entryId: string, tableId: string) => Promise<boolean>;
};

export function AllCardsView(props: AllCardsViewProps) {
  return (
    <Overlay open={props.open} onClose={props.onClose} labelledBy="todas-cartas-titulo" size="wide" draggable>
      <AllCardsContent {...props} />
    </Overlay>
  );
}

function AllCardsContent({
  restaurantId,
  initialFilter,
  now,
  connected,
  undoState,
  subscribe,
  onResolve,
  onReopen,
  onDelete,
  onUndo,
  localEntries,
  applyPending,
  tables,
  onSeat,
  onRelease,
}: AllCardsViewProps) {
  // Arrastrar el panel desde la cabecera (null fuera de un panel arrastrable).
  const drag = useSheetDrag();
  const [range, setRange] = useState<CardRange>("hoy");
  const [filter, setFilter] = useState<StatusFilter>(initialFilter);
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<WaitlistEntrySnapshot[]>([]);
  // Rango que ya llegó: mientras no coincide con el elegido, se está cargando.
  const [loadedRange, setLoadedRange] = useState<CardRange | null>(null);
  const loading = loadedRange !== range;
  const [error, setError] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  // La carta que se está a punto de borrar: se pide confirmación en una
  // ventana propia, con el nombre del cliente escrito en grande.
  const [confirmDelete, setConfirmDelete] = useState<WaitlistEntrySnapshot | null>(null);
  const loadVersion = useRef(0);
  /** Las cartas son la copia de la tablet (no se pudieron pedir al servidor). */
  const [fromLocal, setFromLocal] = useState(false);
  const connectedRef = useRef(connected);
  useEffect(() => {
    connectedRef.current = connected;
  }, [connected]);
  const inFlight = useRef(false);
  const staleWhileLoading = useRef(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const version = ++loadVersion.current;
      inFlight.current = true;
      staleWhileLoading.current = false;
      try {
        const response = await fetch(`/api/restaurante/${restaurantId}/cartas?rango=${range}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se pudieron cargar las cartas.");
        if (cancelled || version !== loadVersion.current) return;
        setEntries(data.entries as WaitlistEntrySnapshot[]);
        setFromLocal(false);
        setError("");
      } catch (cause) {
        if (!cancelled && version === loadVersion.current) {
          // Sin conexión no es un error: se enseña lo que la tablet ya tiene.
          if (connectedRef.current) setError(cause instanceof Error ? cause.message : "No se pudieron cargar las cartas.");
          else setError("");
          setFromLocal(true);
        }
      } finally {
        if (!cancelled && version === loadVersion.current) {
          inFlight.current = false;
          setLoadedRange(range);
          // Hubo un cambio en vivo mientras llegaba: la respuesta puede traer
          // el estado de antes. Se pide otra vez.
          if (staleWhileLoading.current) void load();
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
      inFlight.current = false;
    };
    // `connected`: al volver la red se piden otra vez, ya con lo sincronizado.
  }, [restaurantId, range, connected]);

  // En vivo: cada cambio de la room se aplica sobre la lista que ya hay.
  useEffect(() => subscribe(({ action, entry }) => {
    if (inFlight.current) staleWhileLoading.current = true;
    setEntries((items) => {
      const rest = items.filter((item) => item.id !== entry.id);
      if (action === "removed") return rest;
      return [entry, ...rest].sort((a, b) => b.arrivedAt - a.arrivedAt);
    });
  }), [subscribe]);

  const shown = useMemo(() => {
    const since = rangeStartMs(range, now);
    const source = fromLocal
      ? localEntries
      : applyPending(entries);
    return source
      .filter((entry) => entry.arrivedAt >= since || entry.status === "esperando")
      .sort((a, b) => b.arrivedAt - a.arrivedAt);
  }, [applyPending, entries, fromLocal, localEntries, now, range]);

  const counts = useMemo(() => {
    const result: Record<StatusFilter, number> = { todas: shown.length, esperando: 0, listo: 0, ausente: 0 };
    for (const entry of shown) {
      if (entry.status === "esperando" || entry.status === "listo" || entry.status === "ausente") result[entry.status] += 1;
    }
    return result;
  }, [shown]);

  const visible = useMemo(() => {
    const needle = normalize(query.trim());
    return shown.filter((entry) =>
      (filter === "todas" || entry.status === filter)
      && (!needle || normalize(entry.customerName).includes(needle)));
  }, [shown, filter, query]);

  async function act(entryId: string, run: () => Promise<boolean>): Promise<boolean> {
    if (busyId) return false;
    setBusyId(entryId);
    try {
      return await run();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Agarradera, cabecera y filtros: la zona que arrastra el panel hacia
          arriba o hacia abajo (`touch-none`: el dedo mueve el panel, no la
          página). Sus botones y el buscador se siguen pudiendo tocar. La lista
          de abajo hace scroll normal. Ya no hay X: bajarlo del todo lo cierra. */}
      <div onPointerDown={drag?.onPointerDown} className="shrink-0 touch-none select-none">
      <SheetHandle label="Mover el panel de todas las cartas" />
      <header className="flex flex-wrap items-center gap-3 border-b border-app-border px-5 pb-4 pt-1 sm:px-7">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-accent/10 text-accent">
          <LayoutGrid aria-hidden size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="todas-cartas-titulo" className="font-bold text-panel-text">Todas las cartas</h2>
          <p className="text-sm text-panel-muted">
            {loading ? "Cargando…" : plural(visible.length, "carta", "cartas")}
            {!connected && " · Sin conexión (copia de esta tablet)"}
          </p>
        </div>
        <button
          type="button"
          disabled={!undoState || !connected}
          onClick={() => void onUndo()}
          title={undoState ? `Deshacer: ${undoState.label} (Ctrl+Z)` : "Nada que deshacer"}
          className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-app-border px-3.5 text-sm font-semibold text-panel-muted transition hover:bg-app-border/50 hover:text-panel-text disabled:opacity-40"
        >
          <Undo2 aria-hidden size={17} />
          Deshacer
        </button>
      </header>

      <div className="space-y-3 border-b border-app-border px-5 py-4 sm:px-7">
        <div className="flex flex-wrap gap-2" role="group" aria-label="Rango de fechas">
          {RANGES.map((option) => (
            <Chip key={option.value} active={range === option.value} onClick={() => setRange(option.value)}>
              {option.label}
            </Chip>
          ))}
          <span aria-hidden className="mx-1 hidden w-px bg-app-border sm:block" />
          {FILTERS.map((option) => (
            <Chip key={option.value} active={filter === option.value} onClick={() => setFilter(option.value)}>
              {option.label}
              <span className="ml-1.5 tabular-nums opacity-70">{counts[option.value]}</span>
            </Chip>
          ))}
        </div>
        <label className="relative block">
          <span className="sr-only">Buscar por nombre</span>
          <Search aria-hidden size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-panel-muted" />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar por nombre"
            autoComplete="off"
            className="w-full rounded-xl border border-app-border bg-panel py-3 pl-11 pr-4 text-panel-text outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
          />
        </label>
      </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 sm:px-7">
        {error && (
          <p role="alert" className="mb-4 rounded-xl border border-estado-ocupada/40 px-4 py-3 text-sm text-panel-text">
            {error}
          </p>
        )}
        {loading && !shown.length ? (
          <p role="status" className="py-16 text-center text-panel-muted">Cargando cartas…</p>
        ) : visible.length === 0 ? (
          <p className="py-16 text-center text-panel-muted">
            {shown.length ? "Ninguna carta coincide con el filtro." : range === "hoy" ? "Hoy todavía no hay cartas." : "No hay cartas en los últimos 7 días."}
          </p>
        ) : (
          <ul className="grid gap-3 movil-horizontal:!grid-cols-[repeat(auto-fill,minmax(15rem,1fr))] movil-horizontal:gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {visible.map((entry) => (
              <CardRow
                key={entry.id}
                entry={entry}
                now={now}
                disabled={busyId !== null}
                busy={busyId === entry.id}
                table={tables.find((table) => table.currentEntryId === entry.id) ?? null}
                onSeat={() => onSeat(entry)}
                onRelease={(tableId) => void act(entry.id, () => onRelease(entry.id, tableId))}
                onResolve={(status) => void act(entry.id, () => onResolve(entry.id, status))}
                onReopen={() => void act(entry.id, () => onReopen(entry.id))}
                onDelete={() => setConfirmDelete(entry)}
              />
            ))}
          </ul>
        )}
      </div>

      <DeleteConfirm
        entry={confirmDelete}
        busy={busyId !== null && busyId === confirmDelete?.id}
        disabled={false}
        onCancel={() => setConfirmDelete(null)}
        onConfirm={async () => {
          const target = confirmDelete;
          if (!target) return;
          const ok = await act(target.id, () => onDelete(target.id));
          // Si el socket lo aceptó, la carta desaparece sola por `removed`.
          if (ok) setConfirmDelete(null);
        }}
      />
    </div>
  );
}

type DeleteConfirmProps = {
  entry: WaitlistEntrySnapshot | null;
  busy: boolean;
  disabled: boolean;
  onCancel: () => void;
  onConfirm: () => void | Promise<void>;
};

/**
 * Confirmación de borrado. Va en su propia `Overlay` (el mismo panel que el
 * formulario de agregar) para que no quede debajo del dedo ni dependa de un
 * doble toque: primero se elige «Eliminar», y aquí se escribe el nombre del
 * cliente que se va a quitar de la lista.
 */
function DeleteConfirm({ entry, busy, disabled, onCancel, onConfirm }: DeleteConfirmProps) {
  return (
    <Overlay open={entry !== null} onClose={onCancel} labelledBy="eliminar-titulo" size="form">
      <div className="p-5 sm:p-6">
        <h2 id="eliminar-titulo" className="text-xl font-bold text-panel-text">
          ¿Eliminar de la lista?
        </h2>
        <p className="mt-2 text-panel-muted">
          Se quita de todas las cartas de este restaurante. Puedes deshacerlo con
          «Deshacer» o <kbd className="rounded bg-app-bg px-1.5 py-0.5 text-xs">Ctrl+Z</kbd> enseguida
          después.
        </p>
        {entry && (
          <div className="mt-4 rounded-2xl border border-estado-ocupada/40 bg-app-bg p-4">
            <p className="break-words text-lg font-bold leading-tight text-panel-text">{entry.customerName}</p>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-panel-muted">
              <UsersRound aria-hidden size={15} />
              {people(entry.partySize)}
              <span aria-hidden>·</span>
              {STATUS_LABEL[entry.status]}
            </p>
          </div>
        )}
        {entry?.status === "sentado" && (
          <p className="mt-3 text-sm text-panel-muted">
            Si tiene una mesa ocupada en el mapa, primero libérala: con la mesa llena no se borra.
          </p>
        )}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="inline-flex min-h-12 items-center justify-center rounded-xl border border-app-border px-5 font-semibold text-panel-text transition hover:bg-app-border/50 disabled:opacity-45"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={() => void onConfirm()}
            disabled={busy || disabled}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-estado-ocupada bg-estado-ocupada px-5 font-semibold text-app-bg transition hover:opacity-90 disabled:opacity-45"
          >
            <Trash2 aria-hidden size={18} />
            {busy ? "Eliminando…" : "Aceptar"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}
/** Sin mayúsculas ni tildes: «jose» encuentra a «José». */
function normalize(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

function Chip({ active, onClick, children }: { active: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-10 rounded-full border px-3.5 text-sm font-semibold transition ${
        active
          ? "border-accent bg-accent text-accent-text"
          : "border-app-border text-panel-muted hover:bg-app-border/50 hover:text-panel-text"
      }`}
    >
      {children}
    </button>
  );
}

type CardRowProps = {
  entry: WaitlistEntrySnapshot;
  now: number;
  disabled: boolean;
  busy: boolean;
  onResolve: (status: "listo" | "ausente") => void;
  onReopen: () => void;
  onDelete: () => void;
  /** La mesa que ocupa ahora (si está sentado y la mesa sigue con él). */
  table: SeatableTable | null;
  onSeat: () => void;
  onRelease: (tableId: string) => void;
};

function CardRow({ entry, now, disabled, busy, table, onResolve, onReopen, onDelete, onSeat, onRelease }: CardRowProps) {
  const waiting = entry.status === "esperando";
  // Hasta cuándo esperó: la marca de listo o ausente, el aviso o la mesa. Las
  // filas de antes de `resolved_at` (migración 0006) usan su último cambio.
  const end = waiting
    ? now
    : entry.resolvedAt ?? entry.calledAt ?? entry.seatedAt ?? entry.updatedAt;
  const waited = end === null ? null : minutesBetween(entry.arrivedAt, end);

  return (
    <li className={`flex flex-col rounded-2xl border border-app-border bg-panel p-4 shadow-sm movil-horizontal:gap-1 ${busy ? "opacity-60" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        {/* El nombre manda: dos líneas como mucho, y el completo en el `title`
            (tooltip al pasar el mouse, texto al mantener pulsado en el móvil)
            para que un nombre largo siga siendo identificable. */}
        <h3
          title={entry.customerName}
          className="min-w-0 break-words text-lg font-bold leading-tight text-panel-text line-clamp-2"
        >
          {entry.customerName}
        </h3>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className={`rounded-full border px-2.5 py-0.5 text-xs font-bold ${STATUS_STYLE[entry.status]}`}>
            {STATUS_LABEL[entry.status]}
          </span>
          {entry.isDemo && <DemoTag />}
        </span>
      </div>
      <div className="mt-2 grid gap-1 text-sm text-panel-muted">
        <p className="flex items-center gap-1.5">
          <UsersRound aria-hidden size={15} />
          {people(entry.partySize)}
          <span aria-hidden>·</span>
          Llegó {arrivalLabel(entry.arrivedAt, now)}
        </p>
        {waited !== null && (
          <p className={`flex items-center gap-1.5 ${waiting ? `font-semibold ${waitColor(waited)}` : ""}`}>
            <Clock3 aria-hidden size={15} />
            {waiting ? `Lleva ${minutes(waited)} esperando` : `Esperó ${minutes(waited)}`}
          </p>
        )}
        {entry.resolvedByName && (
          <p className="flex items-center gap-1.5">
            <Check aria-hidden size={15} />
            Resuelta por {entry.resolvedByName}
          </p>
        )}
        {entry.waiterName && (
          <p className="flex items-center gap-1.5">
            <Armchair aria-hidden size={15} />
            {table ? `${table.label} · ` : ""}Lo atiende {entry.waiterName}
          </p>
        )}
      </div>
      {entry.notes && <p className="mt-2 line-clamp-2 rounded-lg bg-app-bg px-3 py-1.5 text-sm text-panel-muted">{entry.notes}</p>}
      <div className="mt-auto pt-3">
        {waiting ? (
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onResolve("ausente")}
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-estado-ocupada/50 font-semibold text-estado-ocupada transition hover:bg-estado-ocupada/10 disabled:opacity-45"
            >
              <X aria-hidden size={17} /> Ausente
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={() => onResolve("listo")}
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-estado-libre/50 font-semibold text-estado-libre transition hover:bg-estado-libre/10 disabled:opacity-45"
            >
              <Check aria-hidden size={17} /> Listo
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={onSeat}
              className="col-span-2 inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-accent/50 font-semibold text-accent transition hover:bg-accent/10 disabled:opacity-45"
            >
              <Armchair aria-hidden size={17} /> Sentar en una mesa
            </button>
          </div>
        ) : entry.status === "listo" ? (
          // Listo = ya se le avisó: lo normal ahora es sentarlo. Si fue un
          // error, vuelve a la espera.
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              disabled={disabled}
              onClick={onReopen}
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-app-border font-semibold text-panel-text transition hover:bg-app-border/50 disabled:opacity-45"
            >
              <RotateCcw aria-hidden size={17} /> A la espera
            </button>
            <button
              type="button"
              disabled={disabled}
              onClick={onSeat}
              className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-accent/50 font-semibold text-accent transition hover:bg-accent/10 disabled:opacity-45"
            >
              <Armchair aria-hidden size={17} /> Sentar
            </button>
          </div>
        ) : entry.status === "sentado" ? (
          table ? (
            <button
              type="button"
              disabled={disabled}
              onClick={() => onRelease(table.id)}
              className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-app-border font-semibold text-panel-text transition hover:bg-app-border/50 disabled:opacity-45"
            >
              <DoorOpen aria-hidden size={17} /> Liberar {table.label}
            </button>
          ) : (
            <p className="text-sm text-panel-muted">Ya no está en ninguna mesa.</p>
          )
        ) : (
          <button
            type="button"
            disabled={disabled}
            onClick={onReopen}
            className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-app-border font-semibold text-panel-text transition hover:bg-app-border/50 disabled:opacity-45"
          >
            <RotateCcw aria-hidden size={17} /> Volver a la espera
          </button>
        )}
        {/* Eliminar va solo y debajo de todo lo demás, con su propia fila: es
            la única acción que no se puede recuperar con un dedo mal puesto
            (tiene confirmación), así que no compite el sitio con «Listo». */}
        <div className="mt-2">
          <button
            type="button"
            disabled={disabled}
            onClick={onDelete}
            className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-app-border text-sm font-semibold text-panel-muted transition hover:border-estado-ocupada/50 hover:text-estado-ocupada disabled:opacity-45"
          >
            <Trash2 aria-hidden size={16} /> Eliminar
          </button>
        </div>
      </div>
    </li>
  );
}
