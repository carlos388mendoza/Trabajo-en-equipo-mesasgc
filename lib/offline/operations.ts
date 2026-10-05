// Idempotencia de las operaciones que llegan de la cola offline.
//
// Una tablet sin Internet guarda sus cambios con un `operationId` (UUID) y los
// manda al reconectar. Si el ack se pierde por el camino, los vuelve a mandar
// con el MISMO id. Sin esta memoria, el servidor los aplicaría dos veces: dos
// clientes iguales, o un «este cliente ya fue atendido» falso porque el primer
// envío sí había entrado.
//
// Regla: la primera vez que llega un `operationId` se ejecuta y se guarda la
// respuesta (éxito o rechazo). Las siguientes devuelven esa respuesta tal
// cual, marcada como `replayed`, sin tocar la base ni avisar otra vez a la
// room. Un id que pertenece a otro restaurante se rechaza: no se puede usar
// para leer respuestas ajenas.
//
// Sin nada de Next ni de Socket.IO: lo usa `lib/realtime/server.ts` y lo
// prueba `scripts/verify-realtime.mts`.

import { and, eq, lt } from "drizzle-orm";

import { db } from "@/lib/db";
import { offlineOperations } from "@/lib/db/schema";

/** Cuánto se recuerda una operación. Una tablet no pasa una semana sin red. */
export const OPERATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type AnyAck = { ok: boolean } & Record<string, unknown>;

export type OperationOutcome<T extends AnyAck> =
  | { kind: "nueva"; result: T }
  | { kind: "repetida"; result: T };

/**
 * Ejecuta `run` una sola vez por `operationId`. Sin id (la tablet está en
 * línea y no viene de la cola), solo lo ejecuta.
 */
export async function runOnce<T extends AnyAck>(
  operation: { operationId?: string; restaurantId: string; userId: string | null; action: string },
  run: () => Promise<T>,
): Promise<OperationOutcome<T>> {
  const { operationId, restaurantId, userId, action } = operation;
  if (!operationId) return { kind: "nueva", result: await run() };

  const [seen] = await db
    .select()
    .from(offlineOperations)
    .where(eq(offlineOperations.operationId, operationId))
    .limit(1);
  if (seen) {
    if (seen.restaurantId !== restaurantId || seen.action !== action) {
      return {
        kind: "repetida",
        result: { ok: false, error: "Esa operación no es de este restaurante." } as unknown as T,
      };
    }
    return { kind: "repetida", result: JSON.parse(seen.response) as T };
  }

  const result = await run();
  // Si dos envíos del mismo id llegaran a la vez (dos pestañas del mismo
  // dispositivo), el segundo INSERT no hace nada: queda la primera respuesta.
  await db
    .insert(offlineOperations)
    .values({ operationId, restaurantId, userId, action, ok: result.ok, response: JSON.stringify(result) })
    .onConflictDoNothing();
  // De vez en cuando, se olvidan las viejas. Sin esperar: no frena el ack.
  if (Math.random() < 0.02) void purgeOldOperations().catch(() => {});
  return { kind: "nueva", result };
}

export async function purgeOldOperations(now = Date.now()): Promise<number> {
  const removed = await db
    .delete(offlineOperations)
    .where(lt(offlineOperations.createdAt, new Date(now - OPERATION_TTL_MS)))
    .returning({ id: offlineOperations.operationId });
  return removed.length;
}

/** Para las pruebas: ¿se guardó esta operación y con qué resultado? */
export async function findOperation(operationId: string, restaurantId: string) {
  const [row] = await db
    .select()
    .from(offlineOperations)
    .where(and(eq(offlineOperations.operationId, operationId), eq(offlineOperations.restaurantId, restaurantId)))
    .limit(1);
  return row ?? null;
}
