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

// Solo el tipo: `import type` se borra al compilar, así que el cliente no
// arrastra la base de datos.
import type { TableOccupancy } from "@/lib/tables/assign";

export type { TableOccupancy };

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

export const assignTableSchema = z.object({
  tableId: idSchema,
  /** Cliente de la lista de espera que se sienta. */
  entryId: idSchema,
});

export type AssignTableInput = z.infer<typeof assignTableSchema>;

export const releaseTableSchema = z.object({
  tableId: idSchema,
  /** El cliente que el host ve en la mesa (ver `releaseTable`). */
  entryId: idSchema,
});

export type ReleaseTableInput = z.infer<typeof releaseTableSchema>;

/** Una mesa cuya ocupación cambió, con su cliente. */
export type TableChange = { table: TableOccupancy; entryId: string };

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
  /**
   * Sentar a un cliente. El cliente NO pinta la mesa ocupada hasta que llega
   * el ack: si otro host se adelantó, el ack trae el error y la mesa del
   * perdedor nunca llegó a verse suya.
   */
  "table:assign": (payload: AssignTableInput, ack: (res: Ack<TableChange>) => void) => void;
  /** Liberar una mesa. Mismo contrato que `table:assign`. */
  "table:release": (payload: ReleaseTableInput, ack: (res: Ack<TableChange>) => void) => void;
}

/** Lo que el servidor le avisa a todos los de una room. */
export interface ServerToClientEvents {
  /** Una mesa se ocupó. Lo recibe toda la room, también quien la pidió. */
  "table:assigned": (payload: TableChange) => void;
  /** Una mesa quedó libre. */
  "table:released": (payload: TableChange) => void;
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
