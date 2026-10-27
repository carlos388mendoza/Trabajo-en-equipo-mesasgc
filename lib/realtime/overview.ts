// Avisos a la sala `overview` (mapa general).
//
// `emitOverview(restaurantId)` recalcula los contadores de ESE restaurante y
// los deja como aviso de la sala (`lib/realtime/bus.ts`). La llaman:
//
//  - los eventos de tiempo real (`lib/realtime/handlers.ts`), después de
//    sentar, liberar o cambiar la lista;
//  - las server actions del editor y de meseros, después de guardar o copiar.
//
// Quién puede leer la sala se comprueba al leer (`allowedRooms`: `mapa:ver`),
// no aquí: si un admin le quita el rol a alguien con el mapa abierto, deja de
// recibir contadores en la siguiente pregunta. NUNCA lanza: el cambio ya se
// guardó y avisar es un extra. Hay que esperarla (`await`) antes de contestar.

import { logServerError } from "@/lib/log";
import { getCounters } from "@/lib/map/counters";

import { publish } from "./bus";
import { OVERVIEW_ROOM } from "./events";

export async function emitOverview(restaurantId: string): Promise<void> {
  try {
    const [counters] = await getCounters([restaurantId]);
    if (counters) await publish(OVERVIEW_ROOM, [{ event: "overview:counters", args: [counters] }]);
  } catch (err) {
    logServerError("[realtime] error avisando a la sala overview", err);
  }
}
