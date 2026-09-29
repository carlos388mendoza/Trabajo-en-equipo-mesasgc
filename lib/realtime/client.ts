"use client";

import { io, type Socket } from "socket.io-client";

import type { ClientToServerEvents, ServerToClientEvents } from "./events";

export type RealtimeClient = Socket<ServerToClientEvents, ClientToServerEvents>;

/** Cliente del servidor custom Next + Socket.IO, en el mismo origen por defecto. */
export function createRealtimeClient(): RealtimeClient {
  return io(process.env.NEXT_PUBLIC_SOCKET_URL || undefined, {
    autoConnect: false,
  });
}
