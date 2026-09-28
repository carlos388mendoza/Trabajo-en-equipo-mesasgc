// Contrato de los eventos de Socket.IO entre el navegador y el servidor.
//
// Lo importan las dos puntas: `lib/realtime/server.ts` (Node) y el hook del
// cliente. Por eso no importa nada de Node ni de React, y los datos son planos
// (sin Date ni clases) para que viajen como JSON.
//
// Los tipos de los payloads que manda el navegador son orientativos: al
// servidor le llega lo que el cliente quiera mandar, así que cada handler lo
// vuelve a validar con los schemas de Zod de abajo.

import { z } from "zod";

/** Room de Socket.IO de un restaurante: cada local solo oye lo suyo. */
export function roomFor(restaurantId: string): string {
  return `restaurant:${restaurantId}`;
}

/** Respuesta (ack) de un evento que el cliente espera. */
export type Ack<T extends object = object> =
  | ({ ok: true } & T)
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Payloads del cliente
// ---------------------------------------------------------------------------

const idSchema = z.string().min(1).max(64);

export const joinRestaurantSchema = z.object({
  restaurantId: idSchema,
});

export type JoinRestaurantInput = z.infer<typeof joinRestaurantSchema>;

// ---------------------------------------------------------------------------
// Eventos
// ---------------------------------------------------------------------------

/** Lo que el navegador le pide al servidor. */
export interface ClientToServerEvents {
  /**
   * Entrar en la room de un restaurante. Un socket está en un solo
   * restaurante a la vez: unirse a otro sale del anterior.
   */
  "restaurant:join": (payload: JoinRestaurantInput, ack: (res: Ack) => void) => void;
}

/** Lo que el servidor le avisa a todos los de una room. */
export interface ServerToClientEvents {
  /** Alguien guardó la estructura de una zona. */
  "layout:updated": (payload: { layoutId: string; version: number }) => void;
  /**
   * Se sustituyó la estructura completa del restaurante (copia desde otro
   * local). Las zonas que el cliente tenga abiertas pueden no existir ya.
   */
  "structure:changed": () => void;
}

/** Lo que el servidor recuerda de cada conexión. */
export type SocketData = {
  /** Restaurante cuya room ocupa el socket; null hasta el primer join. */
  restaurantId: string | null;
  /** Usuario de la sesión. Null hasta que el handshake use Better Auth. */
  userId: string | null;
};
