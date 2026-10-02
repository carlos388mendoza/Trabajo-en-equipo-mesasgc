// Almacén local del modo offline, en IndexedDB (solo navegador).
//
// Dos cosas, las dos por usuario y restaurante:
//   - `operations`: la cola de cambios hechos sin conexión (ver `apply.ts`).
//     Sobrevive a recargar, girar la tablet o cerrar la pestaña.
//   - `snapshots`: la última lista y las últimas mesas que se vieron del
//     servidor, para poder abrir el modo sencillo sin Internet.
//
// NUNCA se guardan contraseñas, tokens ni la cookie de sesión: solo los datos
// de la lista que el host ya estaba viendo. Al cerrar sesión se borra todo
// (`clearOfflineData`), para que la siguiente persona que use la tablet no lo
// vea.

import type { LocalView, QueuedOperation } from "./apply";

const DB_NAME = "tw-modo-sencillo";
const DB_VERSION = 1;
const OPS = "operations";
const SNAPSHOTS = "snapshots";

export type OfflineSnapshot = LocalView & { key: string; savedAt: number };

export function offlineAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

let opening: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(OPS)) {
        const store = db.createObjectStore(OPS, { keyPath: "operationId" });
        store.createIndex("owner", ["userId", "restaurantId"]);
      }
      if (!db.objectStoreNames.contains(SNAPSHOTS)) db.createObjectStore(SNAPSHOTS, { keyPath: "key" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      opening = null;
      reject(request.error);
    };
  });
  return opening;
}

function done<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function store(name: string, mode: IDBTransactionMode) {
  const db = await openDb();
  return db.transaction(name, mode).objectStore(name);
}

export function snapshotKey(userId: string, restaurantId: string): string {
  return `${userId}:${restaurantId}`;
}

/** La cola de este usuario en este restaurante, en orden. */
export async function listOperations(userId: string, restaurantId: string): Promise<QueuedOperation[]> {
  const index = (await store(OPS, "readonly")).index("owner");
  const ops = (await done(index.getAll([userId, restaurantId]))) as QueuedOperation[];
  return ops.sort((a, b) => a.sequence - b.sequence);
}

/** Guarda (o actualiza) una operación. Mismo `operationId` = misma fila: no hay duplicados. */
export async function putOperation(op: QueuedOperation): Promise<void> {
  await done((await store(OPS, "readwrite")).put(op));
}

export async function deleteOperation(operationId: string): Promise<void> {
  await done((await store(OPS, "readwrite")).delete(operationId));
}

export async function saveSnapshot(userId: string, restaurantId: string, view: LocalView): Promise<void> {
  const snapshot: OfflineSnapshot = { key: snapshotKey(userId, restaurantId), savedAt: Date.now(), ...view };
  await done((await store(SNAPSHOTS, "readwrite")).put(snapshot));
}

export async function loadSnapshot(userId: string, restaurantId: string): Promise<OfflineSnapshot | null> {
  const found = await done((await store(SNAPSHOTS, "readonly")).get(snapshotKey(userId, restaurantId)));
  return (found as OfflineSnapshot | undefined) ?? null;
}

/** Cambios sin sincronizar en esta tablet, de cualquier usuario y restaurante. */
export async function countAllPendingOperations(): Promise<number> {
  try {
    if (!offlineAvailable()) return 0;
    const ops = (await done((await store(OPS, "readonly")).getAll())) as QueuedOperation[];
    return ops.filter((op) => op.state !== "conflicto").length;
  } catch {
    return 0;
  }
}

/** Al cerrar sesión: la cola, las copias y la caché de páginas del service worker. */
export async function clearOfflineData(): Promise<void> {
  try {
    if (offlineAvailable()) {
      const db = await openDb();
      const tx = db.transaction([OPS, SNAPSHOTS], "readwrite");
      tx.objectStore(OPS).clear();
      tx.objectStore(SNAPSHOTS).clear();
      await new Promise<void>((resolve) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => resolve();
      });
    }
    if (typeof caches !== "undefined") {
      for (const name of await caches.keys()) if (name.startsWith("tw-")) await caches.delete(name);
    }
  } catch {
    // Cerrar sesión no puede fallar por esto.
  }
}

/** Orden de la cola: estrictamente creciente aunque se creen dos en el mismo ms. */
let lastSequence = 0;
export function nextSequence(): number {
  lastSequence = Math.max(lastSequence + 1, Date.now() * 1000);
  return lastSequence;
}
