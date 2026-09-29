"use client";

import { use, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { Check, CircleCheck, Plus, Undo2, UserRoundPlus } from "lucide-react";

import { createRealtimeClient, type RealtimeClient } from "@/lib/realtime/client";
import type { WaitlistEntrySnapshot } from "@/lib/waitlist/quick-actions";
import type { WaitlistUndoState } from "@/lib/realtime/events";
import { HONDURAS_TIME_ZONE, hondurasDateKey, hondurasToday } from "@/lib/time/honduras";

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

export default function ModoRapidoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: restaurantId } = use(params);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [name, setName] = useState("");
  const [party, setParty] = useState("2");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [connected, setConnected] = useState(false);
  const [undoState, setUndoState] = useState<WaitlistUndoState>(null);
  const [error, setError] = useState("");
  const touchStart = useRef<number | null>(null);
  const socketRef = useRef<RealtimeClient | null>(null);
  const loadVersion = useRef(0);
  const waiting = useMemo(
    () => guests.filter((guest) => guest.status === "waiting"),
    [guests],
  );
  const current = waiting[0];
  const today = hondurasToday();
  const todayEntries = guests.filter((guest) => hondurasDateKey(guest.arrived) === today);

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
  }, [restaurantId]);

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
      window.setTimeout(() => setMessage(""), 2500);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error al guardar en Turso.");
    } finally {
      setSaving(false);
    }
  }

  async function mark(status: "listo" | "ausente") {
    if (!current || resolving) return;
    const socket = socketRef.current;
    if (!socket?.connected) {
      setError("Esperando la conexión en tiempo real.");
      return;
    }
    setResolving(true);
    setError("");
    try {
      const result = await socket.timeout(5000).emitWithAck("waitlist:resolve", {
        entryId: current.id,
        status,
      });
      if (!result.ok) {
        await loadGuests();
        throw new Error(result.error);
      }
      mergeEntry(result.entry);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error al actualizar Turso.");
    } finally {
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
        <section className="rounded-3xl border border-app-border bg-panel p-6 text-panel-text shadow-xl sm:p-8">
          <div className="flex items-center justify-between">
            <span className="rounded-full bg-app-border/60 px-3 py-1.5 text-xs font-semibold tracking-wide text-panel-text">
              SIGUIENTE EN LA FILA
            </span>
            <span className="text-sm text-panel-muted">
              {connected ? "En vivo" : "Reconectando"}
              <span className="mx-2">·</span>
              {current ? `#${guests.filter((guest) => guest.status !== "waiting").length + 1}` : "—"}
            </span>
          </div>
          {loading ? (
            <div className="py-14 text-center text-panel-muted">Cargando lista…</div>
          ) : current ? (
            <article
              onTouchStart={(event) => {
                touchStart.current = event.touches[0]?.clientX ?? null;
              }}
              onTouchEnd={(event) => {
                if (touchStart.current === null) return;
                const delta = event.changedTouches[0].clientX - touchStart.current;
                if (delta > 65) void mark("listo");
                else if (delta < -65) void mark("ausente");
                touchStart.current = null;
              }}
              className="mt-8 touch-pan-y"
            >
              <h2 className="text-3xl font-bold">{current.name}</h2>
              <p className="mt-2 text-panel-muted">
                {current.party} personas <span className="mx-2">·</span> Llegó a las{" "}
                {new Date(current.arrived).toLocaleTimeString("es-HN", { hour: "2-digit", minute: "2-digit", timeZone: HONDURAS_TIME_ZONE })}
              </p>
              {current.note && (
                <p className="mt-4 inline-flex rounded-xl bg-app-border/60 px-3 py-2 text-sm">
                  {current.note}
                </p>
              )}
              <div className="mt-10 grid grid-cols-2 gap-3">
                <button
                  disabled={resolving || !connected}
                  onClick={() => void mark("listo")}
                  className="inline-flex items-center justify-center gap-2 rounded-2xl bg-accent px-4 py-4 font-bold text-accent-text transition hover:bg-accent/85 disabled:opacity-60"
                >
                  <Check aria-hidden size={18} />
                  Marcar listo
                </button>
                <button
                  disabled={resolving || !connected}
                  onClick={() => void mark("ausente")}
                  className="rounded-2xl border border-app-border px-4 py-4 font-semibold text-panel-text transition hover:bg-app-border/60 disabled:opacity-60"
                >
                  Marcar ausente
                </button>
              </div>
              <p className="mt-4 text-center text-xs text-panel-muted">
                Desliza a la derecha para marcar listo · a la izquierda para marcar ausente.
              </p>
            </article>
          ) : (
            <div className="py-14 text-center">
              <p className="text-xl font-semibold">La fila está vacía</p>
              <p className="mt-2 text-sm text-panel-muted">Agrega el siguiente grupo para comenzar.</p>
            </div>
          )}
          <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
            {waiting.slice(1).map((guest, index) => (
              <div key={guest.id} className="min-w-44 rounded-xl bg-app-border/60 p-3">
                <p className="text-xs text-panel-muted">Después · #{index + 2}</p>
                <p className="mt-1 font-semibold">{guest.name}</p>
                <p className="text-xs text-panel-muted">{guest.party} personas</p>
              </div>
            ))}
          </div>
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
                    <option key={count} value={count}>{count} personas</option>
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
            {undoState && (
              <button
                type="button"
                disabled={undoing || !connected}
                onClick={() => void undoLastAction()}
                className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border border-app-border px-3 py-2 text-sm font-semibold text-panel-text transition hover:bg-app-border/60 disabled:opacity-50"
              >
                <Undo2 aria-hidden size={17} />
                {undoing ? "Deshaciendo…" : `Deshacer · ${undoState.label}`}
              </button>
            )}
            <div className="mt-3 flex gap-3 text-sm text-panel-muted">
              <CircleCheck aria-hidden size={17} className="mt-0.5 shrink-0 text-accent" />
              <p>
                {todayEntries.filter((guest) => guest.status === "ready").length} grupos listos
                <span className="mx-1">·</span>
                {todayEntries.filter((guest) => guest.status === "absent").length} ausentes
              </p>
            </div>
          </div>
        </section>
      </div>
      <p className="mt-5 text-center text-xs text-app-muted">La lista se guarda en Turso para este restaurante.</p>
    </div>
  );
}
