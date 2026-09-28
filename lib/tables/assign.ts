// Asignación de clientes a mesas, con bloqueo optimista (paso 6).
//
// No importa nada de Next ni de Socket.IO: la llaman los handlers de
// `lib/realtime/server.ts` y la ejercita `scripts/verify-realtime.mts` sin
// levantar nada.
//
// La garantía de "una mesa, un cliente" no la da una lectura previa (entre
// leer y escribir, otro host puede adelantarse), sino que la escritura sea
// CONDICIONAL:
//
//   UPDATE tables SET current_entry_id = ?
//   WHERE id = ? AND current_entry_id IS NULL
//
// La base de datos ejecuta esa sentencia de forma atómica. Si dos hosts piden
// la misma mesa a la vez, el primero cambia 1 fila y el segundo 0: el que
// cambió 0 filas perdió, y se le dice. No hace falta un candado aparte.
//
// Las lecturas de antes solo sirven para dar un mensaje claro ("esa mesa no
// existe", "eso es un baño"); la decisión la toma el UPDATE.

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  ACTIVE_WAITLIST_STATUSES,
  type TableStatus,
  type WaitlistStatus,
  isActiveWaitlistStatus,
  isSeatableElement,
} from "@/lib/db/enums";
import { elementTypes, tables, waitlistEntries } from "@/lib/db/schema";

const FREE: TableStatus = "libre";
const OCCUPIED: TableStatus = "ocupada";
const SEATED: WaitlistStatus = "sentado";

/** Cómo queda una mesa después de asignarla o liberarla. */
export type TableOccupancy = {
  tableId: string;
  layoutId: string;
  status: TableStatus;
  currentEntryId: string | null;
  /** `tables.version` después del cambio. */
  version: number;
};

export type AssignConflict =
  /** Otro host se adelantó: la mesa ya tiene cliente. */
  | "mesa_ocupada"
  /** El cliente ya se sentó en otra mesa o lo marcaron ausente. */
  | "cliente_no_disponible"
  | "mesa_no_existe"
  | "no_es_mesa"
  | "cliente_no_existe";

export type AssignResult =
  | { ok: true; table: TableOccupancy; entryId: string }
  | { ok: false; code: AssignConflict; error: string };

export type ReleaseResult =
  | { ok: true; table: TableOccupancy; entryId: string }
  | { ok: false; code: "mesa_no_existe" | "mesa_cambio"; error: string };

const MESSAGES: Record<AssignConflict, string> = {
  mesa_ocupada: "Esta mesa ya fue asignada.",
  cliente_no_disponible: "Ese cliente ya no está en la lista de espera.",
  mesa_no_existe: "Esa mesa no existe en este restaurante.",
  no_es_mesa: "En ese elemento no se puede sentar a nadie.",
  cliente_no_existe: "Ese cliente no está en la lista de este restaurante.",
};

function conflict(code: AssignConflict): AssignResult {
  return { ok: false, code, error: MESSAGES[code] };
}

export type AssignRequest = {
  restaurantId: string;
  tableId: string;
  entryId: string;
  /** Host que asigna, para auditoría. Null hasta que haya Better Auth. */
  userId: string | null;
};

/**
 * Sienta a un cliente de la lista de espera en una mesa.
 *
 * Gana el primero que llega a la base de datos. El que pierde recibe
 * `mesa_ocupada` y no se escribe nada suyo.
 */
export async function assignTable(req: AssignRequest): Promise<AssignResult> {
  const { restaurantId, tableId, entryId, userId } = req;

  // --- Lecturas, solo para dar un buen mensaje ---------------------------

  const [table] = await db
    .select({ currentEntryId: tables.currentEntryId, typeKey: elementTypes.key })
    .from(tables)
    .innerJoin(elementTypes, eq(elementTypes.id, tables.elementTypeId))
    .where(and(eq(tables.id, tableId), eq(tables.restaurantId, restaurantId)))
    .limit(1);
  if (!table) return conflict("mesa_no_existe");
  if (!isSeatableElement(table.typeKey)) return conflict("no_es_mesa");

  const [entry] = await db
    .select({ status: waitlistEntries.status })
    .from(waitlistEntries)
    .where(
      and(eq(waitlistEntries.id, entryId), eq(waitlistEntries.restaurantId, restaurantId)),
    )
    .limit(1);
  if (!entry) return conflict("cliente_no_existe");
  if (!isActiveWaitlistStatus(entry.status)) return conflict("cliente_no_disponible");

  // Atajo: si ya se ve ocupada no hace falta intentar escribir. No es la
  // garantía (eso es el WHERE de abajo), solo ahorra un viaje.
  if (table.currentEntryId !== null) return conflict("mesa_ocupada");

  // --- La escritura que decide -------------------------------------------

  const now = new Date();
  const activeStatuses = [...ACTIVE_WAITLIST_STATUSES];

  // Las dos sentencias van en un `batch`, que la base de datos ejecuta como
  // una sola transacción: o se sientan mesa y cliente, o ninguno. Es mejor
  // que una transacción interactiva porque no hay idas y vueltas entre
  // sentencias en las que otro host pueda colarse, y en Turso es una sola
  // petición.
  //
  // Cada sentencia lleva su condición en el WHERE:
  //  - La mesa solo se ocupa si sigue libre Y el cliente sigue esperando.
  //  - El cliente solo pasa a "sentado" si la mesa quedó apuntándole a él.
  // Así, si la primera no cambia nada, la segunda tampoco.
  let claimed: { version: number; layoutId: string }[];
  try {
    [claimed] = await db.batch([
      db
        .update(tables)
        .set({
          currentEntryId: entryId,
          status: OCCUPIED,
          version: sql`${tables.version} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(tables.id, tableId),
            eq(tables.restaurantId, restaurantId),
            isNull(tables.currentEntryId),
            sql`exists (select 1 from ${waitlistEntries} where ${waitlistEntries.id} = ${entryId} and ${waitlistEntries.restaurantId} = ${restaurantId} and ${inArray(waitlistEntries.status, activeStatuses)})`,
          ),
        )
        .returning({ version: tables.version, layoutId: tables.layoutId }),
      db
        .update(waitlistEntries)
        .set({
          status: SEATED,
          seatedAt: now,
          assignedTableId: tableId,
          seatedByUserId: userId,
          updatedAt: now,
        })
        .where(
          and(
            eq(waitlistEntries.id, entryId),
            eq(waitlistEntries.restaurantId, restaurantId),
            inArray(waitlistEntries.status, activeStatuses),
            sql`exists (select 1 from ${tables} where ${tables.id} = ${tableId} and ${tables.currentEntryId} = ${entryId})`,
          ),
        )
        .returning({ id: waitlistEntries.id }),
    ]);
  } catch (err) {
    // El índice único `tables_current_entry_unique` es la red de seguridad:
    // un cliente no puede estar en dos mesas. Si salta, perdió la carrera.
    if (String(err).includes("UNIQUE")) return conflict("cliente_no_disponible");
    throw err;
  }

  if (claimed.length === 0) {
    // Otro se adelantó entre las lecturas y el batch. Se vuelve a mirar
    // solo para decir QUÉ cambió.
    const [current] = await db
      .select({ currentEntryId: tables.currentEntryId })
      .from(tables)
      .where(eq(tables.id, tableId))
      .limit(1);
    return conflict(current?.currentEntryId ? "mesa_ocupada" : "cliente_no_disponible");
  }

  return {
    ok: true,
    entryId,
    table: {
      tableId,
      layoutId: claimed[0].layoutId,
      status: OCCUPIED,
      currentEntryId: entryId,
      version: claimed[0].version,
    },
  };
}

export type ReleaseRequest = {
  restaurantId: string;
  tableId: string;
  /**
   * Cliente que el host CREE que está en la mesa. Si ya no es él (otro host
   * la liberó y la volvió a asignar), no se libera: dejaría sin mesa a un
   * cliente que el host ni siquiera ha visto.
   */
  entryId: string;
};

/**
 * Libera una mesa (el cliente se fue).
 *
 * El cliente de la lista se queda como "sentado" con su `assigned_table_id`:
 * es el histórico que usan las estadísticas.
 */
export async function releaseTable(req: ReleaseRequest): Promise<ReleaseResult> {
  const { restaurantId, tableId, entryId } = req;

  // Una sola sentencia condicional: es atómica por sí misma.
  const released = await db
    .update(tables)
    .set({
      currentEntryId: null,
      status: FREE,
      version: sql`${tables.version} + 1`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(tables.id, tableId),
        eq(tables.restaurantId, restaurantId),
        eq(tables.currentEntryId, entryId),
      ),
    )
    .returning({ version: tables.version, layoutId: tables.layoutId });

  if (released.length === 0) {
    const [row] = await db
      .select({ id: tables.id })
      .from(tables)
      .where(and(eq(tables.id, tableId), eq(tables.restaurantId, restaurantId)))
      .limit(1);
    return row
      ? {
          ok: false,
          code: "mesa_cambio",
          error: "La mesa cambió desde otro dispositivo. Se actualizó el mapa.",
        }
      : { ok: false, code: "mesa_no_existe", error: MESSAGES.mesa_no_existe };
  }

  return {
    ok: true,
    entryId,
    table: {
      tableId,
      layoutId: released[0].layoutId,
      status: FREE,
      currentEntryId: null,
      version: released[0].version,
    },
  };
}
