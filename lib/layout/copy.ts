// Copia de la estructura de mesas entre restaurantes.
//
// "Estructura" son las zonas y sus elementos con su geometría. NO se copian
// clientes de la lista de espera ni la ocupación: en el destino todo arranca
// libre, que es lo único que tiene sentido.
//
// Hay dos modos:
//
//  - "all": se lleva TODAS las zonas del origen a otro restaurante. Las zonas
//    se copian tal cual, con las dimensiones de la origen. Es lo fiel: el
//    destino ya no tenía nada suyo al que adaptarse (sus zonas se
//    sustituyen), así que la copia se ve igual que en el origen.
//
//  - "zone": se lleva UNA zona a una zona que ya existe. Aquí sí hay que
//    encajar, porque la zona de destino conserva su lienzo: el contenido se
//    escala de forma uniforme para caber, y así se conservan las posiciones
//    relativas entre elementos.
//
// Reglas comunes:
//
//  1. Origen y destino distintos, y ambos existen.
//  2. Todo en una transacción: o se copia entero, o no se copia nada.
//  3. Si el destino ya tiene estructura, solo se sustituye con `replace: true`.
//  4. Los ids son nuevos. `onConflictDoNothing` por si un uuid choca de verdad.
//  5. No se escribe `status` ni `current_entry_id`: nacen libres.

import { and, eq, inArray, isNull, not } from "drizzle-orm";

import { db } from "@/lib/db";
import { restaurants, tableLayouts, tables } from "@/lib/db/schema";
import { boundingBox, normalize } from "./geometry";

export type CopyLayoutResult =
  | {
      ok: true;
      zones: number;
      elements: number;
      replaced: boolean;
      targetName: string;
    }
  | { ok: false; error: string };

export type CopyAllRequest = {
  sourceRestaurantId: string;
  targetRestaurantId: string;
  replace: boolean;
};

export type CopyZoneRequest = {
  sourceRestaurantId: string;
  sourceLayoutId: string;
  targetLayoutId: string;
};

async function findRestaurants(ids: string[]) {
  const rows = await db
    .select({ id: restaurants.id, name: restaurants.name })
    .from(restaurants)
    .where(inArray(restaurants.id, ids));
  return new Map(rows.map((r) => [r.id, r.name]));
}

/** Ids de las zonas de un restaurante. */
async function layoutIdsOf(restaurantId: string): Promise<string[]> {
  const rows = await db
    .select({ id: tableLayouts.id })
    .from(tableLayouts)
    .where(eq(tableLayouts.restaurantId, restaurantId));
  return rows.map((r) => r.id);
}

/** `{elements, ocupadas}` de un conjunto de zonas. */
async function countElements(layoutIds: string[]) {
  if (layoutIds.length === 0) return { elements: 0, ocupadas: 0 };

  const rows = await db
    .select({ id: tables.id, currentEntryId: tables.currentEntryId })
    .from(tables)
    .where(inArray(tables.layoutId, layoutIds));

  return {
    elements: rows.length,
    ocupadas: rows.filter((r) => r.currentEntryId !== null).length,
  };
}

/** Resuelve el nombre de un tipo a partir de una fila ya cargada. */
type SourceElement = typeof tables.$inferSelect;

// ---------------------------------------------------------------------------
// Modo "all"
// ---------------------------------------------------------------------------

export async function copyLayoutToRestaurant(
  request: CopyAllRequest,
): Promise<CopyLayoutResult> {
  const { sourceRestaurantId, targetRestaurantId, replace } = request;

  if (sourceRestaurantId === targetRestaurantId) {
    return {
      ok: false,
      error: "Elige un restaurante distinto al que estás editando.",
    };
  }

  const names = await findRestaurants([sourceRestaurantId, targetRestaurantId]);
  const targetName = names.get(targetRestaurantId);
  if (!names.has(sourceRestaurantId)) {
    return { ok: false, error: "El restaurante de origen no existe." };
  }
  if (!targetName) {
    return { ok: false, error: "El restaurante de destino no existe." };
  }

  const sourceLayouts = await db
    .select()
    .from(tableLayouts)
    .where(eq(tableLayouts.restaurantId, sourceRestaurantId));

  if (sourceLayouts.length === 0) {
    return {
      ok: false,
      error: "Este restaurante todavía no tiene zonas que copiar.",
    };
  }

  const sourceElements = await db
    .select()
    .from(tables)
    .where(
      inArray(
        tables.layoutId,
        sourceLayouts.map((l) => l.id),
      ),
    );

  const targetLayoutIds = await layoutIdsOf(targetRestaurantId);
  const targetCounts = await countElements(targetLayoutIds);

  if (targetLayoutIds.length > 0 && !replace) {
    return {
      ok: false,
      error:
        `${targetName} ya tiene ${targetLayoutIds.length} zona(s) y ` +
        `${targetCounts.elements} elemento(s).`,
    };
  }

  // (regla 3, segunda parte) Si el destino tiene mesas ocupadas, sustituirlo
  // rompería la lista de espera de ese local. Se comprueba ANTES de escribir
  // nada, para poder devolver un mensaje que explique cómo arreglarlo.
  if (replace && targetCounts.ocupadas > 0) {
    return {
      ok: false,
      error:
        `${targetName} tiene ${targetCounts.ocupadas} mesa(s) con clientes ` +
        "sentados. Libéralas antes de copiar la estructura.",
    };
  }

  const newLayoutIds = sourceLayouts.map(() => crypto.randomUUID());
  const layoutIdByOld = new Map(sourceLayouts.map((l, i) => [l.id, newLayoutIds[i]]));

  // El destino se vacía antes de insertar, así que sus nombres quedan libres y
  // los del origen se pueden reutilizar tal cual. No hace falta renombrar nada
  // para esquivar el índice único de (restaurante, nombre).
  //
  // La zona por defecto SÍ hay que buscarla: no basta con mirar la primera fila,
  // porque el `select` no garantiza un orden y la de por defecto puede ser la
  // segunda. Si el origen no marcara ninguna, el destino se queda sin defecto y
  // el editor no sabría cuál abrir.
  const defaultSource = sourceLayouts.find((l) => l.isDefault) ?? sourceLayouts[0];
  const defaultSourceId = defaultSource?.id;

  const newLayouts = sourceLayouts.map((l) => ({
    id: layoutIdByOld.get(l.id)!,
    restaurantId: targetRestaurantId,
    name: l.name,
    description: l.description,
    isDefault: l.id === defaultSourceId,
    width: l.width,
    height: l.height,
    sortOrder: l.sortOrder,
  }));

  const newElements = sourceElements.map((e: SourceElement) => ({
    id: crypto.randomUUID(),
    restaurantId: targetRestaurantId,
    layoutId: layoutIdByOld.get(e.layoutId)!,
    elementTypeId: e.elementTypeId,
    label: e.label,
    // Tal cual: la copia se ve igual que en el origen.
    x: e.x,
    y: e.y,
    width: e.width,
    height: e.height,
    // La orientación ya va metida en la geometría. Dejarlo aquí en 0 hace que
    // el destino se dibuje igual sin tocar el `rotation` de origen, que en el
    // paso 4 significa otra cosa.
    rotation: 0,
    capacity: e.capacity,
  }));

  await db.transaction(async (tx) => {
    if (targetLayoutIds.length > 0) {
      // `not(isNull(...))` sobre la zona actual: como las zonas tienen
      // `ON DELETE CASCADE` hacia `tables`, esto borra también sus mesas.
      await tx
        .delete(tableLayouts)
        .where(
          and(
            eq(tableLayouts.restaurantId, targetRestaurantId),
            not(isNull(tableLayouts.id)),
          ),
        );
    }

    await tx.insert(tableLayouts).values(newLayouts);
    if (newElements.length > 0) {
      await tx.insert(tables).values(newElements).onConflictDoNothing();
    }
  });

  return {
    ok: true,
    zones: newLayouts.length,
    elements: newElements.length,
    replaced: targetLayoutIds.length > 0,
    targetName,
  };
}

// ---------------------------------------------------------------------------
// Modo "zone"
// ---------------------------------------------------------------------------

/** Escala un conjunto de cajas para que quepa en `box`, sin deformarlas. */
function scaleToFit(
  boxes: readonly { x: number; y: number; width: number; height: number }[],
  box: { width: number; height: number },
) {
  const bounds = boundingBox(boxes);
  if (!bounds || bounds.width === 0 || bounds.height === 0) {
    return { scale: 1, boxes };
  }

  // Sin agrandar: si el origen es más pequeño que el destino, se deja al
  // tamaño natural y no se estira.
  const scale = Math.min(
    1,
    box.width / bounds.width,
    box.height / bounds.height,
  );

  return {
    scale,
    boxes: boxes.map((b) => ({
      ...b,
      x: Math.round(b.x * scale),
      y: Math.round(b.y * scale),
      width: Math.max(1, Math.round(b.width * scale)),
      height: Math.max(1, Math.round(b.height * scale)),
    })),
  };
}

export async function copyZoneIntoLayout(
  request: CopyZoneRequest,
): Promise<CopyLayoutResult> {
  const { sourceRestaurantId, sourceLayoutId, targetLayoutId } = request;

  const names = await findRestaurants([sourceRestaurantId]);
  const sourceName = names.get(sourceRestaurantId);
  if (!sourceName) {
    return { ok: false, error: "El restaurante de origen no existe." };
  }

  const layouts = await db
    .select()
    .from(tableLayouts)
    .where(
      inArray(tableLayouts.id, [sourceLayoutId, targetLayoutId]),
    );
  const sourceLayout = layouts.find((l) => l.id === sourceLayoutId);
  const targetLayout = layouts.find((l) => l.id === targetLayoutId);

  if (!sourceLayout || sourceLayout.restaurantId !== sourceRestaurantId) {
    return { ok: false, error: "La zona de origen no existe." };
  }
  if (!targetLayout) {
    return { ok: false, error: "La zona de destino no existe." };
  }

  const sourceElements = await db
    .select()
    .from(tables)
    .where(eq(tables.layoutId, sourceLayoutId));

  // Ya ocupa la zona de destino.
  const targetElements = await db
    .select({ id: tables.id, currentEntryId: tables.currentEntryId })
    .from(tables)
    .where(eq(tables.layoutId, targetLayoutId));

  if (targetElements.some((e) => e.currentEntryId !== null)) {
    return {
      ok: false,
      error:
        "La zona de destino tiene mesas con clientes sentados. " +
        "Libéralas antes de sustituirla.",
    };
  }

  // Escalar y normalizar: `normalize` deja la zona de origen empezando en
  // (0, 0), así el contenido se ancla en la esquina de la de destino.
  const fitted = scaleToFit(normalize(sourceElements), targetLayout);

  // Las etiquetas se copian tal cual. La zona de destino se vacía más abajo, así
  // que no puede chocar con las suyas, y dentro de la zona de origen ya son
  // únicas (las genera el editor con `nextLabel`).
  const newElements = fitted.boxes.map((b, i) => {
    const origin = sourceElements[i];
    return {
      id: crypto.randomUUID(),
      restaurantId: targetLayout.restaurantId,
      layoutId: targetLayoutId,
      elementTypeId: origin.elementTypeId,
      label: origin.label,
      x: b.x,
      y: b.y,
      width: b.width,
      height: b.height,
      rotation: 0,
      capacity: origin.capacity,
    };
  });

  const newVersion = targetLayout.version + 1;

  await db.transaction(async (tx) => {
    // Sustituir el contenido de la zona de destino, no borrarla: la zona
    // sobrevive con su nombre, su tamaño y su `is_default`.
    await tx
      .delete(tables)
      .where(
        and(
          eq(tables.layoutId, targetLayoutId),
          isNull(tables.currentEntryId),
        ),
      );

    if (newElements.length > 0) {
      await tx.insert(tables).values(newElements).onConflictDoNothing();
    }

    await tx
      .update(tableLayouts)
      .set({ version: newVersion, updatedAt: new Date() })
      .where(eq(tableLayouts.id, targetLayoutId));
  });

  return {
    ok: true,
    zones: 1,
    elements: newElements.length,
    replaced: targetElements.length > 0,
    targetName: targetLayout.name,
  };
}

// ---------------------------------------------------------------------------
// Para el diálogo
// ---------------------------------------------------------------------------

/** Cuántas zonas y elementos tiene un restaurante. */
export async function getStructureCounts(restaurantId: string) {
  const ids = await layoutIdsOf(restaurantId);
  return { zones: ids.length, ...(await countElements(ids)) };
}

/** Tiendas de un restaurante que aún no tienen zona, para "crear y copiar". */
export async function getRestaurantsWithoutLayout(excludeId: string) {
  const all = await db
    .select({ id: restaurants.id, name: restaurants.name })
    .from(restaurants)
    .where(not(eq(restaurants.id, excludeId)));

  const out: {
    id: string;
    name: string;
    zones: number;
    elements: number;
    ocupadas: number;
  }[] = [];
  for (const r of all) {
    out.push({ id: r.id, name: r.name, ...(await getStructureCounts(r.id)) });
  }
  return out;
}
