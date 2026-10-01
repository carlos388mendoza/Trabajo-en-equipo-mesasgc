"use server";

// Acción de /admin/datos-demo para BORRAR el lote de demostración.
//
// Dos comprobaciones, y las dos importan:
//
//  1. `guardAction("demo:borrar")`: solo el admin. Una server action se puede
//     llamar a mano sin pasar por la página (con un POST y el id de la action),
//     así que ocultar el botón NO protege nada: el permiso se comprueba aquí,
//     dentro de la acción.
//
//  2. La palabra de confirmación la vuelve a comprobar el servidor. El botón
//     "Borrar" solo no basta: un POST con el id de la action borra igual.
//
// El borrado en sí es `borrarDemoData()` de `lib/demo/delete.ts`: el mismo
// servicio que usa `npm run db:demo:borrar`. Lo que pasa por la terminal y por
// la web es exactamente lo mismo.
//
// Después se revalidan TODAS las pantallas que muestran clientes o mesas, no
// solo /admin: borrar el demo cambia el mapa, las estadísticas y el modo
// rápido de los ocho restaurantes.

import { revalidatePath } from "next/cache";

import type { AdminResult } from "@/app/admin/actions";
import { guardAction } from "@/lib/auth/session";
import { borrarDemoData } from "@/lib/demo/delete";
import { DEMO_DELETE_WORD } from "@/lib/demo/fixtures";

export type DemoDeleteState = AdminResult;

/**
 * Borra los datos de demostración.
 *
 * `confirmacion` tiene que valer exactamente `BORRAR` (sin tildes, sin espacios
 * extra alrededor: se compara ya recortada). Es la segunda barrera, después del
 * permiso.
 */
export async function deleteDemoDataAction(
  raw: { confirmacion?: string } | undefined,
): Promise<DemoDeleteState> {
  const guard = await guardAction("demo:borrar");
  if (!guard.ok) return guard;

  const confirmacion = (raw?.confirmacion ?? "").trim();
  if (confirmacion !== DEMO_DELETE_WORD) {
    return {
      ok: false,
      error: `Para borrar hay que escribir «${DEMO_DELETE_WORD}». No se borró nada.`,
    };
  }

  try {
    const result = await borrarDemoData();
    if (!result.ok) {
      // `borrarDemoData` se negó: hay un dato real que depende de algo demo. No
      // se escribe nada y se enseña el motivo.
      return { ok: false, error: result.error };
    }

    // Todo lo que muestra clientes, mesas o estadísticas.
    for (const path of [
      "/admin/datos-demo",
      "/admin",
      "/mapa",
      "/analiticas",
      "/inicio",
      "/ajustes",
    ]) {
      revalidatePath(path);
    }

    if (result.clientes === 0 && result.mesas === 0 && result.zonas === 0) {
      return { ok: true, message: "No había datos de demostración. No se borró nada." };
    }
    return {
      ok: true,
      message:
        `Datos de demostración borrados: ${result.zonas} zona(s), ` +
        `${result.mesas} mesa(s) y ${result.clientes} cliente(s).`,
    };
  } catch (error) {
    console.error("[admin] error borrando los datos de demostración", error);
    return {
      ok: false,
      error: "No se pudieron borrar los datos de demostración. Inténtalo de nuevo.",
    };
  }
}