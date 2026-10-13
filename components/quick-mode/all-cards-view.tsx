"use client";

// «Ver clientes» (antes «Ver todas las cartas»): todos los clientes del
// restaurante (en espera, listos, ausentes y sentados) de hoy o de los últimos
// 7 días, con filtros por estado y un buscador por nombre. Una en espera se marca lista o ausente; una lista
// o ausente vuelve a la espera. Todo pasa por el socket del modo rápido, así
// que se puede deshacer igual que un deslizamiento, y los cambios de otras
// tablets llegan en vivo (`subscribe`).
//
// Los datos salen de `GET /api/restaurante/[id]/cartas`, que exige
// `rapido:ver`: el host solo ve las de sus restaurantes y analitica ninguna.
//
// Meseros: arriba, la leyenda de la configuración ACTIVA (los mismos que cuenta
// «Meseros activos: [−] N [+]», con punto de color y nombre); tocar un mesero
// filtra sus clientes. Cada cliente sentado lleva el color y el nombre del
// mesero que lo atendió; los demás, «Sin mesero» en gris. Sale de las mesas (`lib/waiters/legend.ts`),
// así que cambia en vivo con el [−] [+] de los meseros. El nombre va siempre
// escrito: el color no es lo único que lo dice.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Armchair, Brush, Check, CheckSquare, Clock3, DoorOpen, LayoutGrid, RotateCcw, Search, Square, Trash2, Undo2, UsersRound, X } from "lucide-react";

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
import { waiterColorFor, waiterLegend } from "@/lib/waiters/legend";
import { waiterLabel } from "@/lib/waiters/palette";
import { WaiterDot } from "@/components/waiters/waiter-dot";
import { RELEASE_FIRST_HINT, releasedNowMessage, seatedBulkMessage, seatedDeleteMessage } from "@/lib/waitlist/delete-rule";
import { addCalendarDays, hondurasMidnightUtc, hondurasToday } from "@/lib/time/honduras";
import {
  CARD_FILTERS,
  CARD_FILTER_LABELS,
  CARD_RANGES,
  CARD_RANGE_LABELS,
  normalizeName,
  type CardCounts,
  type CardFilter,
  type CardRange,
} from "@/lib/waitlist/card-options";

/**
 * Desde cuándo cuenta un rango, en el navegador (lo mismo que `rangeStart`
 * de `lib/waitlist/cards.ts`, que no se puede importar aquí: usa la base).
 * Solo se usa sin conexión, con la copia de la tablet.
 */
function rangeStartMs(range: CardRange, now: number): number {
  if (range === "todos") return 0;
  const today = hondurasToday(new Date(now));
  const back = range === "hoy" ? 0 : range === "7dias" ? 6 : 29;
  return hondurasMidnightUtc(addCalendarDays(today, -back)).getTime();
}

export type StatusFilter = CardFilter;

const EMPTY_COUNTS: CardCounts = { todas: 0, esperando: 0, listo: 0, ausente: 0, ocupando: 0 };

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
  /** Acción sobre los seleccionados; devuelve el resumen para el aviso, o null si falló. */
  onBulk: (action: "liberar" | "ausente" | "eliminar", entryIds: string[]) => Promise<string | null>;
  /** «Limpiar pendientes antiguos»: con `preview`, solo cuenta. */
  onCleanup: (
    hours: 12 | 24 | 168,
    preview: boolean,
  ) => Promise<{ ok: true; released: number; changed: number; preview?: { absent: number; tables: number } } | null>;
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
  onBulk,
  onCleanup,
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
  // La búsqueda va al servidor: se espera a que el host deje de escribir.
  const [searched, setSearched] = useState("");
  useEffect(() => {
    const timer = window.setTimeout(() => setSearched(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);
  const [waiterFilter, setWaiterFilter] = useState<string | null>(null);
  const legend = useMemo(() => waiterLegend(tables), [tables]);
  // Si el mesero elegido deja de estar (se cambió la cantidad de meseros), el
  // filtro se quita solo.
  const activeWaiter = waiterFilter && legend.some((w) => w.name === waiterFilter) ? waiterFilter : null;

  // Lo que pide la pantalla al servidor (`queryWaitlistCards`): una página de
  // 50, los conteos de cada filtro y el cursor de «Ver más». Antes llegaban
  // hasta 2000 clientes y se filtraban aquí, en la tablet.
  const params = useMemo(() => {
    const p = new URLSearchParams({ rango: range, estado: filter });
    if (searched) p.set("q", searched);
    if (activeWaiter) p.set("mesero", activeWaiter);
    return p.toString();
  }, [range, filter, searched, activeWaiter]);
  const [entries, setEntries] = useState<WaitlistEntrySnapshot[]>([]);
  const [counts, setCounts] = useState<CardCounts>(EMPTY_COUNTS);
  const [next, setNext] = useState<string | null>(null);
  const [moreLoading, setMoreLoading] = useState(false);
  // Filtros de lo que ya llegó: mientras no coinciden con los elegidos, se está cargando.
  const [loadedParams, setLoadedParams] = useState<string | null>(null);
  const loading = loadedParams !== params;
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
  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  }, [params]);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      const version = ++loadVersion.current;
      inFlight.current = true;
      staleWhileLoading.current = false;
      try {
        const response = await fetch(`/api/restaurante/${restaurantId}/cartas?${params}`, { cache: "no-store" });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se pudieron cargar los clientes.");
        if (cancelled || version !== loadVersion.current) return;
        setEntries(data.entries as WaitlistEntrySnapshot[]);
        setCounts(data.counts as CardCounts);
        setNext((data.next as string | null) ?? null);
        setFromLocal(false);
        setError("");
      } catch (cause) {
        if (!cancelled && version === loadVersion.current) {
          // Sin conexión no es un error: se enseña lo que la tablet ya tiene.
          if (connectedRef.current) setError(cause instanceof Error ? cause.message : "No se pudieron cargar los clientes.");
          else setError("");
          setFromLocal(true);
        }
      } finally {
        if (!cancelled && version === loadVersion.current) {
          inFlight.current = false;
          setLoadedParams(params);
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
  }, [restaurantId, params, connected]);

  /** «Ver más»: la página siguiente, al final de la lista. */
  async function loadMore() {
    if (!next || moreLoading) return;
    setMoreLoading(true);
    const asked = params;
    try {
      const response = await fetch(`/api/restaurante/${restaurantId}/cartas?${asked}&antes=${encodeURIComponent(next)}`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudieron cargar más clientes.");
      if (paramsRef.current !== asked) return;
      setEntries((items) => {
        const seen = new Set(items.map((item) => item.id));
        return [...items, ...(data.entries as WaitlistEntrySnapshot[]).filter((item) => !seen.has(item.id))];
      });
      setNext((data.next as string | null) ?? null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudieron cargar más clientes.");
    } finally {
      setMoreLoading(false);
    }
  }

  // Los conteos de los filtros, otra vez, tras un cambio en vivo (con una
  // pausa: varios cambios seguidos piden una sola vez).
  const countsTimer = useRef<number | null>(null);
  const refreshCounts = () => {
    if (countsTimer.current !== null) window.clearTimeout(countsTimer.current);
    countsTimer.current = window.setTimeout(async () => {
      countsTimer.current = null;
      const asked = paramsRef.current;
      try {
        const response = await fetch(`/api/restaurante/${restaurantId}/cartas?${asked}&limite=1`, { cache: "no-store" });
        const data = await response.json();
        if (response.ok && paramsRef.current === asked) setCounts(data.counts as CardCounts);
      } catch {
        // Sin red: se quedan los de antes.
      }
    }, 600);
  };
  useEffect(() => () => {
    if (countsTimer.current !== null) window.clearTimeout(countsTimer.current);
  }, []);

  // En vivo: cada cambio de la room se aplica sobre la lista que ya hay. Uno
  // que ya no cumple el filtro de estado sale; uno nuevo entra arriba si lo
  // cumple.
  const filterRef = useRef(filter);
  useEffect(() => {
    filterRef.current = filter;
  }, [filter]);
  useEffect(() => subscribe(({ action, entry }) => {
    if (inFlight.current) staleWhileLoading.current = true;
    const current = filterRef.current;
    const fits = current === "todas" || current === "ocupando" || entry.status === current;
    setEntries((items) => {
      const known = items.some((item) => item.id === entry.id);
      const rest = items.filter((item) => item.id !== entry.id);
      if (action === "removed" || !fits) return rest;
      if (!known && current === "ocupando") return rest;
      return [entry, ...rest].sort((a, b) => b.arrivedAt - a.arrivedAt);
    });
    refreshCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [subscribe]);

  // Sin conexión: la copia de la tablet, filtrada aquí como antes.
  const local = useMemo(() => {
    if (!fromLocal) return null;
    const since = rangeStartMs(range, now);
    const needle = normalizeName(searched);
    const inRange = localEntries
      .filter((entry) => entry.arrivedAt >= since || entry.status === "esperando" || entry.status === "listo")
      .filter((entry) => !activeWaiter || entry.waiterName === activeWaiter)
      .filter((entry) => !needle || normalizeName(entry.customerName).includes(needle))
      .sort((a, b) => b.arrivedAt - a.arrivedAt);
    const occupying = new Set(tables.map((t) => t.currentEntryId).filter(Boolean));
    const c: CardCounts = { ...EMPTY_COUNTS, todas: inRange.length };
    for (const entry of inRange) {
      if (entry.status === "esperando" || entry.status === "listo" || entry.status === "ausente") c[entry.status] += 1;
      if (occupying.has(entry.id)) c.ocupando += 1;
    }
    const list = inRange.filter((entry) =>
      filter === "todas" ? true : filter === "ocupando" ? occupying.has(entry.id) : entry.status === filter);
    return { list, counts: c };
  }, [fromLocal, localEntries, range, now, searched, activeWaiter, filter, tables]);

  // Quién ocupa mesa ahora (las mesas llegan en vivo por `table:released` y
  // `table:assigned`, que no pasan por `subscribe`): con el filtro «Ocupando
  // mesa», quien la deja sale de la lista al momento, y los conteos se vuelven
  // a pedir cada vez que cambia la ocupación.
  const occupiedKey = useMemo(() => tables.map((t) => t.currentEntryId ?? "").sort().join(","), [tables]);
  const occupiedIds = useMemo(() => new Set(occupiedKey.split(",").filter(Boolean)), [occupiedKey]);
  const firstOccupancy = useRef(true);
  useEffect(() => {
    if (firstOccupancy.current) {
      firstOccupancy.current = false;
      return;
    }
    refreshCounts();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [occupiedKey]);
  const visible = useMemo(() => {
    if (local) return local.list;
    const list = applyPending(entries);
    return filter === "ocupando" ? list.filter((entry) => occupiedIds.has(entry.id)) : list;
  }, [local, entries, applyPending, filter, occupiedIds]);
  const shownCounts = local ? local.counts : counts;

  // Selección múltiple: casillas en cada cliente y una barra con las acciones
  // en grupo. Se limpia al cambiar de filtro (lo elegido ya no se ve).
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [selectedFor, setSelectedFor] = useState(params);
  if (selectedFor !== params) {
    setSelectedFor(params);
    setSelected(new Set());
  }
  const toggle = (id: string) =>
    setSelected((current) => {
      const nextSet = new Set(current);
      if (nextSet.has(id)) nextSet.delete(id);
      else nextSet.add(id);
      return nextSet;
    });
  const [bulkAsk, setBulkAsk] = useState<"liberar" | "ausente" | "eliminar" | null>(null);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [cleanupOpen, setCleanupOpen] = useState(false);
  const occupiedBy = useMemo(() => new Map(tables.filter((t) => t.currentEntryId).map((t) => [t.currentEntryId!, t])), [tables]);
  const chosen = visible.filter((entry) => selected.has(entry.id));
  const chosenCounts = {
    total: chosen.length,
    occupying: chosen.filter((entry) => occupiedBy.has(entry.id)).length,
    waiting: chosen.filter((entry) => entry.status === "esperando" || entry.status === "listo").length,
  };
  // Eliminar en grupo: quienes están en una mesa no se eliminan hasta liberar
  // sus mesas (mismo texto que contesta el servidor).
  const chosenSeated = chosen.filter((entry) => occupiedBy.has(entry.id));
  const chosenFree = chosen.filter((entry) => !occupiedBy.has(entry.id));
  const seatedLabels = chosenSeated
    .map((entry) => occupiedBy.get(entry.id)!.label)
    .sort((a, b) => a.localeCompare(b, "es", { numeric: true }));
  const [seatedAsk, setSeatedAsk] = useState(false);

  /**
   * Una acción sobre los elegidos (o sobre `ids`). `keepSelection`: «Liberar
   * sus mesas» desde el aviso de eliminar deja la selección como estaba, para
   * eliminar justo después.
   */
  async function runBulk(action: "liberar" | "ausente" | "eliminar", ids = chosen.map((entry) => entry.id), keepSelection = false) {
    setBulkBusy(true);
    const result = await onBulk(action, ids);
    setBulkBusy(false);
    setBulkAsk(null);
    setSeatedAsk(false);
    if (result) {
      setMessage(
        keepSelection
          ? `${result} Ya puedes eliminar a los seleccionados.`
          : `${result} Puedes deshacerlo con «Deshacer».`,
      );
      if (!keepSelection) setSelected(new Set());
    }
  }

  // Liberar la mesa desde el aviso de «Eliminar» de un cliente: la carta se
  // queda, ahora sin mesa, y su «Eliminar» ya funciona.
  async function releaseThenAllowDelete(entry: WaitlistEntrySnapshot) {
    const table = occupiedBy.get(entry.id);
    if (!table) return;
    const ok = await act(entry.id, () => onRelease(entry.id, table.id));
    if (ok) {
      setConfirmDelete(null);
      setMessage(releasedNowMessage(table.label));
    }
  }

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
    // En una pantalla baja (celular acostado) los filtros solos llenan el
    // panel y la lista no se vería: ahí se desplaza el panel entero, filtros
    // y lista juntos (la barra de los seleccionados sigue pegada arriba).
    <div className="flex min-h-0 flex-1 flex-col [@media(max-height:500px)]:overflow-y-auto [@media(max-height:500px)]:overscroll-contain">
      {/* Agarradera, cabecera y filtros: la zona que arrastra el panel hacia
          arriba o hacia abajo (`touch-none`: el dedo mueve el panel, no la
          página). Sus botones y el buscador se siguen pudiendo tocar. La lista
          de abajo hace scroll normal. Ya no hay X: bajarlo del todo lo cierra. */}
      <div onPointerDown={drag?.onPointerDown} className="shrink-0 touch-none select-none">
      <SheetHandle label="Mover el panel de clientes" />
      <header className="flex flex-wrap items-center gap-3 border-b border-app-border px-5 pb-4 pt-1 sm:px-7">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-2xl bg-accent/10 text-accent">
          <LayoutGrid aria-hidden size={20} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="todas-cartas-titulo" className="font-bold text-panel-text">Clientes</h2>
          <p className="text-sm text-panel-muted">
            {loading ? "Cargando…" : plural(shownCounts[filter], "cliente", "clientes")}
            {activeWaiter && ` · atendidos por ${activeWaiter}`}
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
          {CARD_RANGES.map((option) => (
            <Chip key={option} active={range === option} onClick={() => setRange(option)}>
              {CARD_RANGE_LABELS[option]}
            </Chip>
          ))}
          <span aria-hidden className="mx-1 hidden w-px bg-app-border sm:block" />
          {CARD_FILTERS.map((option) => (
            <Chip key={option} active={filter === option} onClick={() => setFilter(option)}>
              {CARD_FILTER_LABELS[option]}
              <span className="ml-1.5 tabular-nums opacity-70">{shownCounts[option]}</span>
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!connected}
            onClick={() => setCleanupOpen(true)}
            title={connected ? "Marcar ausentes a los que siguen en la fila y liberar las mesas viejas" : "Hace falta conexión"}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-app-border px-3.5 text-sm font-semibold text-panel-text transition hover:bg-app-border/50 disabled:opacity-40"
          >
            <Brush aria-hidden size={17} />
            Limpiar pendientes antiguos
          </button>
          {visible.length > 0 && (
            <button
              type="button"
              onClick={() => setSelected(selected.size === visible.length ? new Set() : new Set(visible.map((entry) => entry.id)))}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-app-border px-3.5 text-sm font-semibold text-panel-muted transition hover:bg-app-border/50 hover:text-panel-text"
            >
              {selected.size === visible.length ? <CheckSquare aria-hidden size={17} /> : <Square aria-hidden size={17} />}
              {selected.size === visible.length ? "Quitar selección" : `Seleccionar los ${visible.length} que se ven`}
            </button>
          )}
        </div>
        {legend.length > 0 && (
          <div role="group" aria-label="Meseros: toca uno para ver solo sus clientes" className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-wide text-panel-muted">Meseros</span>
            {legend.map((waiter) => {
              const on = activeWaiter === waiter.name;
              return (
                <button
                  key={waiter.name}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setWaiterFilter((current) => (current === waiter.name ? null : waiter.name))}
                  aria-label={on ? `${waiterLabel(waiter.color)}: ver todos los clientes` : `Ver solo los clientes del ${waiterLabel(waiter.color).toLocaleLowerCase("es")}`}
                  title={on ? "Ver todos los clientes" : `Ver solo los clientes del ${waiterLabel(waiter.color).toLocaleLowerCase("es")}`}
                  className={`inline-flex min-h-11 min-w-11 items-center justify-center gap-2 rounded-full border-2 px-3 text-sm font-semibold text-panel-text transition hover:bg-app-border/50 ${
                    on ? "" : "border-app-border"
                  }`}
                  // El borde y el fondo con el color del mesero solo al elegirlo;
                  // el texto sigue con el color del tema para que se lea.
                  style={on ? { borderColor: waiter.color, backgroundColor: `${waiter.color}26` } : undefined}
                >
                  {/* Solo el color: el mesero se reconoce por él. */}
                  <WaiterDot color={waiter.color} size={20} className="ring-2 ring-panel" />
                </button>
              );
            })}
          </div>
        )}
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

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 [@media(max-height:500px)]:flex-none [@media(max-height:500px)]:overflow-visible pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-4 sm:px-7">
        {error && (
          <p role="alert" className="mb-4 rounded-xl border border-estado-ocupada/40 px-4 py-3 text-sm text-panel-text">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="mb-4 flex items-start justify-between gap-3 rounded-xl border border-estado-libre/40 px-4 py-3 text-sm text-panel-text">
            <span>{message}</span>
            <button type="button" onClick={() => setMessage("")} aria-label="Cerrar el aviso" className="-m-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-xl hover:bg-app-border/50">
              <X aria-hidden size={16} />
            </button>
          </p>
        )}
        {selected.size > 0 && (
          <div role="toolbar" aria-label="Acciones con los seleccionados" className="sticky top-0 z-10 mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-accent/40 bg-panel p-3 shadow-md">
            <span className="mr-auto text-sm font-semibold text-panel-text">{plural(chosenCounts.total, "seleccionado", "seleccionados")}</span>
            <BulkButton icon={DoorOpen} disabled={!connected || chosenCounts.occupying === 0} onClick={() => setBulkAsk("liberar")}>
              Liberar mesas{chosenCounts.occupying ? ` (${chosenCounts.occupying})` : ""}
            </BulkButton>
            <BulkButton icon={X} disabled={!connected || chosenCounts.waiting === 0} onClick={() => setBulkAsk("ausente")}>
              Marcar ausente{chosenCounts.waiting ? ` (${chosenCounts.waiting})` : ""}
            </BulkButton>
            <BulkButton icon={Trash2} danger disabled={!connected} onClick={() => (chosenSeated.length ? setSeatedAsk(true) : setBulkAsk("eliminar"))}>
              Eliminar seleccionados
            </BulkButton>
            <button type="button" onClick={() => setSelected(new Set())} aria-label="Quitar la selección" className="flex h-11 w-11 items-center justify-center rounded-xl text-panel-muted hover:bg-app-border/50">
              <X aria-hidden size={18} />
            </button>
          </div>
        )}
        {loading && !visible.length ? (
          <p role="status" className="py-16 text-center text-panel-muted">Cargando clientes…</p>
        ) : visible.length === 0 ? (
          <p className="py-16 text-center text-panel-muted">
            {shownCounts.todas ? "Ningún cliente coincide con el filtro." : range === "hoy" ? "Hoy todavía no hay clientes." : "No hay clientes en este rango."}
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
                waiterColor={waiterColorFor(legend, entry.waiterName)}
                onSeat={() => onSeat(entry)}
                onRelease={(tableId) => void act(entry.id, () => onRelease(entry.id, tableId))}
                onResolve={(status) => void act(entry.id, () => onResolve(entry.id, status))}
                onReopen={() => void act(entry.id, () => onReopen(entry.id))}
                onDelete={() => setConfirmDelete(entry)}
                selected={selected.has(entry.id)}
                onToggleSelect={() => toggle(entry.id)}
              />
            ))}
          </ul>
        )}
        {!local && next ? (
          <div className="mt-4 flex justify-center">
            <button
              type="button"
              onClick={() => void loadMore()}
              disabled={moreLoading}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-app-border px-5 font-semibold text-panel-text transition hover:bg-app-border/50 disabled:opacity-50"
            >
              {moreLoading ? "Cargando…" : `Ver más (${Math.max(0, shownCounts[filter] - visible.length)} más)`}
            </button>
          </div>
        ) : null}
      </div>

      <DeleteConfirm
        entry={confirmDelete}
        tableLabel={confirmDelete ? occupiedBy.get(confirmDelete.id)?.label ?? null : null}
        busy={busyId !== null && busyId === confirmDelete?.id}
        disabled={false}
        onCancel={() => setConfirmDelete(null)}
        onRelease={() => confirmDelete && void releaseThenAllowDelete(confirmDelete)}
        onConfirm={async () => {
          const target = confirmDelete;
          if (!target) return;
          const ok = await act(target.id, () => onDelete(target.id));
          // Si el socket lo aceptó, la carta desaparece sola por `removed`.
          if (ok) setConfirmDelete(null);
        }}
      />
      <SeatedBulkDialog
        open={seatedAsk}
        seated={chosenSeated.length}
        total={chosen.length}
        labels={seatedLabels}
        free={chosenFree.length}
        busy={bulkBusy}
        onCancel={() => setSeatedAsk(false)}
        onRelease={() => void runBulk("liberar", chosenSeated.map((entry) => entry.id), true)}
        onDeleteFree={() => void runBulk("eliminar", chosenFree.map((entry) => entry.id))}
      />
      <BulkConfirm
        action={bulkAsk}
        counts={chosenCounts}
        busy={bulkBusy}
        onCancel={() => setBulkAsk(null)}
        onConfirm={() => bulkAsk && void runBulk(bulkAsk)}
      />
      <CleanupDialog
        open={cleanupOpen}
        onClose={() => setCleanupOpen(false)}
        onCleanup={onCleanup}
        onDone={(text) => {
          setMessage(text);
          setCleanupOpen(false);
        }}
      />
    </div>
  );
}

type DeleteConfirmProps = {
  entry: WaitlistEntrySnapshot | null;
  /** La mesa que ocupa ahora: mientras la tenga no se elimina (primero liberarla). */
  tableLabel: string | null;
  busy: boolean;
  disabled: boolean;
  onCancel: () => void;
  onRelease: () => void;
  onConfirm: () => void | Promise<void>;
};

/**
 * Confirmación de borrado. Va en su propia `Overlay` (el mismo panel que el
 * formulario de agregar) para que no quede debajo del dedo ni dependa de un
 * doble toque: primero se elige «Eliminar», y aquí se escribe el nombre del
 * cliente que se va a quitar de la lista.
 */
function DeleteConfirm({ entry, tableLabel, busy, disabled, onCancel, onRelease, onConfirm }: DeleteConfirmProps) {
  // En una mesa: no se elimina. Se ofrece liberarla (a propósito) y, ya
  // libre, su «Eliminar» lleva a la confirmación normal.
  if (entry && tableLabel) {
    return (
      <Overlay open onClose={onCancel} labelledBy="eliminar-titulo" size="form">
        <div className="p-5 sm:p-6">
          <h2 id="eliminar-titulo" className="text-xl font-bold text-panel-text">
            Primero libera la mesa
          </h2>
          <p className="mt-2 text-panel-text">{seatedDeleteMessage(tableLabel)}</p>
          <div className="mt-4 rounded-2xl border border-app-border bg-app-bg p-4">
            <p className="break-words text-lg font-bold leading-tight text-panel-text">{entry.customerName}</p>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-panel-muted">
              <UsersRound aria-hidden size={15} />
              {people(entry.partySize)}
              <span aria-hidden>·</span>
              {tableLabel}
            </p>
          </div>
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
              onClick={onRelease}
              disabled={busy}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-accent px-5 font-semibold text-accent-text transition hover:opacity-90 disabled:opacity-45"
            >
              <DoorOpen aria-hidden size={18} />
              {busy ? "Liberando…" : "Liberar mesa"}
            </button>
          </div>
        </div>
      </Overlay>
    );
  }
  return (
    <Overlay open={entry !== null} onClose={onCancel} labelledBy="eliminar-titulo" size="form">
      <div className="p-5 sm:p-6">
        <h2 id="eliminar-titulo" className="text-xl font-bold text-panel-text">
          ¿Eliminar de la lista?
        </h2>
        <p className="mt-2 text-panel-muted">
          Se quita de la lista de clientes de este restaurante (y deja de contar en las estadísticas). Puedes deshacerlo con
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
  /** Color del mesero que lo atendió (null: sin mesero, o ya no está en la configuración activa). */
  waiterColor: string | null;
  onSeat: () => void;
  onRelease: (tableId: string) => void;
  selected: boolean;
  onToggleSelect: () => void;
};

function CardRow({ entry, now, disabled, busy, table, waiterColor, onResolve, onReopen, onDelete, onSeat, onRelease, selected, onToggleSelect }: CardRowProps) {
  const waiting = entry.status === "esperando";
  // Hasta cuándo esperó: la marca de listo o ausente, el aviso o la mesa. Las
  // filas de antes de `resolved_at` (migración 0006) usan su último cambio.
  const end = waiting
    ? now
    : entry.resolvedAt ?? entry.calledAt ?? entry.seatedAt ?? entry.updatedAt;
  const waited = end === null ? null : minutesBetween(entry.arrivedAt, end);
  // Atendido: sentado con un mesero apuntado. Los demás van «Sin mesero».
  const served = entry.status === "sentado" && Boolean(entry.waiterName);

  return (
    // Sentado con mesero: una franja a la izquierda con su color.
    <li
      className={`flex flex-col rounded-2xl border bg-panel p-4 shadow-sm movil-horizontal:gap-1 ${selected ? "border-accent ring-2 ring-accent/40" : "border-app-border"} ${served && waiterColor ? "border-l-[6px]" : ""} ${busy ? "opacity-60" : ""}`}
      style={served && waiterColor ? { borderLeftColor: waiterColor } : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <label className="-m-2 flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-xl hover:bg-app-border/50">
          <span className="sr-only">Seleccionar a {entry.customerName}</span>
          <input type="checkbox" checked={selected} onChange={onToggleSelect} className="h-5 w-5 accent-[rgb(var(--c-accent))]" />
        </label>
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
        {served ? (
          <p className="flex items-center gap-1.5 text-panel-text">
            <span>{table ? `${table.label} · ` : ""}Lo atiende</span>
            {/* El mesero, por su color (sin nombre). Uno de una configuración que
                ya no está activa sale en gris, con borde punteado. */}
            <WaiterDot color={waiterColor} size={16} className="ring-1 ring-app-border" />
          </p>
        ) : (
          <p className="flex items-center gap-1.5">
            <span aria-hidden className="h-3 w-3 shrink-0 rounded-full border border-dashed border-panel-muted" />
            Sin mesero
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
          {/* Con mesa se ve atenuado («Libera la mesa primero»), pero se puede
              tocar: abre el aviso que ofrece liberarla. */}
          <button
            type="button"
            disabled={disabled}
            onClick={onDelete}
            aria-describedby={table ? `eliminar-ayuda-${entry.id}` : undefined}
            className={`inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-xl border border-app-border text-sm font-semibold text-panel-muted transition hover:border-estado-ocupada/50 hover:text-estado-ocupada disabled:opacity-45 ${table ? "opacity-55" : ""}`}
          >
            <Trash2 aria-hidden size={16} /> Eliminar
          </button>
          {table ? (
            <p id={`eliminar-ayuda-${entry.id}`} className="mt-1 text-center text-xs text-panel-muted">
              {RELEASE_FIRST_HINT}
            </p>
          ) : null}
        </div>
      </div>
    </li>
  );
}

function BulkButton({
  icon: Icon,
  children,
  onClick,
  disabled,
  danger = false,
}: {
  icon: typeof Trash2;
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-xl border px-3 text-sm font-semibold transition disabled:opacity-40 ${
        danger ? "border-estado-ocupada/50 text-estado-ocupada hover:bg-estado-ocupada/10" : "border-app-border text-panel-text hover:bg-app-border/50"
      }`}
    >
      <Icon aria-hidden size={17} />
      {children}
    </button>
  );
}

/** Confirmación de una acción en grupo, con cuántos toca. */
function BulkConfirm({
  action,
  counts,
  busy,
  onCancel,
  onConfirm,
}: {
  action: "liberar" | "ausente" | "eliminar" | null;
  counts: { total: number; occupying: number; waiting: number };
  busy: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const title = action === "liberar" ? "¿Liberar mesas?" : action === "ausente" ? "¿Marcar ausentes?" : "¿Eliminar seleccionados?";
  const text =
    action === "liberar"
      ? `Se liberarán ${plural(counts.occupying, "mesa", "mesas")} de los seleccionados. Siguen contando en las estadísticas.`
      : action === "ausente"
        ? `Se marcarán como ausentes ${plural(counts.waiting, "cliente", "clientes")} que siguen en la fila. Siguen contando en las estadísticas.`
        : `Se eliminarán ${plural(counts.total, "cliente", "clientes")}. Dejan de contar en las estadísticas.`;
  return (
    <Overlay open={action !== null} onClose={onCancel} labelledBy="grupo-titulo" size="form">
      <div className="p-5 sm:p-6">
        <h2 id="grupo-titulo" className="text-xl font-bold text-panel-text">{title}</h2>
        <p className="mt-2 text-panel-text">{text}</p>
        <p className="mt-2 text-sm text-panel-muted">Puedes deshacerlo con «Deshacer» enseguida después.</p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onCancel} disabled={busy} className="inline-flex min-h-12 items-center justify-center rounded-xl border border-app-border px-5 font-semibold text-panel-text transition hover:bg-app-border/50 disabled:opacity-45">
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className={`inline-flex min-h-12 items-center justify-center gap-2 rounded-xl px-5 font-semibold transition hover:opacity-90 disabled:opacity-45 ${
              action === "eliminar" ? "border border-estado-ocupada bg-estado-ocupada text-app-bg" : "bg-accent text-accent-text"
            }`}
          >
            {busy ? "Aplicando…" : "Aceptar"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

/**
 * «Eliminar seleccionados» con clientes en una mesa: no se elimina a nadie.
 * Se ofrece liberar sus mesas (la selección se queda, para eliminar después)
 * o eliminar solo a los que no tienen mesa.
 */
function SeatedBulkDialog({
  open,
  seated,
  total,
  labels,
  free,
  busy,
  onCancel,
  onRelease,
  onDeleteFree,
}: {
  open: boolean;
  seated: number;
  total: number;
  labels: string[];
  free: number;
  busy: boolean;
  onCancel: () => void;
  onRelease: () => void;
  onDeleteFree: () => void;
}) {
  return (
    <Overlay open={open} onClose={onCancel} labelledBy="grupo-mesa-titulo" size="form">
      <div className="p-5 sm:p-6">
        <h2 id="grupo-mesa-titulo" className="text-xl font-bold text-panel-text">Primero libera sus mesas</h2>
        <p className="mt-2 text-panel-text">{seatedBulkMessage(seated, total, labels)}</p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
          <button type="button" onClick={onCancel} disabled={busy} className="inline-flex min-h-12 items-center justify-center rounded-xl border border-app-border px-5 font-semibold text-panel-text transition hover:bg-app-border/50 disabled:opacity-45">
            Cancelar
          </button>
          {free > 0 && (
            <button
              type="button"
              onClick={onDeleteFree}
              disabled={busy}
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-estado-ocupada px-5 font-semibold text-estado-ocupada transition hover:bg-estado-ocupada/10 disabled:opacity-45"
            >
              <Trash2 aria-hidden size={18} />
              {free === 1 ? "Eliminar solo el 1 sin mesa" : `Eliminar solo los ${free} sin mesa`}
            </button>
          )}
          <button
            type="button"
            onClick={onRelease}
            disabled={busy}
            className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-accent px-5 font-semibold text-accent-text transition hover:opacity-90 disabled:opacity-45"
          >
            <DoorOpen aria-hidden size={18} />
            {busy ? "Aplicando…" : seated === 1 ? "Liberar su mesa" : "Liberar sus mesas"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}

const CLEANUP_CHOICES: { hours: 12 | 24 | 168; label: string }[] = [
  { hours: 12, label: "Más de 12 horas" },
  { hours: 24, label: "Más de 24 horas" },
  { hours: 168, label: "Más de 7 días" },
];

/**
 * «Limpiar pendientes antiguos»: se elige la antigüedad, se ve cuántos toca
 * (consulta sin cambios) y se confirma. Marca ausentes a los que siguen en la
 * fila (en espera o listos) y libera las mesas de los sentados de antes.
 */
function CleanupDialog({
  open,
  onClose,
  onCleanup,
  onDone,
}: {
  open: boolean;
  onClose: () => void;
  onCleanup: AllCardsViewProps["onCleanup"];
  onDone: (message: string) => void;
}) {
  const [hours, setHours] = useState<12 | 24 | 168>(24);
  const [preview, setPreview] = useState<{ hours: number; absent: number; tables: number } | null>(null);
  const [busy, setBusy] = useState(false);
  // Por referencia: la función llega nueva en cada render del modo sencillo, y
  // el conteo solo hay que pedirlo al abrir o al cambiar la antigüedad.
  const cleanupRef = useRef(onCleanup);
  useEffect(() => {
    cleanupRef.current = onCleanup;
  });
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void cleanupRef.current(hours, true).then((result) => {
      if (!cancelled && result?.preview) setPreview({ hours, ...result.preview });
    });
    return () => {
      cancelled = true;
    };
  }, [open, hours]);
  const current = preview && preview.hours === hours ? preview : null;
  const nothing = current !== null && current.absent === 0 && current.tables === 0;
  return (
    <Overlay open={open} onClose={onClose} labelledBy="limpiar-titulo" size="form">
      <div className="p-5 sm:p-6">
        <h2 id="limpiar-titulo" className="text-xl font-bold text-panel-text">Limpiar pendientes antiguos</h2>
        <p className="mt-2 text-panel-muted">
          Marca como ausentes a los que siguen en la fila y libera las mesas de los que se sentaron hace mucho. Las cifras
          de las estadísticas se conservan.
        </p>
        <div role="radiogroup" aria-label="Antigüedad" className="mt-4 flex flex-wrap gap-2">
          {CLEANUP_CHOICES.map((choice) => (
            <Chip key={choice.hours} active={hours === choice.hours} onClick={() => setHours(choice.hours)}>
              {choice.label}
            </Chip>
          ))}
        </div>
        <p role="status" className="mt-4 rounded-2xl border border-app-border bg-app-bg p-4 text-panel-text">
          {!current
            ? "Contando…"
            : nothing
              ? "No hay nada pendiente de esa antigüedad."
              : `Se marcarán como ausentes ${plural(current.absent, "cliente", "clientes")} y se liberarán ${plural(current.tables, "mesa", "mesas")}.`}
        </p>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button type="button" onClick={onClose} disabled={busy} className="inline-flex min-h-12 items-center justify-center rounded-xl border border-app-border px-5 font-semibold text-panel-text transition hover:bg-app-border/50 disabled:opacity-45">
            Cancelar
          </button>
          <button
            type="button"
            disabled={busy || !current || nothing}
            onClick={async () => {
              setBusy(true);
              const result = await onCleanup(hours, false);
              setBusy(false);
              if (result) {
                onDone(
                  `Listo: ${plural(result.changed, "cliente marcado", "clientes marcados")} como ausente y ${plural(result.released, "mesa liberada", "mesas liberadas")}. Puedes deshacerlo con «Deshacer».`,
                );
              }
            }}
            className="inline-flex min-h-12 items-center justify-center rounded-xl bg-accent px-5 font-semibold text-accent-text transition hover:opacity-90 disabled:opacity-45"
          >
            {busy ? "Limpiando…" : "Aceptar"}
          </button>
        </div>
      </div>
    </Overlay>
  );
}
