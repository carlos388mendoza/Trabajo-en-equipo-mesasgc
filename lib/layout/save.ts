// Escritura de la estructura de una zona.
//
// Vive aquí y no en la server action a propósito. La action se ocupa de lo de
// HTTP (validar con Zod, comprobar permisos, revalidar la caché) y delega
// aquí todo lo que toca la base de datos. Así esta lógica se puede ejercitar
// desde un script, sin levantar Next ni pedir contexto de render.
//
// Reglas, en orden de importancia:
//
//  1. La zona tiene que pertenecer al restaurante indicado.
//  2. Los `elementTypeId` tienen que existir en el catálogo.
//  3. Un `id` que ya vive en OTRA zona se rechaza. Un id que no existe en
//     ninguna zona sí vale: es un elemento nuevo que crea el editor.
//  4. NO se escribe `status` ni `current_entry_id`: son del paso 6.
//  5. Una mesa ocupada no se puede borrar desde el editor.

import { and, eq, inArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { tableLayouts, tables } from "@/lib/db/schema";
import {
  findElementIdsInOtherLayouts,
  getTablesInLayout,
  getValidElementTypeIds,
} from "@/lib/db/queries/layouts";
import type { SaveLayoutInput } from "./validation";

export type SaveResult =
  | { ok: true; saved: number; removed: number; version: number }
  | { ok: false; error: string };

/**
 * Aplica la estructura completa de una zona.
 *
 * Recibe YA los datos validados: quien llama es responsable de haber pasado
 * el schema de Zod. No vuelve a validarlos.
 */
export async function applyLayoutStructure(
  input: SaveLayoutInput,
): Promise<SaveResult> {
  // (1) La zona tiene que ser de este restaurante.
  const layout = await db.query.tableLayouts.findFirst({
    where: and(
      eq(tableLayouts.id, input.layoutId),
      eq(tableLayouts.restaurantId, input.restaurantId),
    ),
  });
  if (!layout) {
    return { ok: false, error: "Esa zona no existe en este restaurante." };
  }

  // (2) Los tipos tienen que existir en el catálogo.
  const validTypeIds = await getValidElementTypeIds();
  const invalidType = input.elements.find(
    (e) => !validTypeIds.has(e.elementTypeId),
  );
  if (invalidType) {
    return {
      ok: false,
      error: `Tipo de elemento desconocido: ${invalidType.elementTypeId}`,
    };
  }

  const incomingIds = input.elements.map((e) => e.id);

  // Sin esto, un mismo elemento enviado dos veces hace que el borrado de abajo
  // sea ambiguo.
  if (new Set(incomingIds).size !== incomingIds.length) {
    return { ok: false, error: "Hay elementos repetidos en el mapa." };
  }

  // (3) Regla anti-impostor.
  const outsiders = await findElementIdsInOtherLayouts(
    input.layoutId,
    incomingIds,
  );
  if (outsiders.length > 0) {
    return {
      ok: false,
      error:
        "Algunos elementos pertenecen a otra zona. Recarga la página y " +
        "vuelve a intentarlo.",
    };
  }

  const current = await getTablesInLayout(input.layoutId);
  const currentById = new Map(current.map((t) => [t.id, t]));
  const incomingSet = new Set(incomingIds);

  // (5) Una mesa con clientes NO se borra desde el editor. Si se permitiera,
  // el histórico de la lista de espera apuntaría a una mesa inexistente.
  const occupiedRemoved = current.filter(
    (t) => t.currentEntryId !== null && !incomingSet.has(t.id),
  );
  if (occupiedRemoved.length > 0) {
    return {
      ok: false,
      error:
        "No se puede eliminar una mesa con clientes sentados. Libera la " +
        "mesa primero.",
    };
  }

  const toUpdate = input.elements.filter((e) => currentById.has(e.id));
  const toInsert = input.elements.filter((e) => !currentById.has(e.id));
  const toDelete = current.filter((t) => !incomingSet.has(t.id)).map((t) => t.id);

  const newVersion = layout.version + 1;

  // Todo o nada: si algo falla a medias, la zona se queda como estaba, que es
  // lo que el editor asume al pintar "guardado".
  await db.transaction(async (tx) => {
    if (toInsert.length > 0) {
      await tx.insert(tables).values(
        toInsert.map((e) => ({
          id: e.id,
          restaurantId: input.restaurantId,
          layoutId: input.layoutId,
          elementTypeId: e.elementTypeId,
          label: e.label,
          x: e.x,
          y: e.y,
          width: e.width,
          height: e.height,
          rotation: e.rotation,
          capacity: e.capacity,
          // `status` y `currentEntryId` se dejan fuera a propósito: los pone
          // el esquema y los lleva el paso 6.
        })),
      );
    }

    if (toUpdate.length > 0) {
      // (4) Lista de campos explícita y SIN `status` / `currentEntryId`.
      // Esos dos son del paso 6; pisarlos aquí haría que una mesa ocupada
      // apareciera libre en el mapa.
      //
      // Va en bucle y no en una sola sentencia porque los valores difieren
      // por fila. Con las decenas de mesas de un local real, dentro de una
      // transacción, va sobrado.
      for (const e of toUpdate) {
        await tx
          .update(tables)
          .set({
            elementTypeId: e.elementTypeId,
            label: e.label,
            x: e.x,
            y: e.y,
            width: e.width,
            height: e.height,
            rotation: e.rotation,
            capacity: e.capacity,
            version: sql`${tables.version} + 1`,
            updatedAt: new Date(),
          })
          // El `layout_id` en el WHERE es la segunda barrera: aunque un id se
          // colara, la fila solo se toca si pertenece a esta zona.
          .where(and(eq(tables.id, e.id), eq(tables.layoutId, input.layoutId)));
      }
    }

    if (toDelete.length > 0) {
      await tx.delete(tables).where(
        and(
          eq(tables.layoutId, input.layoutId),
          inArray(tables.id, toDelete),
          // Cinturón y tirantes, por si `occupiedRemoved` dejara pasar algo.
          sql`${tables.currentEntryId} IS NULL`,
        ),
      );
    }

    await tx
      .update(tableLayouts)
      .set({ version: newVersion, updatedAt: new Date() })
      .where(eq(tableLayouts.id, input.layoutId));
  });

  return {
    ok: true,
    saved: toInsert.length + toUpdate.length,
    removed: toDelete.length,
    version: newVersion,
  };
}
