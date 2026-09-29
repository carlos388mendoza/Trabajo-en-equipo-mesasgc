// Avisos a la sala `overview` (mapa general).
//
// `emitOverview(restaurantId)` recalcula los contadores de ESE restaurante y
// se los manda a los sockets de la sala. La llaman:
//
//  - `lib/realtime/server.ts`, después de sentar o liberar una mesa;
//  - las server actions del editor, después de guardar o copiar un plano;
//  - (pendiente, Miembro B) los eventos `waitlist:add`, `waitlist:resolve` y
//    `waitlist:undo` del modo rápido en vivo, porque cambian los clientes en
//    espera. Basta con `void emitOverview(restaurantId)` después de escribir.
//
// Como `emitToRestaurant`, no hace nada si no hay servidor de tiempo real
// (`next dev` a secas, un script), y NUNCA lanza: el cambio ya se guardó y
// avisar es un extra. Por eso se puede llamar con `void` sin esperar.

import { getCounters } from "@/lib/map/counters";

import { canJoinOverview } from "./auth";
import { OVERVIEW_ROOM } from "./events";
import { getRealtimeServer } from "./registry";

/**
 * Manda a la sala `overview` los contadores actuales de un restaurante.
 *
 * Antes de mandar, vuelve a comprobar `mapa:ver` de cada usuario de la sala:
 * si un admin le quitó el rol con el mapa abierto, su socket sale de la sala
 * y deja de recibir contadores desde ese momento, no desde que recargue.
 */
export async function emitOverview(restaurantId: string): Promise<void> {
  const io = getRealtimeServer();
  if (!io) return;
  try {
    const sockets = await io.in(OVERVIEW_ROOM).fetchSockets();
    if (sockets.length === 0) return;

    const [counters] = await getCounters([restaurantId]);
    // Un usuario puede tener el mapa abierto en varias pestañas: se le
    // comprueba una sola vez.
    const allowed = new Map<string, boolean>();
    for (const socket of sockets) {
      const { userId } = socket.data;
      if (!allowed.has(userId)) allowed.set(userId, await canJoinOverview({ userId }));
      if (allowed.get(userId)) socket.emit("overview:counters", counters);
      else socket.leave(OVERVIEW_ROOM);
    }
  } catch (err) {
    console.error("[realtime] error avisando a la sala overview", err);
  }
}
