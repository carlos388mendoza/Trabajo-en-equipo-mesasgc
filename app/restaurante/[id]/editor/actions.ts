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
//   2. Comprobar permisos.
//   3. Delegar la escritura en `applyLayoutStructure`.
//   4. Revalidar la caché de la ruta.
//
// Las reglas de integridad (zona del restaurante, tipos del catálogo, ids que
// no son impostores, no pisar la ocupación, no borrar mesas ocupadas) están en
// `lib/layout/save.ts`, junto a las consultas.
//
// TODO (Ambos): cuando Better Auth esté montado, sustituir
// `assertCanEditRestaurant` por la comprobación de sesión y rol. La función
// está aislada para que ese cambio sea de un solo sitio. Ojo a lo que dice la
// documentación de esta versión de Next: que solo renderizar el formulario a
// usuarios autenticados NO es una barrera de seguridad, porque la petición se
// puede enviar sin pasar por la UI.

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { getTableOccupant } from "@/lib/db/queries/layouts";
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

  assertCanEditRestaurant(input.restaurantId);

  const result = await applyLayoutStructure(input);

  if (result.ok) {
    revalidatePath(`/restaurante/${input.restaurantId}/editor`);
    // Los demás dispositivos con esta zona abierta sabrán que lo suyo es viejo.
    emitToRestaurant(input.restaurantId, "layout:updated", {
      layoutId: input.layoutId,
      version: result.version,
    });
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

  assertCanEditRestaurant(parsed.data.sourceRestaurantId);
  assertCanEditRestaurant(parsed.data.targetRestaurantId);

  const result = await copyLayoutToRestaurant(parsed.data);

  if (result.ok) {
    // Los dos lados cambian: el editor de origen y el del destino.
    revalidatePath(`/restaurante/${parsed.data.sourceRestaurantId}/editor`);
    revalidatePath(`/restaurante/${parsed.data.targetRestaurantId}/editor`);
    // Solo cambia el destino. Quien copia está en la room del origen, así que
    // no se avisa a sí mismo.
    emitToRestaurant(parsed.data.targetRestaurantId, "structure:changed");
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

  assertCanEditRestaurant(parsed.data.sourceRestaurantId);

  const result = await copyZoneIntoLayout(parsed.data);
  if (result.ok) {
    revalidatePath(`/restaurante/${parsed.data.sourceRestaurantId}/editor`);
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
  assertCanEditRestaurant(parsed.data.restaurantId);
  return getTableOccupant(parsed.data.restaurantId, parsed.data.tableId);
}

/** Restaurantes a los que ofrecer la copia, con lo que tienen dentro. */
export async function listCopyTargets(
  sourceRestaurantId: string,
): Promise<RestaurantOption[]> {
  assertCanEditRestaurant(sourceRestaurantId);
  return getRestaurantsWithoutLayout(sourceRestaurantId);
}

// TODO (Ambos): `await auth.api.getSession({ headers: await headers() })` y
// comprobar el rol contra `restaurants.ownerId`. Hoy es un placeholder
// deliberado: la comprobación de permisos del editor se hará en la tarea de
// Better Auth, y hasta entonces el control real lo dan las reglas de
// integridad de la base de datos.
function assertCanEditRestaurant(restaurantId: string): void {
  void restaurantId;
}
