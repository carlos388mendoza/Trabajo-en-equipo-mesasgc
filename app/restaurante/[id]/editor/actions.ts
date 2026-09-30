"use server";

// Acciones del editor de mesas.
//
// El canvas es cliente, así que el guardado es una server action y TODO lo que
// llega se trata como no confiable: cualquiera puede llamar a esta acción a
// mano con un `fetch`, sin pasar por la interfaz.
//
// Esta capa solo hace lo que es de HTTP:
//
//   1. Validar el payload con Zod.
//   2. Comprobar sesión y permiso (`guardAction`, que usa `lib/auth/rbac.ts`).
//   3. Delegar la escritura en `applyLayoutStructure`.
//   4. Revalidar la caché de la ruta.
//
// Las reglas de integridad (zona del restaurante, tipos del catálogo, ids que
// no son impostores, no pisar la ocupación, no borrar mesas ocupadas) están en
// `lib/layout/save.ts`, junto a las consultas.
//
// El permiso se comprueba AQUÍ, en cada action, y no solo en la página: una
// server action se puede llamar con un `fetch` a mano sin pasar por la UI
// (lo advierte la guía de Next), y el proxy solo mira si hay cookie.

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { eq } from "drizzle-orm";

import { guardAction } from "@/lib/auth/session";
import { restaurantsAllowed } from "@/lib/auth/rbac";
import { db } from "@/lib/db";
import { getTableOccupant } from "@/lib/db/queries/layouts";
import { tableLayouts } from "@/lib/db/schema";
import { emitOverview } from "@/lib/realtime/overview";
import { emitToRestaurant } from "@/lib/realtime/registry";
import { applyLayoutStructure } from "@/lib/layout/save";
import type { SaveResult } from "@/lib/layout/save";
import {
  copyLayoutInputSchema,
  copyZoneInputSchema,
  saveLayoutInputSchema,
} from "@/lib/layout/validation";
import {
  copyLayoutToRestaurant,
  copyZoneIntoLayout,
  getRestaurantsWithoutLayout,
  type CopyLayoutResult,
} from "@/lib/layout/copy";

export type { SaveResult };
export type { CopyLayoutResult };

export async function saveLayoutStructure(raw: unknown): Promise<SaveResult> {
  const parsed = saveLayoutInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Los datos del mapa no son válidos." };
  }

  const input = parsed.data;

  const guard = await guardAction("editor:guardar", input.restaurantId);
  if (!guard.ok) return guard;

  const result = await applyLayoutStructure(input);

  if (result.ok) {
    revalidatePath(`/restaurante/${input.restaurantId}/editor`);
    // Los demás dispositivos con esta zona abierta sabrán que lo suyo es viejo.
    emitToRestaurant(input.restaurantId, "layout:updated", {
      layoutId: input.layoutId,
      version: result.version,
    });
    // Añadir o borrar mesas cambia el total del mapa general.
    void emitOverview(input.restaurantId);
  }

  return result;
}

/** Resultado simple para acciones que no devuelven datos. */
export type SimpleResult = { ok: true } | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Copia de estructura a otro restaurante (paso 3)
// ---------------------------------------------------------------------------

/**
 * Copia TODAS las zonas de un restaurante a otro.
 *
 * `replace` no es un detalle: sin él, la acción solo deja copiar a un destino
 * que esté vacío. Es la diferencia entre "se me borró el local" y "hice clic
 * sin querer".
 */
export async function copyStructureToRestaurant(
  raw: unknown,
): Promise<CopyLayoutResult> {
  const parsed = copyLayoutInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Los datos de la copia no son válidos." };
  }

  // Hay que poder editar los DOS: leer el origen no basta para escribir en
  // el destino.
  for (const restaurantId of [parsed.data.sourceRestaurantId, parsed.data.targetRestaurantId]) {
    const guard = await guardAction("editor:guardar", restaurantId);
    if (!guard.ok) return guard;
  }

  const result = await copyLayoutToRestaurant(parsed.data);

  if (result.ok) {
    // Los dos lados cambian: el editor de origen y el del destino.
    revalidatePath(`/restaurante/${parsed.data.sourceRestaurantId}/editor`);
    revalidatePath(`/restaurante/${parsed.data.targetRestaurantId}/editor`);
    // Solo cambia el destino. Quien copia está en la room del origen, así que
    // no se avisa a sí mismo.
    emitToRestaurant(parsed.data.targetRestaurantId, "structure:changed");
    void emitOverview(parsed.data.targetRestaurantId);
  }

  return result;
}

/** Copia una zona a una zona que ya existe, ajustándola a su tamaño. */
export async function copyZoneIntoAnother(
  raw: unknown,
): Promise<CopyLayoutResult> {
  const parsed = copyZoneInputSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, error: "Los datos de la copia no son válidos." };
  }

  // La zona de destino puede ser de otro restaurante: se comprueba el suyo,
  // no el que dice el payload.
  const [target] = await db
    .select({ restaurantId: tableLayouts.restaurantId })
    .from(tableLayouts)
    .where(eq(tableLayouts.id, parsed.data.targetLayoutId))
    .limit(1);
  for (const restaurantId of [parsed.data.sourceRestaurantId, target?.restaurantId ?? ""]) {
    const guard = await guardAction("editor:guardar", restaurantId);
    if (!guard.ok) return guard;
  }

  const result = await copyZoneIntoLayout(parsed.data);
  if (result.ok) {
    revalidatePath(`/restaurante/${parsed.data.sourceRestaurantId}/editor`);
    if (target) void emitOverview(target.restaurantId);
  }
  return result;
}

export type RestaurantOption = {
  id: string;
  name: string;
  zones: number;
  elements: number;
  /** Mesas con clientes: avisa de que la sustitución se va a rechazar. */
  ocupadas: number;
};

const occupantInputSchema = z.object({
  restaurantId: z.string().min(1).max(64),
  tableId: z.string().min(1).max(64),
});

/**
 * Nombre y hora del cliente sentado en una mesa. SOLO LECTURA.
 *
 * El editor la llama al recibir `table:assigned`: el evento dice qué cliente
 * es, pero no cómo se llama, y así no hace falta cambiar el evento.
 */
export async function getTableOccupantInfo(
  raw: unknown,
): Promise<{ entryId: string; occupantName: string; seatedAt: number | null } | null> {
  const parsed = occupantInputSchema.safeParse(raw);
  if (!parsed.success) return null;
  const guard = await guardAction("editor:ver", parsed.data.restaurantId);
  if (!guard.ok) return null;
  return getTableOccupant(parsed.data.restaurantId, parsed.data.tableId);
}

/**
 * Restaurantes a los que ofrecer la copia, con lo que tienen dentro. Solo
 * los que este usuario puede editar: a un host no se le ofrecen locales
 * ajenos.
 */
export async function listCopyTargets(
  sourceRestaurantId: string,
): Promise<RestaurantOption[]> {
  const guard = await guardAction("editor:ver", sourceRestaurantId);
  if (!guard.ok) return [];
  return restaurantsAllowed(
    guard.user,
    "editor:guardar",
    await getRestaurantsWithoutLayout(sourceRestaurantId),
  );
}
