// Avisar a las pantallas de un restaurante desde fuera de un evento de tiempo
// real (por ejemplo, una server action del editor después de guardar).
//
// Antes buscaba el servidor de Socket.IO en `globalThis`; ahora deja el aviso
// en la base (`lib/realtime/bus.ts`), que es lo que leen todas las pantallas
// por su sondeo, estén en la instancia que estén (Vercel).

import { logServerError } from "@/lib/log";

import { publish } from "./bus";
import type { ServerToClientEvents } from "./events";
import { roomFor } from "./events";

/**
 * Avisa a todos los conectados a un restaurante. Hay que ESPERARLO (`await`)
 * antes de contestar: sin servidor propio, lo que no se guardó al terminar la
 * petición se puede perder. NUNCA lanza: el guardado ya ocurrió y avisar es un
 * extra.
 */
export async function emitToRestaurant<E extends keyof ServerToClientEvents>(
  restaurantId: string,
  event: E,
  ...args: Parameters<ServerToClientEvents[E]>
): Promise<void> {
  try {
    await publish(roomFor(restaurantId), [{ event, args }]);
  } catch (err) {
    logServerError("[realtime] no se pudo avisar al restaurante", err);
  }
}
