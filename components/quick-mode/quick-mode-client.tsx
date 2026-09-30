"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Check, CircleCheck, Plus, Undo2, UserRoundPlus, UsersRound, X } from "lucide-react";

import { createRealtimeClient, type RealtimeClient } from "@/lib/realtime/client";
import type { WaitlistEntrySnapshot } from "@/lib/waitlist/quick-actions";
import type { WaitlistUndoState } from "@/lib/realtime/events";
import { hondurasDateKey, hondurasToday } from "@/lib/time/honduras";
import { SwipeCard, type SwipeCardHandle, type SwipeDecision } from "@/components/quick-mode/swipe-card";

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

export function QuickModeClient({ restaurantId }: { restaurantId: string }) {
  const [guests, setGuests] = useState<Guest[]>([]);
  const [name, setName] = useState("");
  const [party, setParty] = useState("2");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
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
  const socketRef = useRef<RealtimeClient | null>(null);
  const cardRef = useRef<SwipeCardHandle>(null);
  const localResolving = useRef(new Set<string>());
  const resolvedElsewhere = useRef(new Set<string>());
  const travelDirection = useRef(new Map<string, number>());
  const undoStateRef = useRef<WaitlistUndoState>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoActionRef = useRef<() => Promise<void>>(async () => {});
  const loadVersion = useRef(0);
  const waiting = useMemo(
    () => guests.filter((guest) => guest.status === "waiting"),
    [guests],
  );
  const current = waiting[0];
  const today = hondurasToday();
  const todayEntries = guests.filter((guest) => hondurasDateKey(guest.arrived) === today);
  const readyCount = todayEntries.filter((guest) => guest.status === "ready").length;
  const absentCount = todayEntries.filter((guest) => guest.status === "absent").length;

  function fromSnapshot(entry: WaitlistEntrySnapshot): Guest {
    return {
      id: entry.id,
      name: entry.customerName,
      party: entry.partySize,
      arrived: entry.arrivedAt,
      note: entry.notes ?? "",
      status:
        entry.status === "esperando"
          ? "waiting"
          : entry.status === "listo"
            ? "ready"
            : entry.status === "sentado"
              ? "seated"
              : "absent",
    };
  }

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

  useEffect(() => {
    undoStateRef.current = undoState;
  }, [undoState]);

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
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT", "BUTTON"].includes(target.tagName))) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
        event.preventDefault();
        void undoActionRef.current();
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
      if (requestVersion === loadVersion.current) setGuests(
        (data.entries as ApiEntry[]).map((entry) => ({
          id: entry.id,
          name: entry.customerName,
          party: entry.partySize,
          arrived: entry.arrivedAt,
          note: entry.notes ?? "",
          status:
            entry.status === "esperando"
              ? "waiting"
              : entry.status === "listo"
                ? "ready"
                : entry.status === "sentado"
                  ? "seated"
                  : "absent",
        })),
      );
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
    socket.on("waitlist:changed", ({ action, entry, undo }) => {
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
      } else {
        mergeEntry(entry);
      }
      setUndoState(undo);
    });
    socket.connect();

    return () => {
      socket.disconnect();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId, showNotice]);

  async function addGuest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const socket = socketRef.current;
      if (!socket?.connected) throw new Error("Esperando la conexión en tiempo real.");
      const result = await socket.timeout(5000).emitWithAck("waitlist:add", {
          customerName: name.trim(),
          partySize: Number(party),
          notes: note.trim(),
      });
      if (!result.ok) throw new Error(result.error);
      mergeEntry(result.entry);
      setName("");
      setParty("2");
      setNote("");
      setMessage("Cliente agregado a la fila");
      offerUndoForFiveSeconds();
      window.setTimeout(() => setMessage(""), 2500);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error al guardar en Turso.");
    } finally {
      setSaving(false);
    }
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
      if (undoTimer.current) clearTimeout(undoTimer.current);
      if (result.action === "removed") {
        setGuests((items) => items.filter((guest) => guest.id !== result.entry.id));
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

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[.18em] text-accent">
            Servicio en vivo · Local {restaurantId}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-app-text">
            Modo sencillo
          </h1>
          <p className="mt-1 text-app-muted">Gestiona la fila en unos pocos toques.</p>
        </div>
        <div className="rounded-2xl border border-app-border bg-panel px-5 py-3 shadow-sm">
          <span className="text-2xl font-bold text-panel-text">{waiting.length}</span>
          <span className="ml-2 text-sm text-panel-muted">grupos esperando</span>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-xl border border-estado-ocupada/40 bg-panel px-4 py-3 text-sm text-panel-text">
          {error}
        </p>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.15fr_.85fr]">
        <section className="rounded-3xl border border-app-border bg-panel p-5 text-panel-text shadow-xl sm:p-7">
          <div className="flex items-center justify-between gap-3">
            <span className="rounded-full bg-app-border/60 px-3 py-1.5 text-xs font-semibold tracking-wide text-panel-text">
              SIGUIENTE EN LA FILA
            </span>
            <span className="inline-flex items-center gap-2 text-sm text-panel-muted">
              <span className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-estado-libre" : "bg-estado-reservada"}`} />
              {connected ? "En vivo" : "Reconectando"}
              <span aria-hidden>·</span>
              {waiting.length} esperando
            </span>
          </div>

          {loading ? (
            <div className="grid h-[390px] place-items-center text-panel-muted" role="status">Cargando lista…</div>
          ) : waiting.length ? (
            <>
              <div className="relative mx-auto mt-6 h-[390px] w-full max-w-[430px] touch-pan-y">
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
                    />
                  ))}
                </AnimatePresence>
              </div>
              <div className="mx-auto mt-5 grid max-w-[430px] grid-cols-[1fr_auto_1fr] items-center gap-3">
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
              <p className="mt-3 text-center text-xs text-panel-muted">Desliza la tarjeta o usa las flechas izquierda y derecha.</p>
            </>
          ) : (
            <div className="grid min-h-[390px] place-items-center text-center">
              <div>
                <UsersRound aria-hidden size={46} strokeWidth={1.5} className="mx-auto text-panel-muted" />
                <h2 className="mt-4 text-xl font-semibold">No hay clientes en espera</h2>
                <p className="mt-2 text-sm text-panel-muted">Cuando llegue alguien, su tarjeta aparecerá aquí.</p>
              </div>
            </div>
          )}
          <AnimatePresence>
            {notice && (
              <motion.p
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 8 }}
                role="status"
                className="mt-4 rounded-xl border border-app-border bg-app-bg px-4 py-3 text-center text-sm text-panel-text"
              >
                {notice}
              </motion.p>
            )}
          </AnimatePresence>
        </section>

        <section className="rounded-3xl border border-app-border bg-panel p-6 text-panel-text shadow-sm sm:p-8">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-accent/10 text-accent">
              <UserRoundPlus aria-hidden size={20} />
            </span>
            <div>
              <h2 className="font-bold text-panel-text">Agregar cliente</h2>
              <p className="text-sm text-panel-muted">Registro rápido, sin pasos extra</p>
            </div>
          </div>
          <form className="mt-6 space-y-4" onSubmit={addGuest}>
            <label className="block text-sm font-medium text-panel-text">
              Nombre
              <input
                required
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ej. Ana García"
                className="mt-1.5 w-full rounded-xl border border-app-border bg-panel px-4 py-3 text-panel-text outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium text-panel-text">
                Personas
                <select
                  value={party}
                  onChange={(event) => setParty(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-app-border bg-panel px-4 py-3 text-panel-text outline-none focus:border-accent"
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((count) => (
                    <option key={count} value={count}>{count} {count === 1 ? "persona" : "personas"}</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-panel-text">
                Nota (opcional)
                <input
                  maxLength={500}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Silla para bebé"
                  className="mt-1.5 w-full rounded-xl border border-app-border bg-panel px-4 py-3 text-panel-text outline-none focus:border-accent"
                />
              </label>
            </div>
            <button
              disabled={saving || !connected}
              className="w-full rounded-xl bg-accent px-4 py-3.5 font-semibold text-accent-text transition hover:bg-accent/85 disabled:opacity-60"
            >
              <span className="inline-flex items-center justify-center gap-2">
                <Plus aria-hidden size={18} />
                {saving ? "Guardando…" : "Agregar a la fila"}
              </span>
            </button>
            {message && <p role="status" className="text-center text-sm font-medium text-accent">{message}</p>}
          </form>
          <div className="mt-7 border-t border-app-border pt-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-panel-text">Actividad de hoy</h3>
              <button type="button" onClick={() => void loadGuests()} className="text-xs font-medium text-accent hover:underline">
                Actualizar
              </button>
            </div>
            <div className="mt-3 flex gap-3 text-sm text-panel-muted">
              <CircleCheck aria-hidden size={17} className="mt-0.5 shrink-0 text-accent" />
              <p>
                {readyCount} {readyCount === 1 ? "grupo listo" : "grupos listos"}
                <span className="mx-1">·</span>
                {absentCount} {absentCount === 1 ? "ausente" : "ausentes"}
              </p>
            </div>
          </div>
        </section>
      </div>
      <p className="mt-5 text-center text-xs text-app-muted">La lista se guarda en Turso para este restaurante.</p>
    </div>
  );
}
