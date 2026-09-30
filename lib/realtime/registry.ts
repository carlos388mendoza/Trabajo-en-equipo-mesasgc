// Dónde vive la instancia de Socket.IO para quien necesite emitir desde fuera
// de un handler (por ejemplo, una server action después de guardar).
//
// Va en `globalThis` y no en una variable de módulo a propósito: `server.ts`
// carga este archivo con tsx, pero las server actions las empaqueta Next en su
// propio grafo de módulos. Serían dos copias del módulo y dos variables
// distintas, y la de la action estaría siempre vacía. `globalThis` es lo único
// que comparten, porque es el mismo proceso.
//
// Solo importa tipos de socket.io, así que no mete el servidor en el bundle de
// Next.

import type { Server } from "socket.io";

import type { ClientToServerEvents, ServerToClientEvents, SocketData } from "./events";
import { roomFor } from "./events";

export type RealtimeServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  Record<string, never>,
  SocketData
>;

const KEY = "__tableWaitlistRealtime";

type WithRealtime = typeof globalThis & { [KEY]?: RealtimeServer };

export function setRealtimeServer(io: RealtimeServer | null): void {
  (globalThis as WithRealtime)[KEY] = io ?? undefined;
}

export function getRealtimeServer(): RealtimeServer | null {
  return (globalThis as WithRealtime)[KEY] ?? null;
}

/**
 * Avisa a todos los conectados a un restaurante.
 *
 * Si no hay servidor de tiempo real (se arrancó con `next dev` a secas, o es
 * un script), no hace nada: el guardado ya ocurrió y avisar es un extra.
 */
export function emitToRestaurant<E extends keyof ServerToClientEvents>(
  restaurantId: string,
  event: E,
  ...args: Parameters<ServerToClientEvents[E]>
): void {
  getRealtimeServer()?.to(roomFor(restaurantId)).emit(event, ...args);
}
