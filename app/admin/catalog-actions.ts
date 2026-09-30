"use server";

// Acciones de /admin para marcas y restaurantes. Cada una vuelve a comprobar
// el permiso ("catalogo:gestionar", solo admin): una server action se puede
// llamar a mano sin pasar por la página. La lógica está en
// `lib/layout/catalog-admin.ts`.
//
// Después de cada cambio se revalidan las pantallas que muestran restaurantes
// (/admin, el mapa, las estadísticas y /inicio), para que el restaurante
// nuevo, o el desactivado, se vea en todas de inmediato.

import { revalidatePath } from "next/cache";

import { guardAction } from "@/lib/auth/session";
import { firstError } from "@/lib/auth/admin-input";
import {
  CatalogInputError,
  createBrand,
  createRestaurant,
  setBrandActive,
  setRestaurantActive,
  updateBrand,
  updateRestaurant,
} from "@/lib/layout/catalog-admin";
import {
  brandInputSchema,
  restaurantInputSchema,
  setCatalogActiveSchema,
  updateBrandSchema,
  updateRestaurantSchema,
} from "@/lib/layout/catalog-input";
import type { AdminResult } from "@/app/admin/actions";

async function run(work: () => Promise<string>): Promise<AdminResult> {
  try {
    const message = await work();
    for (const path of ["/admin", "/mapa", "/analiticas", "/inicio"]) revalidatePath(path);
    return { ok: true, message };
  } catch (error) {
    if (error instanceof CatalogInputError) return { ok: false, error: error.message };
    console.error("[admin] error en marcas o restaurantes", error);
    return { ok: false, error: "No se pudo guardar. Inténtalo de nuevo." };
  }
}

export async function createBrandAction(raw: unknown): Promise<AdminResult> {
  const guard = await guardAction("catalogo:gestionar");
  if (!guard.ok) return guard;
  const parsed = brandInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  return run(async () => {
    await createBrand(parsed.data);
    return `Marca «${parsed.data.name}» creada.`;
  });
}

export async function updateBrandAction(raw: unknown): Promise<AdminResult> {
  const guard = await guardAction("catalogo:gestionar");
  if (!guard.ok) return guard;
  const parsed = updateBrandSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { id, ...input } = parsed.data;
  return run(async () => {
    await updateBrand(id, input);
    return `Marca «${input.name}» guardada.`;
  });
}

export async function setBrandActiveAction(raw: unknown): Promise<AdminResult> {
  const guard = await guardAction("catalogo:gestionar");
  if (!guard.ok) return guard;
  const parsed = setCatalogActiveSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  return run(async () => {
    await setBrandActive(parsed.data.id, parsed.data.active);
    return parsed.data.active ? "Marca activada." : "Marca desactivada: ya no se ofrece para restaurantes nuevos.";
  });
}

export async function createRestaurantAction(raw: unknown): Promise<AdminResult> {
  const guard = await guardAction("catalogo:gestionar");
  if (!guard.ok) return guard;
  const parsed = restaurantInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  return run(async () => {
    await createRestaurant(parsed.data);
    return `Restaurante «${parsed.data.name}» creado, con una zona vacía para dibujar su plano.`;
  });
}

export async function updateRestaurantAction(raw: unknown): Promise<AdminResult> {
  const guard = await guardAction("catalogo:gestionar");
  if (!guard.ok) return guard;
  const parsed = updateRestaurantSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { id, ...input } = parsed.data;
  return run(async () => {
    await updateRestaurant(id, input);
    return `Restaurante «${input.name}» guardado.`;
  });
}

export async function setRestaurantActiveAction(raw: unknown): Promise<AdminResult> {
  const guard = await guardAction("catalogo:gestionar");
  if (!guard.ok) return guard;
  const parsed = setCatalogActiveSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  return run(async () => {
    await setRestaurantActive(parsed.data.id, parsed.data.active);
    return parsed.data.active
      ? "Restaurante activado: sus usuarios vuelven a verlo."
      : "Restaurante desactivado: sus usuarios dejan de verlo, pero su historial sigue en las estadísticas.";
  });
}
