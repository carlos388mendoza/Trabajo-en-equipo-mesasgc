"use client";

// Cola de cambios del modo sencillo para trabajar sin Internet.
//
// Cada cambio (agregar, listo, ausente, volver a la espera, eliminar, sentar,
// liberar mesa) pasa por `perform`:
//
//   1. Se guarda PRIMERO en IndexedDB, con su `operationId`. Así no se pierde
//      aunque la red se caiga a mitad de camino o se cierre la pestaña.
//   2. Con conexión, se manda por el socket y se espera el ack, como siempre.
//      Si vuelve (bien o mal), sale de la cola: el comportamiento en línea no
//      cambia. Si no vuelve a tiempo, se queda en la cola como pendiente.
//   3. Sin conexión, se queda pendiente directamente, y la pantalla la aplica
//      encima de los últimos datos del servidor (`applyOperations`).
//
// Al reconectar, `flush` las manda en orden, una a una. Las confirmadas salen
// de la cola; las rechazadas (otro dispositivo se adelantó) quedan como
// `conflicto` para que el host las vea, y dejan de aplicarse. Un reenvío del
// mismo `operationId` el servidor no lo aplica dos veces.
//
// Dos pestañas del mismo dispositivo comparten la cola: se avisan por
// `BroadcastChannel` y solo una sincroniza a la vez (`navigator.locks`).

import { useCallback, useEffect, useRef, useState } from "react";

import {
  type OperationPayload,
  type QueuedOperation,
  isRetryableRejection,
} from "@/lib/offline/apply";
import {
  deleteOperation,
  listOperations,
  nextSequence,
  offlineAvailable,
  putOperation,
} from "@/lib/offline/store";
import type { Ack } from "@/lib/realtime/events";

export type AnyAck = Ack<Record<string, unknown>>;
/** Lo que pasó al mandar una operación por el socket. */
export type SendResult = { kind: "ack"; ack: AnyAck } | { kind: "sin-conexion" };
/** Lo que devuelve `perform`. */
export type PerformResult = SendResult | { kind: "en-cola"; op: QueuedOperation };

type Options = {
  userId: string;
  restaurantId: string;
  /** ¿Hay socket conectado y dentro de la room? */
  isOnline: () => boolean;
  /** Manda una operación y espera su ack (con tiempo límite). */
  send: (op: QueuedOperation) => Promise<SendResult>;
  /** Una operación de la cola se confirmó al sincronizar. */
  onConfirmed?: (op: QueuedOperation, ack: AnyAck) => void;
  /** El servidor la rechazó al sincronizar. */
  onRejected?: (op: QueuedOperation, error: string) => void;
};

const CHANNEL = "tw-modo-sencillo-cola";

export function useOfflineQueue({ userId, restaurantId, isOnline, send, onConfirmed, onRejected }: Options) {
  const [ops, setOps] = useState<QueuedOperation[]>([]);
  const [ready, setReady] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const opsRef = useRef<QueuedOperation[]>([]);
  const flushing = useRef(false);
  const channel = useRef<BroadcastChannel | null>(null);
  // Sin IndexedDB (navegación privada muy restringida) la cola vive en memoria:
  // funciona, pero no sobrevive a recargar.
  const persistent = useRef(true);
  const callbacks = useRef({ isOnline, send, onConfirmed, onRejected });
  useEffect(() => {
    callbacks.current = { isOnline, send, onConfirmed, onRejected };
  });

  const commit = useCallback((next: QueuedOperation[]) => {
    const sorted = [...next].sort((a, b) => a.sequence - b.sequence);
    opsRef.current = sorted;
    setOps(sorted);
  }, []);

  const reload = useCallback(async () => {
    if (!persistent.current) return;
    try {
      commit(await listOperations(userId, restaurantId));
    } catch {
      persistent.current = false;
    }
  }, [commit, restaurantId, userId]);

  useEffect(() => {
    persistent.current = offlineAvailable();
    let alive = true;
    void (async () => {
      try {
        if (persistent.current) {
          const stored = await listOperations(userId, restaurantId);
          if (alive) commit(stored);
        }
      } catch {
        persistent.current = false;
      } finally {
        if (alive) setReady(true);
      }
    })();
    if (typeof BroadcastChannel === "undefined") return () => {
      alive = false;
    };
    const bc = new BroadcastChannel(CHANNEL);
    bc.onmessage = (event) => {
      if (event.data?.restaurantId === restaurantId && event.data?.userId === userId) void reload();
    };
    channel.current = bc;
    return () => {
      alive = false;
      bc.close();
      channel.current = null;
    };
  }, [commit, reload, restaurantId, userId]);

  const announce = useCallback(() => {
    channel.current?.postMessage({ userId, restaurantId });
  }, [restaurantId, userId]);

  const save = useCallback(async (op: QueuedOperation) => {
    commit([...opsRef.current.filter((item) => item.operationId !== op.operationId), op]);
    if (persistent.current) {
      try {
        await putOperation(op);
      } catch {
        persistent.current = false;
      }
    }
    announce();
  }, [announce, commit]);

  const drop = useCallback(async (operationId: string) => {
    commit(opsRef.current.filter((item) => item.operationId !== operationId));
    if (persistent.current) {
      try {
        await deleteOperation(operationId);
      } catch {
        persistent.current = false;
      }
    }
    announce();
  }, [announce, commit]);

  /** Guarda el cambio en la cola y, si hay conexión, lo manda (ver arriba). */
  const perform = useCallback(async (
    payload: OperationPayload,
    meta: { targetId: string; label: string },
  ): Promise<PerformResult> => {
    const online = callbacks.current.isOnline() && !flushing.current;
    const op = {
      ...payload,
      operationId: crypto.randomUUID(),
      userId,
      restaurantId,
      targetId: meta.targetId,
      label: meta.label,
      sequence: nextSequence(),
      createdAt: Date.now(),
      // Mientras se sincroniza la cola, lo nuevo va detrás: el orden importa.
      state: online ? "enviando" : "pendiente",
      attempts: online ? 1 : 0,
    } as QueuedOperation;
    await save(op);
    if (!online) return { kind: "en-cola", op };

    const result = await callbacks.current.send(op);
    if (result.kind === "sin-conexion") {
      const pending = { ...op, state: "pendiente" as const };
      await save(pending);
      return { kind: "en-cola", op: pending };
    }
    await drop(op.operationId);
    return result;
  }, [drop, restaurantId, save, userId]);

  /**
   * Manda la cola en orden. Devuelve cuántas se confirmaron y cuántas se
   * rechazaron; se corta si se vuelve a perder la conexión.
   */
  const flush = useCallback(async (): Promise<{ confirmadas: number; rechazadas: number; cortada: boolean }> => {
    const summary = { confirmadas: 0, rechazadas: 0, cortada: false };
    if (flushing.current) return summary;
    const run = async () => {
      flushing.current = true;
      setSyncing(true);
      try {
        // Se leen de IndexedDB: otra pestaña pudo añadir o mandar alguna.
        await reload();
        for (const queued of opsRef.current.filter((op) => op.state !== "conflicto")) {
          if (!callbacks.current.isOnline()) {
            summary.cortada = true;
            break;
          }
          const op = { ...queued, state: "enviando" as const, attempts: queued.attempts + 1 };
          await save(op);
          const result = await callbacks.current.send(op);
          if (result.kind === "sin-conexion") {
            await save({ ...op, state: "pendiente" });
            summary.cortada = true;
            break;
          }
          if (result.ack.ok) {
            await drop(op.operationId);
            summary.confirmadas += 1;
            callbacks.current.onConfirmed?.(op, result.ack);
          } else if (isRetryableRejection(result.ack.error)) {
            // Sin room o sin sesión: no es culpa del cambio. Se reintenta luego.
            await save({ ...op, state: "pendiente", error: result.ack.error });
            summary.cortada = true;
            break;
          } else {
            await save({ ...op, state: "conflicto", error: result.ack.error });
            summary.rechazadas += 1;
            callbacks.current.onRejected?.(op, result.ack.error);
          }
        }
      } finally {
        flushing.current = false;
        setSyncing(false);
      }
    };
    // Una sola pestaña sincroniza a la vez; las demás esperan su turno y, al
    // entrar, ya no encuentran nada pendiente.
    if (typeof navigator !== "undefined" && navigator.locks) {
      await navigator.locks.request(`${CHANNEL}:${userId}:${restaurantId}`, run);
    } else {
      await run();
    }
    return summary;
  }, [drop, reload, restaurantId, save, userId]);

  /** Deshacer sin conexión: quita el último cambio pendiente. */
  const undoLastPending = useCallback(async (): Promise<QueuedOperation | null> => {
    const last = opsRef.current.filter((op) => op.state === "pendiente").at(-1) ?? null;
    if (last) await drop(last.operationId);
    return last;
  }, [drop]);

  /** El host leyó los conflictos: salen de la cola. */
  const dismissConflicts = useCallback(async () => {
    for (const op of opsRef.current.filter((item) => item.state === "conflicto")) await drop(op.operationId);
  }, [drop]);

  return {
    ops,
    ready,
    syncing,
    pending: ops.filter((op) => op.state !== "conflicto").length,
    conflicts: ops.filter((op) => op.state === "conflicto"),
    perform,
    flush,
    undoLastPending,
    dismissConflicts,
  };
}
