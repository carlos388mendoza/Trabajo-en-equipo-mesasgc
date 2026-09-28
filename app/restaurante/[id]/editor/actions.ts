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

import { applyLayoutStructure } from "@/lib/layout/save";
import type { SaveResult } from "@/lib/layout/save";
import { saveLayoutInputSchema } from "@/lib/layout/validation";

export type { SaveResult };

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
  }

  return result;
}

/** Resultado simple para acciones que no devuelven datos. */
export type SimpleResult = { ok: true } | { ok: false; error: string };

// TODO (Ambos): `await auth.api.getSession({ headers: await headers() })` y
// comprobar el rol contra `restaurants.ownerId`. Hoy es un placeholder
// deliberado: la comprobación de permisos del editor se hará en la tarea de
// Better Auth, y hasta entonces el control real lo dan las reglas de
// integridad de la base de datos.
function assertCanEditRestaurant(restaurantId: string): void {
  void restaurantId;
}
