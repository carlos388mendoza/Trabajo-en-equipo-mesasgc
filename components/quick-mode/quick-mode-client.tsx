"use client";

// Modo rápido (modo sencillo): el montón de cartas de los que esperan.
//
// - Deslizar a la derecha = listo; a la izquierda = ausente (botones, flechas
//   y Ctrl+Z para deshacer, como siempre).
// - Un toque en el centro de la carta (o el botón flotante) abre el
//   formulario de agregar cliente; un toque en una esquina abre la fila en
//   abanico. `SwipeCard` distingue el toque del arrastre.
// - «Ver todas las cartas» abre las de hoy o de los últimos 7 días.
//
// Todo cambio pasa por el socket de la room del restaurante, y el servidor lo
// avisa a todas las tablets del local.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { Check, CircleCheck, GalleryHorizontalEnd, LayoutGrid, Plus, Undo2, UsersRound, X } from "lucide-react";

import { createRealtimeClient, type RealtimeClient } from "@/lib/realtime/client";
import type { WaitlistEntrySnapshot } from "@/lib/waitlist/quick-actions";
import type { WaitlistChange, WaitlistUndoState } from "@/lib/realtime/events";
import { hondurasDateKey, hondurasToday } from "@/lib/time/honduras";
import { AddGuestSheet, type NewGuest } from "@/components/quick-mode/add-guest-sheet";
import { AllCardsView, type StatusFilter } from "@/components/quick-mode/all-cards-view";
import { CardFan } from "@/components/quick-mode/card-fan";
import { plural } from "@/components/quick-mode/format";
import {
  SwipeCard,
  type CardTapZone,
  type SwipeCardHandle,
  type SwipeDecision,
} from "@/components/quick-mode/swipe-card";

type Guest = {
  id: string;
  name: string;
  party: number;
  arrived: number;
  note: string;
  status: "waiting" | "ready" | "seated" | "absent";
};

type ApiEntry = {
  id: string;
  customerName: string;
  partySize: number;
  arrivedAt: number;
  notes: string | null;
  status: string;
};

function statusOf(status: string): Guest["status"] {
  return status === "esperando"
    ? "waiting"
    : status === "listo"
      ? "ready"
      : status === "sentado"
        ? "seated"
        : "absent";
}

function fromSnapshot(entry: WaitlistEntrySnapshot | ApiEntry): Guest {
  return {
    id: entry.id,
    name: entry.customerName,
    party: entry.partySize,
    arrived: entry.arrivedAt,
    note: entry.notes ?? "",
    status: statusOf(entry.status),
  };
}

type Overlay = null | "form" | "fan" | "all";

export function QuickModeClient({ restaurantId }: { restaurantId: string }) {
  const [guests, setGuests] = useState<Guest[]>([]);
  const [loading, setLoading] = useState(true);
  const [resolving, setResolving] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [undoPrompt, setUndoPrompt] = useState(false);
  const [notice, setNotice] = useState("");
  const [exitDirections, setExitDirections] = useState<Record<string, number>>({});
  const [enterDirections, setEnterDirections] = useState<Record<string, number>>({});
  const [connected, setConnected] = useState(false);
  const [undoState, setUndoState] = useState<WaitlistUndoState>(null);
  const [error, setError] = useState("");
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [allFilter, setAllFilter] = useState<StatusFilter>("todas");
  // Carta que el host pasó al frente desde el abanico. Solo cambia lo que se
  // ve arriba del montón en ESTA tablet; el orden de la fila no se toca.
  const [frontId, setFrontId] = useState<string | null>(null);
  // «Se agregaron N clientes · Deshacer», tras agregar varios de una vez.
  const [batchNotice, setBatchNotice] = useState<number | null>(null);
  const batchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const socketRef = useRef<RealtimeClient | null>(null);
  const cardRef = useRef<SwipeCardHandle>(null);
  const localResolving = useRef(new Set<string>());
  const resolvedElsewhere = useRef(new Set<string>());
  const travelDirection = useRef(new Map<string, number>());
  const undoStateRef = useRef<WaitlistUndoState>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoActionRef = useRef<() => Promise<void>>(async () => {});
  const overlayRef = useRef<Overlay>(null);
  const changeListeners = useRef(new Set<(change: WaitlistChange) => void>());
  const loadVersion = useRef(0);
  const waiting = useMemo(() => {
    const queue = guests.filter((guest) => guest.status === "waiting");
    const front = frontId ? queue.find((guest) => guest.id === frontId) : undefined;
    return front ? [front, ...queue.filter((guest) => guest !== front)] : queue;
  }, [guests, frontId]);
  const current = waiting[0];
  const today = hondurasToday();
  const todayEntries = guests.filter((guest) => hondurasDateKey(guest.arrived) === today);
  const readyCount = todayEntries.filter((guest) => guest.status === "ready").length;
  const absentCount = todayEntries.filter((guest) => guest.status === "absent").length;

  function mergeEntry(entry: WaitlistEntrySnapshot) {
    const guest = fromSnapshot(entry);
    setGuests((items) => [...items.filter((item) => item.id !== guest.id), guest]
      .sort((a, b) => a.arrived - b.arrived));
  }

  const showNotice = useCallback((text: string, duration = 3000) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(text);
    noticeTimer.current = setTimeout(() => setNotice(""), duration);
  }, []);

  const subscribe = useCallback((listener: (change: WaitlistChange) => void) => {
    changeListeners.current.add(listener);
    return () => {
      changeListeners.current.delete(listener);
    };
  }, []);

  useEffect(() => {
    undoStateRef.current = undoState;
  }, [undoState]);

  useEffect(() => {
    overlayRef.current = overlay;
  }, [overlay]);

  function offerUndoForFiveSeconds() {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoPrompt(true);
    undoTimer.current = setTimeout(() => setUndoPrompt(false), 5000);
  }

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    if (undoTimer.current) clearTimeout(undoTimer.current);
    if (batchTimer.current) clearTimeout(batchTimer.current);
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName))) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void undoActionRef.current();
        // Con una ventana abierta, las flechas no deslizan la carta de detrás.
      } else if (overlayRef.current) {
        return;
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        void cardRef.current?.swipe("listo");
      } else if (event.key === "ArrowLeft") {
        event.preventDefault();
        void cardRef.current?.swipe("ausente");
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  async function loadGuests() {
    const requestVersion = ++loadVersion.current;
    try {
      const response = await fetch(`/api/restaurante/${restaurantId}/clientes`, {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo leer la lista.");
      if (requestVersion === loadVersion.current) setGuests((data.entries as ApiEntry[]).map(fromSnapshot));
      if (requestVersion === loadVersion.current) setError("");
    } catch (cause) {
      if (requestVersion === loadVersion.current) {
        setError(cause instanceof Error ? cause.message : "Error al conectar con Turso.");
      }
    } finally {
      if (requestVersion === loadVersion.current) setLoading(false);
    }
  }

  useEffect(() => {
    const socket = createRealtimeClient();
    socketRef.current = socket;

    socket.on("connect", () => {
      void socket.timeout(5000)
        .emitWithAck("restaurant:join", { restaurantId })
        .then((result) => {
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setConnected(true);
          void loadGuests();
        })
        .catch(() => setError("No se pudo entrar al restaurante en tiempo real."));
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("connect_error", () => {
      setConnected(false);
      setError("No se pudo conectar al servidor en tiempo real.");
    });
    socket.on("waitlist:undo-state", setUndoState);
    socket.on("waitlist:changed", (change) => {
      const { action, entry, undo } = change;
      loadVersion.current += 1;
      if (action === "removed") {
        setGuests((items) => items.filter((guest) => guest.id !== entry.id));
      } else if (action === "resolved") {
        const direction = entry.status === "listo" ? 1 : -1;
        travelDirection.current.set(entry.id, direction);
        setExitDirections((items) => ({ ...items, [entry.id]: direction }));
        if (!localResolving.current.has(entry.id)) {
          resolvedElsewhere.current.add(entry.id);
          showNotice(`${entry.customerName} ya fue atendido en otro dispositivo.`);
        }
        if (!localResolving.current.has(entry.id)) mergeEntry(entry);
      } else if (action === "restored") {
        resolvedElsewhere.current.delete(entry.id);
        const direction = travelDirection.current.get(entry.id)
          ?? (undoStateRef.current?.label.includes("Marcar ausente") ? -1 : 1);
        setEnterDirections((items) => ({ ...items, [entry.id]: direction }));
        mergeEntry(entry);
      } else if (action === "reopened") {
        resolvedElsewhere.current.delete(entry.id);
        mergeEntry(entry);
      } else {
        mergeEntry(entry);
      }
      setUndoState(undo);
      for (const listener of changeListeners.current) listener(change);
    });
    socket.connect();

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId, showNotice]);

  async function addGuest(input: NewGuest): Promise<string | null> {
    try {
      const socket = socketRef.current;
      if (!socket?.connected) throw new Error("Esperando la conexión en tiempo real.");
      const result = await socket.timeout(5000).emitWithAck("waitlist:add", input);
      if (!result.ok) throw new Error(result.error);
      mergeEntry(result.entry);
      // Llega al final de la fila: si el montón no la muestra, se dice dónde quedó.
      const position = guests.filter((guest) => guest.status === "waiting" && guest.id !== result.entry.id).length + 1;
      showNotice(`${result.entry.customerName} se agregó a la fila (n.º ${position}).`, 3000);
      offerUndoForFiveSeconds();
      return null;
    } catch (cause) {
      return cause instanceof Error ? cause.message : "Error al guardar en Turso.";
    }
  }

  async function addGuests(input: NewGuest[]): Promise<string | null> {
    try {
      const socket = socketRef.current;
      if (!socket?.connected) throw new Error("Esperando la conexión en tiempo real.");
      const result = await socket.timeout(8000).emitWithAck("waitlist:add-many", { entries: input });
      if (!result.ok) throw new Error(result.error);
      result.entries.forEach(mergeEntry);
      showBatchNotice(result.entries.length);
      return null;
    } catch (cause) {
      return cause instanceof Error ? cause.message : "Error al guardar en Turso.";
    }
  }

  function showBatchNotice(count: number) {
    if (batchTimer.current) clearTimeout(batchTimer.current);
    setBatchNotice(count);
    batchTimer.current = setTimeout(() => setBatchNotice(null), 8000);
  }

  async function markGuest(entryId: string, status: SwipeDecision, direction: number): Promise<boolean> {
    if (resolving || localResolving.current.has(entryId) || resolvedElsewhere.current.has(entryId)) return false;
    const socket = socketRef.current;
    if (!socket?.connected) {
      setError("Esperando la conexión en tiempo real.");
      return false;
    }
    localResolving.current.add(entryId);
    setResolving(true);
    setError("");
    try {
      const result = await socket.timeout(5000).emitWithAck("waitlist:resolve", {
        entryId,
        status,
      });
      if (!result.ok) {
        await loadGuests();
        setError(result.error);
        return false;
      }
      travelDirection.current.set(entryId, direction);
      setExitDirections((items) => ({ ...items, [entryId]: direction }));
      mergeEntry(result.entry);
      offerUndoForFiveSeconds();
      showNotice(`${result.entry.customerName}: ${status === "listo" ? "listo" : "ausente"}`, 2200);
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(35);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error al actualizar Turso.");
      return false;
    } finally {
      localResolving.current.delete(entryId);
      setResolving(false);
    }
  }

  async function reopenGuest(entryId: string): Promise<boolean> {
    const socket = socketRef.current;
    if (!socket?.connected) {
      setError("Esperando la conexión en tiempo real.");
      return false;
    }
    setError("");
    try {
      const result = await socket.timeout(5000).emitWithAck("waitlist:reopen", { entryId });
      if (!result.ok) {
        showNotice(result.error, 3500);
        return false;
      }
      resolvedElsewhere.current.delete(entryId);
      mergeEntry(result.entry);
      offerUndoForFiveSeconds();
      showNotice(`${result.entry.customerName} volvió a la espera.`, 2500);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo volver a la espera.");
      return false;
    }
  }

  async function deleteGuest(entryId: string): Promise<boolean> {
    const socket = socketRef.current;
    if (!socket?.connected) {
      setError("Esperando la conexión en tiempo real.");
      return false;
    }
    setError("");
    try {
      const result = await socket.timeout(5000).emitWithAck("waitlist:delete", { entryId });
      if (!result.ok) {
        // «Tiene una mesa ocupada» o «cambió en otro dispositivo»: es un
        // problema que el usuario tiene que ver y resolver, así que el
        // mensaje se queda en la pantalla en vez de salir como un aviso.
        setError(result.error);
        return false;
      }
      // No se quita nada a mano: el `waitlist:changed` con `removed` que
      // emite el socket para toda la room la borra de la lista y del mazo.
      offerUndoForFiveSeconds();
      showNotice(`Se eliminó a ${result.entry.customerName}.`, 2500);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo eliminar.");
      return false;
    }
  }

  async function undoLastAction() {
    if (!undoState || undoing) return;
    const socket = socketRef.current;
    if (!socket?.connected) {
      setError("Esperando la conexión en tiempo real.");
      return;
    }
    setUndoing(true);
    setError("");
    try {
      const result = await socket.timeout(5000).emitWithAck("waitlist:undo", {
        actionId: undoState.actionId,
      });
      if (!result.ok) throw new Error(result.error);
      setUndoPrompt(false);
      setBatchNotice(null);
      if (undoTimer.current) clearTimeout(undoTimer.current);
      if (result.action === "removed") {
        // Deshacer «agregar varios» trae a todos los que se quitaron.
        const removed = new Set((result.entries ?? [result.entry]).map((entry: WaitlistEntrySnapshot) => entry.id));
        setGuests((items) => items.filter((guest) => !removed.has(guest.id)));
        if (result.entries) showNotice(`Se quitaron los ${result.entries.length} clientes que se agregaron.`, 3000);
      } else {
        mergeEntry(result.entry);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo deshacer la acción.");
    } finally {
      setUndoing(false);
    }
  }

  useEffect(() => {
    undoActionRef.current = undoLastAction;
  });

  function onCardTap(zone: CardTapZone) {
    if (zone === "esquina") openFan();
    else setOverlay("form");
  }

  // El reloj avanza cada 30 s: al abrir, los minutos de espera se ponen al día.
  function openFan() {
    setNow(Date.now());
    setOverlay("fan");
  }

  function openAll(filter: StatusFilter) {
    setNow(Date.now());
    setAllFilter(filter);
    setOverlay("all");
  }

  const closeOverlay = useCallback(() => setOverlay(null), []);

  return (
    <MotionConfig reducedMotion="user">
      <div className="mx-auto max-w-6xl px-4 pb-32 pt-6 movil-horizontal:pb-24 movil-horizontal:pt-3 sm:px-6 sm:pt-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-sm font-semibold uppercase tracking-[.18em] text-accent">
              Servicio en vivo · Local {restaurantId}
            </p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-app-text movil-horizontal:mt-1 movil-horizontal:text-2xl">
              Modo sencillo
            </h1>
            <p className="mt-1 text-app-muted movil-horizontal:hidden">Gestiona la fila en unos pocos toques.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <div className="rounded-2xl border border-app-border bg-panel px-5 py-3 shadow-sm">
              <span className="text-2xl font-bold text-panel-text">{waiting.length}</span>
              <span className="ml-2 text-sm text-panel-muted">{waiting.length === 1 ? "grupo esperando" : "grupos esperando"}</span>
            </div>
            <button
              type="button"
              onClick={() => openAll("todas")}
              className="inline-flex min-h-[52px] items-center gap-2 rounded-2xl border border-app-border bg-panel px-4 font-semibold text-panel-text shadow-sm transition hover:bg-app-border/50"
            >
              <LayoutGrid aria-hidden size={19} />
              Ver todas las cartas
            </button>
          </div>
        </div>

        {error && (
          <p role="alert" className="mt-4 rounded-xl border border-estado-ocupada/40 bg-panel px-4 py-3 text-sm text-panel-text">
            {error}
          </p>
        )}

        <section className="mt-6 rounded-3xl border border-app-border bg-panel p-5 text-panel-text shadow-xl movil-horizontal:mt-3 movil-horizontal:!p-4 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="rounded-full bg-app-border/60 px-3 py-1.5 text-xs font-semibold tracking-wide text-panel-text">
              SIGUIENTE EN LA FILA
            </span>
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2 text-sm text-panel-muted">
                <span className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-estado-libre" : "bg-estado-reservada"}`} />
                {connected ? "En vivo" : "Reconectando"}
                <span aria-hidden>·</span>
                {waiting.length} esperando
              </span>
              <button
                type="button"
                disabled={!waiting.length}
                onClick={openFan}
                className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-app-border px-3 text-sm font-semibold text-panel-muted transition hover:bg-app-border/50 hover:text-panel-text disabled:opacity-40"
                title="También tocando una esquina de la carta"
              >
                <GalleryHorizontalEnd aria-hidden size={17} />
                Abanico
              </button>
            </div>
          </div>

          {loading ? (
            <div className="grid h-[420px] place-items-center text-panel-muted sm:h-[460px]" role="status">Cargando lista…</div>
          ) : waiting.length ? (
            <>
              {/* Con el teléfono tumbado el ancho sobra y el alto escasea: la
                  carta y los botones van uno al lado del otro, para que los
                  botones no se coman una columna entera debajo de la carta. */}
              <div className="movil-horizontal:mt-3 movil-horizontal:flex movil-horizontal:items-start movil-horizontal:gap-8">
                <div className="relative mx-auto mt-6 h-[400px] w-full max-w-[560px] touch-pan-y movil-horizontal:mx-0 movil-horizontal:mt-0 movil-horizontal:!h-[288px] movil-horizontal:max-w-none movil-horizontal:flex-1 sm:h-[440px]">
                  <AnimatePresence custom={exitDirections} initial={false}>
                    {waiting.slice(0, 3).map((guest, depth) => (
                      <SwipeCard
                        key={guest.id}
                        ref={depth === 0 ? cardRef : undefined}
                        guest={guest}
                        depth={depth}
                        isTop={depth === 0}
                        now={now}
                        enterFrom={enterDirections[guest.id]}
                        onResolve={markGuest}
                        onTap={depth === 0 ? onCardTap : undefined}
                      />
                    ))}
                  </AnimatePresence>
                </div>
                <div className="mx-auto mt-2 grid max-w-[560px] grid-cols-[1fr_auto_1fr] items-center gap-3 movil-horizontal:mx-0 movil-horizontal:mt-0 movil-horizontal:w-[13.5rem] movil-horizontal:max-w-none movil-horizontal:shrink-0 movil-horizontal:grid-cols-1 movil-horizontal:gap-2.5">
                  <button
                    type="button"
                    disabled={!current || resolving || !connected}
                    onClick={() => void cardRef.current?.swipe("ausente")}
                    className="flex min-h-[68px] flex-col items-center justify-center gap-1 rounded-2xl border border-estado-ocupada/50 bg-panel px-3 py-2 font-semibold text-estado-ocupada transition hover:bg-estado-ocupada/10 disabled:opacity-45"
                    aria-label="Marcar ausente"
                  >
                    <X aria-hidden size={25} strokeWidth={2.5} />
                    <span className="text-xs">Ausente</span>
                  </button>
                  <button
                    type="button"
                    disabled={!undoState || undoing || !connected}
                    onClick={() => void undoLastAction()}
                    className="flex min-h-[60px] min-w-[74px] flex-col items-center justify-center gap-1 rounded-2xl border border-app-border bg-panel px-3 py-2 font-semibold text-panel-muted transition hover:bg-app-border/50 hover:text-panel-text disabled:opacity-40"
                    aria-label="Deshacer última acción (Ctrl+Z)"
                    title="Deshacer · Ctrl+Z"
                  >
                    <Undo2 aria-hidden size={22} />
                    <span className="text-xs">Deshacer</span>
                  </button>
                  <button
                    type="button"
                    disabled={!current || resolving || !connected}
                    onClick={() => void cardRef.current?.swipe("listo")}
                    className="flex min-h-[68px] flex-col items-center justify-center gap-1 rounded-2xl border border-estado-libre/50 bg-panel px-3 py-2 font-semibold text-estado-libre transition hover:bg-estado-libre/10 disabled:opacity-45"
                    aria-label="Marcar listo"
                  >
                    <Check aria-hidden size={25} strokeWidth={2.5} />
                    <span className="text-xs">Listo</span>
                  </button>
                </div>
              </div>
              <AnimatePresence>
                {undoPrompt && undoState && (
                  <motion.p
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: 8 }}
                    role="status"
                    className="mt-3 text-center text-sm text-panel-muted"
                  >
                    Acción guardada. Puedes deshacerla durante 5 segundos.
                  </motion.p>
                )}
              </AnimatePresence>
              <p className="mx-auto mt-3 max-w-[560px] text-center text-xs text-panel-muted movil-horizontal:mt-2">
                Desliza la carta (o usa las flechas) para marcarla lista o ausente. Tócala para agregar un cliente; toca una esquina para ver la fila en abanico.
                {waiting.length > 3 && ` Detrás hay ${plural(waiting.length - 3, "carta más", "cartas más")}.`}
              </p>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setOverlay("form")}
              className="mt-6 grid min-h-[420px] w-full place-items-center rounded-[2rem] border-2 border-dashed border-app-border text-center transition hover:bg-app-border/20 sm:min-h-[460px]"
            >
              <span>
                <UsersRound aria-hidden size={46} strokeWidth={1.5} className="mx-auto text-panel-muted" />
                <span className="mt-4 block text-xl font-semibold">No hay clientes en espera</span>
                <span className="mt-2 block text-sm text-panel-muted">Toca aquí para agregar al primero.</span>
              </span>
            </button>
          )}
          <AnimatePresence>
            {notice && (
              <motion.p
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                role="status"
                className="mx-auto mt-4 max-w-[560px] rounded-xl border border-app-border bg-app-bg px-4 py-3 text-center text-sm text-panel-text"
              >
                {notice}
              </motion.p>
            )}
          </AnimatePresence>

          <div className="mx-auto mt-6 flex max-w-[560px] flex-wrap items-center justify-between gap-3 border-t border-app-border pt-4 text-sm text-panel-muted">
            <p className="inline-flex items-center gap-2">
              <CircleCheck aria-hidden size={17} className="shrink-0 text-accent" />
              <span>
                Hoy: {readyCount} {readyCount === 1 ? "grupo listo" : "grupos listos"}
                <span className="mx-1">·</span>
                {absentCount} {absentCount === 1 ? "ausente" : "ausentes"}
              </span>
            </p>
            <button type="button" onClick={() => void loadGuests()} className="text-xs font-medium text-accent hover:underline">
              Actualizar
            </button>
          </div>
        </section>
        <p className="mt-5 text-center text-xs text-app-muted">La lista se guarda en Turso para este restaurante.</p>
      </div>

      <button
        type="button"
        onClick={() => setOverlay("form")}
        // Con el teléfono tumbado los botones de la fila se quedan a la derecha,
        // así que el botón flotante se va a la IZQUIERDA: si no, «Agregar
        // cliente» se pondría encima de «Listo» y un dedo errado abriría el
        // formulario en vez de marcar. Encima de la carta no hay problema:
        // tocar la carta también abre el formulario.
        className="fixed bottom-[max(1.25rem,env(safe-area-inset-bottom))] right-5 z-40 inline-flex min-h-14 items-center gap-2 rounded-full bg-accent px-5 font-semibold text-accent-text shadow-[0_12px_30px_rgba(0,0,0,0.25)] transition hover:bg-accent/85 movil-horizontal:!right-auto movil-horizontal:left-4 sm:right-8"
      >
        <Plus aria-hidden size={22} />
        Agregar cliente
      </button>

      <AddGuestSheet
        open={overlay === "form"}
        connected={connected}
        onClose={closeOverlay}
        onSubmit={addGuest}
        onSubmitMany={addGuests}
      />
      <AnimatePresence>
        {batchNotice !== null && overlay === null && (
          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 16 }}
            role="status"
            className="fixed bottom-[calc(max(1.25rem,env(safe-area-inset-bottom))+4.5rem)] left-1/2 z-40 flex w-[min(92vw,26rem)] -translate-x-1/2 items-center justify-between gap-3 rounded-2xl border border-app-border bg-panel px-4 py-3 text-sm text-panel-text shadow-xl"
          >
            <span>Se agregaron {plural(batchNotice, "cliente", "clientes")}</span>
            <button
              type="button"
              disabled={!undoState || undoing || !connected}
              onClick={() => void undoLastAction()}
              title="Deshacer · Ctrl+Z"
              className="inline-flex min-h-10 items-center gap-1.5 rounded-xl bg-accent px-3 font-semibold text-accent-text transition hover:bg-accent/85 disabled:opacity-50"
            >
              <Undo2 aria-hidden size={16} />
              Deshacer
            </button>
          </motion.div>
        )}
      </AnimatePresence>
      <CardFan
        open={overlay === "fan"}
        guests={waiting}
        now={now}
        onClose={closeOverlay}
        onPick={(id) => {
          setFrontId(id);
          setOverlay(null);
        }}
        onShowAll={() => openAll("esperando")}
      />
      <AllCardsView
        open={overlay === "all"}
        restaurantId={restaurantId}
        initialFilter={allFilter}
        now={now}
        connected={connected}
        undoState={undoState}
        onClose={closeOverlay}
        subscribe={subscribe}
        onResolve={(entryId, status) => markGuest(entryId, status, status === "listo" ? 1 : -1)}
        onReopen={reopenGuest}
        onDelete={deleteGuest}
        onUndo={undoLastAction}
      />
    </MotionConfig>
  );
}
