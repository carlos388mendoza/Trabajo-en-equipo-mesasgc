"use client";

// Modo rápido (modo sencillo): el montón de cartas de los que esperan.
//
// - Deslizar a la derecha = listo; a la izquierda = ausente (botones, flechas
//   y Ctrl+Z para deshacer, como siempre).
// - Un toque en el centro de la carta (o el botón flotante) abre el
//   formulario de agregar cliente; un toque en una esquina abre la fila en
//   abanico. `SwipeCard` distingue el toque del arrastre.
// - «Ver todas las cartas» abre las de hoy o de los últimos 7 días, y desde
//   ahí se sienta a un cliente en una mesa o se libera la mesa.
//
// Todo cambio pasa por el socket de la room del restaurante, y el servidor lo
// avisa a todas las tablets del local.
//
// SIN CONEXIÓN (requisito de la dirección): el modo sencillo sigue
// funcionando. Cada cambio se guarda primero en una cola en IndexedDB
// (`use-offline-queue.ts`) y lo que se pinta es «lo último que dijo el
// servidor + la cola aplicada en orden» (`applyOperations`). Al volver la
// conexión se manda la cola, el servidor decide (con los mismos bloqueos que
// en línea: una mesa ocupada por otro dispositivo se rechaza) y la lista se
// vuelve a leer del servidor. Lo rechazado se enseña como conflicto. La
// página se puede recargar sin red gracias a `public/sw.js`, y la lista y las
// mesas se guardan en IndexedDB para tener algo que enseñar.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, MotionConfig, motion } from "motion/react";
import { Check, CircleCheck, GalleryHorizontalEnd, LayoutGrid, Plus, Undo2, UsersRound, X } from "lucide-react";

import { createRealtimeClient, type RealtimeClient } from "@/lib/realtime/client";
import { applyOperations, socketPayload, type NewGuestPayload, type QueuedOperation } from "@/lib/offline/apply";
import { loadSnapshot, offlineAvailable, saveSnapshot } from "@/lib/offline/store";
import type { SeatableTable } from "@/lib/tables/list";
import type { WaitlistEntrySnapshot } from "@/lib/waitlist/quick-actions";
import type { WaitlistChange, WaitlistUndoState } from "@/lib/realtime/events";
import { hondurasDateKey, hondurasToday } from "@/lib/time/honduras";
import { AddGuestSheet, type NewGuest } from "@/components/quick-mode/add-guest-sheet";
import { AllCardsView, type StatusFilter } from "@/components/quick-mode/all-cards-view";
import { CardFan } from "@/components/quick-mode/card-fan";
import { plural } from "@/components/quick-mode/format";
import { SeatPicker } from "@/components/quick-mode/seat-picker";
import { ConflictList, SyncStatus, syncPhase } from "@/components/quick-mode/sync-status";
import { useOfflineQueue, type AnyAck, type SendResult } from "@/components/quick-mode/use-offline-queue";
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
  demo: boolean;
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

function fromSnapshot(entry: WaitlistEntrySnapshot): Guest {
  return {
    id: entry.id,
    name: entry.customerName,
    party: entry.partySize,
    arrived: entry.arrivedAt,
    note: entry.notes ?? "",
    status: statusOf(entry.status),
    demo: entry.isDemo,
  };
}

type Overlay = null | "form" | "fan" | "all";

/** Tiempo para el ack de un cambio. Pasado, se queda en la cola. */
const ACK_TIMEOUT_MS = 6000;
/** Cuánto se ve «Sincronizado» antes de volver a «Conectado». */
const SYNCED_MS = 4000;

type LooseSocket = { connected: boolean; timeout(ms: number): { emitWithAck(event: string, payload: unknown): Promise<AnyAck> } };

export function QuickModeClient({ restaurantId, userId }: { restaurantId: string; userId: string }) {
  // Lo último que dijo el servidor (o la copia guardada si no hay red). Lo que
  // se pinta es esto con la cola aplicada encima (`view`).
  const [entries, setEntries] = useState<WaitlistEntrySnapshot[]>([]);
  const [tables, setTables] = useState<SeatableTable[]>([]);
  const [tablesLoaded, setTablesLoaded] = useState(false);
  const [loading, setLoading] = useState(true);
  /** Los datos son la copia guardada en la tablet (aún sin servidor). */
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [resolving, setResolving] = useState(false);
  const [undoing, setUndoing] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [undoPrompt, setUndoPrompt] = useState(false);
  const [notice, setNotice] = useState("");
  const [exitDirections, setExitDirections] = useState<Record<string, number>>({});
  const [enterDirections, setEnterDirections] = useState<Record<string, number>>({});
  const [connected, setConnected] = useState(false);
  const [justSynced, setJustSynced] = useState(false);
  const [undoState, setUndoState] = useState<WaitlistUndoState>(null);
  const [error, setError] = useState("");
  const [overlay, setOverlay] = useState<Overlay>(null);
  const [allFilter, setAllFilter] = useState<StatusFilter>("todas");
  const [seatFor, setSeatFor] = useState<WaitlistEntrySnapshot | null>(null);
  const [seating, setSeating] = useState(false);
  // Carta que el host pasó al frente desde el abanico. Solo cambia lo que se
  // ve arriba del montón en ESTA tablet; el orden de la fila no se toca.
  const [frontId, setFrontId] = useState<string | null>(null);
  // «Se agregaron N clientes · Deshacer», tras agregar varios de una vez.
  const [batchNotice, setBatchNotice] = useState<number | null>(null);
  const batchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const socketRef = useRef<RealtimeClient | null>(null);
  const connectedRef = useRef(false);
  const cardRef = useRef<SwipeCardHandle>(null);
  const localResolving = useRef(new Set<string>());
  const resolvedElsewhere = useRef(new Set<string>());
  /** Clientes de la cola que se están mandando: sus avisos son nuestros, no «de otro dispositivo». */
  const syncingTargets = useRef(new Set<string>());
  const travelDirection = useRef(new Map<string, number>());
  const undoStateRef = useRef<WaitlistUndoState>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoActionRef = useRef<() => Promise<void>>(async () => {});
  const overlayRef = useRef<Overlay>(null);
  const changeListeners = useRef(new Set<(change: WaitlistChange) => void>());
  const loadVersion = useRef(0);
  const tablesVersion = useRef(0);
  const serverLoaded = useRef(false);
  /** La lista base, para los handlers del socket (que no se recrean en cada render). */
  const entriesRef = useRef<WaitlistEntrySnapshot[]>([]);
  useEffect(() => {
    entriesRef.current = entries;
  }, [entries]);

  const send = useCallback(async (op: QueuedOperation): Promise<SendResult> => {
    const socket = socketRef.current as unknown as LooseSocket | null;
    if (!socket?.connected || !connectedRef.current) return { kind: "sin-conexion" };
    syncingTargets.current.add(op.targetId);
    try {
      const ack = await socket.timeout(ACK_TIMEOUT_MS).emitWithAck(op.action, socketPayload(op));
      return { kind: "ack", ack };
    } catch {
      // Sin ack a tiempo: no se sabe si llegó. Se queda en la cola; si llegó,
      // el reenvío con el mismo `operationId` no se aplica dos veces.
      return { kind: "sin-conexion" };
    } finally {
      setTimeout(() => syncingTargets.current.delete(op.targetId), 1500);
    }
  }, []);

  const queue = useOfflineQueue({
    userId,
    restaurantId,
    isOnline: () => connectedRef.current,
    send,
  });

  const view = useMemo(() => applyOperations({ entries, tables }, queue.ops, now), [entries, tables, queue.ops, now]);
  const guests = useMemo(() => view.entries.map(fromSnapshot), [view.entries]);
  const waiting = useMemo(() => {
    const line = guests.filter((guest) => guest.status === "waiting");
    const front = frontId ? line.find((guest) => guest.id === frontId) : undefined;
    return front ? [front, ...line.filter((guest) => guest !== front)] : line;
  }, [guests, frontId]);
  const current = waiting[0];
  const today = hondurasToday();
  const todayEntries = guests.filter((guest) => hondurasDateKey(guest.arrived) === today);
  const readyCount = todayEntries.filter((guest) => guest.status === "ready").length;
  const absentCount = todayEntries.filter((guest) => guest.status === "absent").length;
  const pendingOps = queue.ops.filter((op) => op.state === "pendiente");
  const phase = syncPhase({ connected, syncing: queue.syncing, justSynced });
  const canUndo = connected && !queue.syncing ? Boolean(undoState) : pendingOps.length > 0;

  function mergeEntry(entry: WaitlistEntrySnapshot) {
    setEntries((items) => [...items.filter((item) => item.id !== entry.id), entry]
      .sort((a, b) => a.arrivedAt - b.arrivedAt));
  }

  function removeEntries(ids: Set<string>) {
    setEntries((items) => items.filter((item) => !ids.has(item.id)));
  }

  function mergeTable(change: { tableId: string; status: SeatableTable["status"]; currentEntryId: string | null; version: number }) {
    setTables((items) => items.map((table) => (table.id === change.tableId
      ? { ...table, status: change.status, currentEntryId: change.currentEntryId, version: change.version }
      : table)));
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
    if (syncedTimer.current) clearTimeout(syncedTimer.current);
  }, []);

  // El service worker deja recargar esta página sin red (`public/sw.js`).
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch(() => {
      // Sin service worker se sigue trabajando sin conexión; solo no se puede recargar.
    });
  }, []);

  // La copia guardada: si todavía no habló el servidor (sin red al abrir), se
  // enseña lo último que vio esta tablet.
  useEffect(() => {
    if (!offlineAvailable()) return;
    let cancelled = false;
    void loadSnapshot(userId, restaurantId).then((snapshot) => {
      if (cancelled || !snapshot || serverLoaded.current) return;
      setEntries(snapshot.entries);
      setTables(snapshot.tables);
      setTablesLoaded(true);
      setCachedAt(snapshot.savedAt);
      setLoading(false);
    }).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [restaurantId, userId]);

  // Y se va guardando lo que dice el servidor, para la próxima vez sin red.
  useEffect(() => {
    if (!serverLoaded.current || !offlineAvailable()) return;
    const timer = setTimeout(() => {
      void saveSnapshot(userId, restaurantId, { entries, tables }).catch(() => {});
    }, 400);
    return () => clearTimeout(timer);
  }, [entries, tables, restaurantId, userId]);

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
      if (requestVersion === loadVersion.current) {
        serverLoaded.current = true;
        setEntries(data.entries as WaitlistEntrySnapshot[]);
        setCachedAt(null);
        setError("");
      }
    } catch (cause) {
      if (requestVersion === loadVersion.current && connectedRef.current) {
        setError(cause instanceof Error ? cause.message : "Error al conectar con Turso.");
      }
    } finally {
      if (requestVersion === loadVersion.current) setLoading(false);
    }
  }

  async function loadTables() {
    const requestVersion = ++tablesVersion.current;
    try {
      const response = await fetch(`/api/restaurante/${restaurantId}/mesas`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudieron leer las mesas.");
      if (requestVersion === tablesVersion.current) {
        setTables(data.tables as SeatableTable[]);
        setTablesLoaded(true);
      }
    } catch {
      // Sin mesas se puede seguir con la lista; «Sentar» dirá que no se cargaron.
    }
  }

  const loadAllRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    loadAllRef.current = async () => {
      await Promise.all([loadGuests(), loadTables()]);
    };
  });

  /**
   * Al (re)conectar: primero se manda la cola EN ORDEN, después se vuelve a
   * leer todo del servidor. Lo confirmado ya está en el servidor; lo rechazado
   * deja de aplicarse y queda como conflicto a la vista.
   */
  const syncRef = useRef<() => Promise<void>>(async () => {});
  useEffect(() => {
    syncRef.current = async () => {
      const hasQueue = queue.ops.some((op) => op.state !== "conflicto");
      if (!hasQueue) {
        await loadAllRef.current();
        return;
      }
      const summary = await queue.flush();
      await loadAllRef.current();
      if (summary.cortada) return;
      if (syncedTimer.current) clearTimeout(syncedTimer.current);
      setJustSynced(true);
      syncedTimer.current = setTimeout(() => setJustSynced(false), SYNCED_MS);
      if (summary.confirmadas > 0 && summary.rechazadas === 0) {
        showNotice(`${plural(summary.confirmadas, "cambio sincronizado", "cambios sincronizados")} con el servidor.`, 3500);
      }
      // Lo que se hizo mientras se sincronizaba quedó detrás: otra vuelta.
      if (connectedRef.current) setTimeout(() => void syncRef.current(), 50);
    };
  });

  // Si la cola llegó tarde (IndexedDB tarda más que el socket), se sincroniza
  // en cuanto esté lista.
  const queueReady = queue.ready;
  useEffect(() => {
    if (queueReady && connectedRef.current) void syncRef.current();
  }, [queueReady]);

  useEffect(() => {
    const socket = createRealtimeClient();
    socketRef.current = socket;
    const setOnline = (value: boolean) => {
      connectedRef.current = value;
      setConnected(value);
    };

    socket.on("connect", () => {
      void socket.timeout(5000)
        .emitWithAck("restaurant:join", { restaurantId })
        .then((result) => {
          if (!result.ok) {
            setError(result.error);
            return;
          }
          setError("");
          setOnline(true);
          void syncRef.current();
        })
        .catch(() => setError("No se pudo entrar al restaurante en tiempo real."));
    });
    socket.on("disconnect", () => setOnline(false));
    socket.on("connect_error", () => {
      setOnline(false);
    });
    socket.on("waitlist:undo-state", setUndoState);
    socket.on("waitlist:changed", (change) => {
      const { action, entry, undo } = change;
      loadVersion.current += 1;
      const ours = localResolving.current.has(entry.id) || syncingTargets.current.has(entry.id);
      if (action === "removed") {
        removeEntries(new Set([entry.id]));
      } else if (action === "resolved") {
        const direction = entry.status === "listo" ? 1 : -1;
        travelDirection.current.set(entry.id, direction);
        setExitDirections((items) => ({ ...items, [entry.id]: direction }));
        if (!ours) {
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
    // Sentar y liberar (desde esta tablet, otra, o el editor): mesa y cliente.
    socket.on("table:assigned", ({ table, entryId }) => {
      mergeTable(table);
      const known = entriesRef.current.find((item) => item.id === entryId);
      if (!known) return;
      const seated: WaitlistEntrySnapshot = { ...known, status: "sentado", assignedTableId: table.tableId, seatedAt: Date.now(), updatedAt: Date.now() };
      mergeEntry(seated);
      // «Ver todas las cartas» escucha los cambios de la lista: se le cuenta.
      for (const listener of changeListeners.current) listener({ action: "resolved", entry: seated, undo: undoStateRef.current });
    });
    socket.on("table:released", ({ table }) => {
      mergeTable(table);
    });

    // El navegador sabe antes que el socket que se fue la red: se pasa a modo
    // sin conexión enseguida (y el socket deja de reintentar a ciegas). Al
    // volver, se reconecta.
    const onOffline = () => {
      setOnline(false);
      socket.disconnect();
    };
    const onOnline = () => {
      if (!socket.connected) socket.connect();
    };
    window.addEventListener("offline", onOffline);
    window.addEventListener("online", onOnline);
    if (typeof navigator === "undefined" || navigator.onLine !== false) socket.connect();
    else setLoading((value) => value && !serverLoaded.current);

    return () => {
      window.removeEventListener("offline", onOffline);
      window.removeEventListener("online", onOnline);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [restaurantId, showNotice]);

  /** Una nueva carta, con id y hora de llegada de esta tablet (sirve sin conexión). */
  function newGuestPayload(input: NewGuest, offset = 0): NewGuestPayload {
    return { ...input, entryId: crypto.randomUUID(), arrivedAt: Date.now() + offset };
  }

  async function addGuest(input: NewGuest): Promise<string | null> {
    const data = newGuestPayload(input);
    const result = await queue.perform({ action: "waitlist:add", data }, { targetId: data.entryId, label: `Agregar a ${input.customerName}` });
    // Llega al final de la fila: si el montón no la muestra, se dice dónde quedó.
    const position = guests.filter((guest) => guest.status === "waiting").length + 1;
    if (result.kind === "en-cola") {
      showNotice(`${input.customerName} se agregó sin conexión (n.º ${position}). Se enviará al volver la conexión.`, 3500);
      return null;
    }
    if (result.kind === "sin-conexion") return "Sin conexión.";
    if (!result.ack.ok) return result.ack.error;
    mergeEntry(result.ack.entry as WaitlistEntrySnapshot);
    showNotice(`${input.customerName} se agregó a la fila (n.º ${position}).`, 3000);
    offerUndoForFiveSeconds();
    return null;
  }

  async function addGuests(input: NewGuest[]): Promise<string | null> {
    const list = input.map((guest, index) => newGuestPayload(guest, index));
    const result = await queue.perform(
      { action: "waitlist:add-many", data: { entries: list } },
      { targetId: list[0]?.entryId ?? "", label: `Agregar ${plural(list.length, "cliente", "clientes")}` },
    );
    if (result.kind === "en-cola") {
      showNotice(`Se agregaron ${plural(list.length, "cliente", "clientes")} sin conexión. Se enviarán al volver la conexión.`, 3500);
      return null;
    }
    if (result.kind === "sin-conexion") return "Sin conexión.";
    if (!result.ack.ok) return result.ack.error;
    (result.ack.entries as WaitlistEntrySnapshot[]).forEach(mergeEntry);
    showBatchNotice(list.length);
    return null;
  }

  function showBatchNotice(count: number) {
    if (batchTimer.current) clearTimeout(batchTimer.current);
    setBatchNotice(count);
    batchTimer.current = setTimeout(() => setBatchNotice(null), 8000);
  }

  function nameOf(entryId: string): string {
    return view.entries.find((entry) => entry.id === entryId)?.customerName ?? "el cliente";
  }

  async function markGuest(entryId: string, status: SwipeDecision, direction: number): Promise<boolean> {
    if (resolving || localResolving.current.has(entryId) || resolvedElsewhere.current.has(entryId)) return false;
    localResolving.current.add(entryId);
    setResolving(true);
    setError("");
    const label = `${status === "listo" ? "Marcar listo" : "Marcar ausente"} a ${nameOf(entryId)}`;
    try {
      const result = await queue.perform({ action: "waitlist:resolve", data: { entryId, status } }, { targetId: entryId, label });
      if (result.kind === "ack" && !result.ack.ok) {
        await loadGuests();
        setError(result.ack.error);
        return false;
      }
      travelDirection.current.set(entryId, direction);
      setExitDirections((items) => ({ ...items, [entryId]: direction }));
      if (result.kind === "ack" && result.ack.ok) {
        mergeEntry(result.ack.entry as WaitlistEntrySnapshot);
        offerUndoForFiveSeconds();
        showNotice(`${nameOf(entryId)}: ${status === "listo" ? "listo" : "ausente"}`, 2200);
      } else {
        showNotice(`${nameOf(entryId)}: ${status === "listo" ? "listo" : "ausente"} (sin conexión, se enviará al volver).`, 2600);
      }
      if (typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(35);
      return true;
    } finally {
      localResolving.current.delete(entryId);
      setResolving(false);
    }
  }

  async function reopenGuest(entryId: string): Promise<boolean> {
    setError("");
    const name = nameOf(entryId);
    const result = await queue.perform({ action: "waitlist:reopen", data: { entryId } }, { targetId: entryId, label: `Volver a la espera a ${name}` });
    if (result.kind === "ack" && !result.ack.ok) {
      showNotice(result.ack.error, 3500);
      return false;
    }
    resolvedElsewhere.current.delete(entryId);
    if (result.kind === "ack" && result.ack.ok) {
      mergeEntry(result.ack.entry as WaitlistEntrySnapshot);
      offerUndoForFiveSeconds();
      showNotice(`${name} volvió a la espera.`, 2500);
    } else {
      showNotice(`${name} volvió a la espera (sin conexión, se enviará al volver).`, 2600);
    }
    return true;
  }

  async function deleteGuest(entryId: string): Promise<boolean> {
    setError("");
    const name = nameOf(entryId);
    const result = await queue.perform({ action: "waitlist:delete", data: { entryId } }, { targetId: entryId, label: `Eliminar a ${name}` });
    if (result.kind === "ack" && !result.ack.ok) {
      // «Tiene una mesa ocupada» o «cambió en otro dispositivo»: es un
      // problema que el usuario tiene que ver y resolver, así que el
      // mensaje se queda en la pantalla en vez de salir como un aviso.
      setError(result.ack.error);
      return false;
    }
    if (result.kind === "ack") {
      // No se quita nada a mano: el `waitlist:changed` con `removed` que
      // emite el socket para toda la room la borra de la lista y del mazo.
      offerUndoForFiveSeconds();
      showNotice(`Se eliminó a ${name}.`, 2500);
    } else {
      showNotice(`Se eliminó a ${name} (sin conexión, se enviará al volver).`, 2600);
    }
    return true;
  }

  async function seatGuest(entryId: string, tableId: string): Promise<boolean> {
    setSeating(true);
    setError("");
    const name = nameOf(entryId);
    const label = view.tables.find((table) => table.id === tableId)?.label ?? "la mesa";
    try {
      const result = await queue.perform({ action: "table:assign", data: { tableId, entryId } }, { targetId: entryId, label: `Sentar a ${name} en ${label}` });
      if (result.kind === "ack" && !result.ack.ok) {
        // «Esta mesa ya fue asignada»: otro dispositivo se adelantó. Se dice y
        // se vuelven a leer las mesas, para no ofrecer otra vez la ocupada.
        setError(result.ack.error);
        void loadTables();
        return false;
      }
      showNotice(result.kind === "ack" ? `${name} se sentó en ${label}.` : `${name} se sentó en ${label} (sin conexión, se enviará al volver).`, 2800);
      return true;
    } finally {
      setSeating(false);
    }
  }

  async function releaseTableOf(entryId: string, tableId: string): Promise<boolean> {
    setError("");
    const label = view.tables.find((table) => table.id === tableId)?.label ?? "la mesa";
    const result = await queue.perform({ action: "table:release", data: { tableId, entryId } }, { targetId: entryId, label: `Liberar ${label}` });
    if (result.kind === "ack" && !result.ack.ok) {
      setError(result.ack.error);
      void loadTables();
      return false;
    }
    showNotice(result.kind === "ack" ? `${label} quedó libre.` : `${label} quedó libre (sin conexión, se enviará al volver).`, 2600);
    return true;
  }

  async function undoLastAction() {
    if (undoing) return;
    // Sin conexión (o con cambios aún en cola), deshacer es sacar el último
    // de la cola: todavía no llegó al servidor, así que no hay nada que revertir allí.
    if (!connectedRef.current || queue.syncing || pendingOps.length > 0) {
      const removed = await queue.undoLastPending();
      if (removed) showNotice(`Se deshizo «${removed.label}» (no llegó a enviarse).`, 3000);
      return;
    }
    if (!undoState) return;
    const socket = socketRef.current;
    if (!socket?.connected) return;
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
        removeEntries(new Set((result.entries ?? [result.entry]).map((entry: WaitlistEntrySnapshot) => entry.id)));
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
  const applyPending = useCallback(
    (list: WaitlistEntrySnapshot[]) => applyOperations({ entries: list, tables }, queue.ops, now).entries,
    [tables, queue.ops, now],
  );

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
        <ConflictList conflicts={queue.conflicts} onDismiss={() => void queue.dismissConflicts()} />

        <section className="mt-6 rounded-3xl border border-app-border bg-panel p-5 text-panel-text shadow-xl movil-horizontal:mt-3 movil-horizontal:!p-4 sm:p-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="rounded-full bg-app-border/60 px-3 py-1.5 text-xs font-semibold tracking-wide text-panel-text">
              SIGUIENTE EN LA FILA
            </span>
            <div className="flex flex-wrap items-center gap-3">
              <SyncStatus phase={phase} pending={queue.pending} />
              <span className="text-sm text-panel-muted">· {waiting.length} esperando</span>
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
          {!connected && (
            <p className="mt-3 rounded-xl bg-estado-ocupada/10 px-3 py-2 text-sm text-panel-text">
              Sin conexión: puedes seguir agregando, marcando, sentando y eliminando. Los cambios se guardan en esta
              tablet y se envían solos al volver la conexión.
              {cachedAt && ` Lista guardada a las ${new Date(cachedAt).toLocaleTimeString("es-HN", { hour: "2-digit", minute: "2-digit" })}.`}
            </p>
          )}

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
                    disabled={!current || resolving}
                    onClick={() => void cardRef.current?.swipe("ausente")}
                    className="flex min-h-[68px] flex-col items-center justify-center gap-1 rounded-2xl border border-estado-ocupada/50 bg-panel px-3 py-2 font-semibold text-estado-ocupada transition hover:bg-estado-ocupada/10 disabled:opacity-45"
                    aria-label="Marcar ausente"
                  >
                    <X aria-hidden size={25} strokeWidth={2.5} />
                    <span className="text-xs">Ausente</span>
                  </button>
                  <button
                    type="button"
                    disabled={!canUndo || undoing}
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
                    disabled={!current || resolving}
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
            <button
              type="button"
              disabled={!connected}
              onClick={() => void syncRef.current()}
              className="text-xs font-medium text-accent hover:underline disabled:opacity-40"
            >
              Actualizar
            </button>
          </div>
        </section>
        <p className="mt-5 text-center text-xs text-app-muted">
          La lista se guarda en Turso para este restaurante. Sin conexión, esta tablet guarda los cambios y los envía al volver.
        </p>
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
              disabled={!canUndo || undoing}
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
        undoState={canUndo ? (undoState ?? { actionId: "cola", label: pendingOps.at(-1)?.label ?? "" }) : null}
        onClose={closeOverlay}
        subscribe={subscribe}
        localEntries={view.entries}
        applyPending={applyPending}
        tables={view.tables}
        onResolve={(entryId, status) => markGuest(entryId, status, status === "listo" ? 1 : -1)}
        onReopen={reopenGuest}
        onDelete={deleteGuest}
        onSeat={(entry) => setSeatFor(entry)}
        onRelease={releaseTableOf}
        onUndo={undoLastAction}
      />
      <SeatPicker
        entry={seatFor}
        tables={view.tables}
        loaded={tablesLoaded}
        busy={seating}
        onClose={() => setSeatFor(null)}
        onPick={(tableId) => {
          const entry = seatFor;
          if (!entry) return;
          void seatGuest(entry.id, tableId).then((ok) => {
            if (ok) setSeatFor(null);
          });
        }}
      />
    </MotionConfig>
  );
}
