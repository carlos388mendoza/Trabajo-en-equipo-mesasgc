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
import type { WaitlistEntrySnapshot } from "@/lib/waitlist/quick-actions";

export type { TableOccupancy };

/** Room de Socket.IO de un restaurante: cada local solo oye lo suyo. */
export function roomFor(restaurantId: string): string {
  return `restaurant:${restaurantId}`;
}

/**
 * Sala del mapa general. Recibe los contadores de TODOS los restaurantes, así
 * que solo entra quien tiene `mapa:ver`, y solo viajan números.
 */
export const OVERVIEW_ROOM = "overview";

/**
 * Lo que el mapa general sabe de un restaurante: contadores agregados, sin
 * nombres ni ids de clientes. Lo calcula `lib/map/counters.ts`.
 */
export type RestaurantCounters = {
  restaurantId: string;
  /** Mesas (tipos sentables) de todas las zonas. */
  tablesTotal: number;
  tablesOccupied: number;
  /** Reservadas y sin cliente sentado. */
  tablesReserved: number;
  /** Clientes en la sala: `esperando` + `listo`. */
  waiting: number;
  /**
   * Hora media de llegada de los que esperan, en ms (null si no hay nadie).
   * El navegador calcula con ella la espera media, que así avanza sola.
   */
  averageArrivedAt: number | null;
};

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

export const addWaitlistEntrySchema = z.object({
  customerName: z.string().trim().min(1).max(100),
  partySize: z.number().int().min(1).max(10),
  notes: z.string().trim().max(500).optional().default(""),
});

export type AddWaitlistEntryInput = z.infer<typeof addWaitlistEntrySchema>;

/**
 * Varios grupos de una vez, con las mismas reglas que uno. El tope vive aquí
 * porque lo usan el formulario (navegador), este schema y `lib/waitlist`.
 */
export const MAX_BATCH_ENTRIES = 30;
export const addManyWaitlistEntriesSchema = z.object({
  entries: z.array(addWaitlistEntrySchema).min(1).max(MAX_BATCH_ENTRIES),
});

export type AddManyWaitlistEntriesInput = z.infer<typeof addManyWaitlistEntriesSchema>;

export const resolveWaitlistEntrySchema = z.object({
  entryId: idSchema,
  status: z.enum(["listo", "ausente"]),
});

export type ResolveWaitlistEntryInput = z.infer<typeof resolveWaitlistEntrySchema>;

export const undoWaitlistSchema = z.object({ actionId: idSchema });
export type UndoWaitlistInput = z.infer<typeof undoWaitlistSchema>;

/** Volver a la espera a un cliente listo o ausente («Ver todas las cartas»). */
export const reopenWaitlistEntrySchema = z.object({ entryId: idSchema });
export type ReopenWaitlistEntryInput = z.infer<typeof reopenWaitlistEntrySchema>;

/** Eliminar a un cliente de la lista («Ver todas las cartas»). */
export const deleteWaitlistEntrySchema = z.object({ entryId: idSchema });
export type DeleteWaitlistEntryInput = z.infer<typeof deleteWaitlistEntrySchema>;

export type WaitlistUndoState = {
  actionId: string;
  label: string;
} | null;

export type WaitlistChange = {
  /** `reopened`: volvió a la espera desde «Ver todas las cartas». */
  action: "added" | "resolved" | "removed" | "restored" | "reopened";
  entry: WaitlistEntrySnapshot;
  undo: WaitlistUndoState;
};

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
  /**
   * Entrar en la sala del mapa general (exige `mapa:ver`). El ack trae los
   * contadores de todos los restaurantes, para no pintar nada viejo mientras
   * llega el primer aviso. Es compatible con estar en un restaurante.
   */
  "overview:join": (
    payload: Record<string, never>,
    ack: (res: Ack<{ counters: RestaurantCounters[] }>) => void,
  ) => void;
  /** Agregar un grupo a la lista rápida. */
  "waitlist:add": (payload: AddWaitlistEntryInput, ack: (res: Ack<{ entry: WaitlistEntrySnapshot; actionId: string }>) => void) => void;
  /**
   * Agregar varios grupos de una vez: todos o ninguno. La room recibe un
   * `waitlist:changed` («added») por cada uno, en el orden de llegada.
   */
  "waitlist:add-many": (payload: AddManyWaitlistEntriesInput, ack: (res: Ack<{ entries: WaitlistEntrySnapshot[]; actionId: string }>) => void) => void;
  /** Marcar un grupo listo o ausente. */
  "waitlist:resolve": (payload: ResolveWaitlistEntryInput, ack: (res: Ack<{ entry: WaitlistEntrySnapshot; actionId: string }>) => void) => void;
  /** Volver a la espera a un grupo listo o ausente. Se puede deshacer. */
  "waitlist:reopen": (payload: ReopenWaitlistEntryInput, ack: (res: Ack<{ entry: WaitlistEntrySnapshot; actionId: string }>) => void) => void;
  /**
   * Eliminar a un grupo de la lista. La room recibe `waitlist:changed` con
   * `removed`, igual que al deshacer un «agregar», así que los dos clientes lo
   * borran de su pantalla sin ninguna ruta nueva. Se puede deshacer.
   */
  "waitlist:delete": (payload: DeleteWaitlistEntryInput, ack: (res: Ack<{ entry: WaitlistEntrySnapshot; actionId: string }>) => void) => void;
  /** Deshacer la última acción de la lista para ese restaurante. */
  "waitlist:undo": (payload: UndoWaitlistInput, ack: (res: Ack<{ action: "removed" | "restored"; entry: WaitlistEntrySnapshot; entries?: WaitlistEntrySnapshot[] }>) => void) => void;
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
  /** Sala `overview`: cambiaron los contadores de un restaurante. */
  "overview:counters": (payload: RestaurantCounters) => void;
  /** Cambio de lista aplicado; se envía a todas las tablets del local. */
  "waitlist:changed": (payload: WaitlistChange) => void;
  /** Acción que cualquier host de la room puede deshacer. */
  "waitlist:undo-state": (payload: WaitlistUndoState) => void;
}

/** Lo que el servidor recuerda de cada conexión. */
export type SocketData = {
  /** Restaurante cuya room ocupa el socket; null hasta el primer join. */
  restaurantId: string | null;
  /** Usuario de la sesión, comprobado en el handshake con Better Auth. */
  userId: string;
};
