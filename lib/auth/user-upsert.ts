// Crear o actualizar un usuario desde la terminal (`npm run create-user`).
//
// Usa las mismas validaciones (`lib/auth/admin-input.ts`) y las mismas
// funciones (`lib/auth/users.ts`) que /admin. Sin Next ni terminal: el script
// pregunta y confirma, y esto hace el trabajo, así que `verify:auth` lo puede
// probar.

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { brands, restaurants, user } from "@/lib/db/schema";

import { createUserSchema, firstError, updateAccessSchema } from "./admin-input";
import { UserInputError, createUserWithPassword, findUserIdByEmail, setUserAccess } from "./users";

/** Sin mayúsculas, tildes ni apóstrofos: «dennys» encuentra «Denny's». */
function normalize(text: string): string {
  return text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/['’`´]/g, "")
    .trim()
    .toLowerCase();
}

export type ResolvedRestaurant = { id: string; name: string; slug: string };

/**
 * Los restaurantes ACTIVOS que piden `--restaurante` (slug o id) y `--marca`
 * (nombre de la marca: todos los suyos). Cualquier slug o marca que no exista
 * es un error: mejor no hacer nada que dar un acceso a medias.
 */
export async function resolveRestaurants(input: { slugs: string[]; brands: string[] }): Promise<ResolvedRestaurant[]> {
  const found = new Map<string, ResolvedRestaurant>();
  const active = await db
    .select({ id: restaurants.id, name: restaurants.name, slug: restaurants.slug, brandId: restaurants.brandId })
    .from(restaurants)
    .where(eq(restaurants.active, true));

  for (const wanted of input.slugs) {
    const match = active.find((r) => r.slug === wanted.trim() || r.id === wanted.trim());
    if (!match) throw new UserInputError(`No hay ningún restaurante activo con el slug «${wanted}».`);
    found.set(match.id, match);
  }

  if (input.brands.length > 0) {
    const allBrands = await db.select({ id: brands.id, name: brands.name }).from(brands).where(eq(brands.active, true));
    for (const wanted of input.brands) {
      const brand = allBrands.find((b) => normalize(b.name) === normalize(wanted) || b.id === wanted.trim());
      if (!brand) throw new UserInputError(`No hay ninguna marca activa llamada «${wanted}».`);
      const own = active.filter((r) => r.brandId === brand.id);
      if (own.length === 0) throw new UserInputError(`La marca «${brand.name}» no tiene restaurantes activos.`);
      for (const r of own) found.set(r.id, r);
    }
  }
  return [...found.values()].map(({ id, name, slug }) => ({ id, name, slug })).sort((a, b) => a.name.localeCompare(b.name, "es"));
}

export type UpsertInput = {
  email: string;
  name: string;
  roles: string[];
  restaurantIds: string[];
};

/** Qué pasaría, antes de pedir la contraseña: crear o actualizar. */
export async function existingUser(email: string): Promise<{ id: string; name: string } | null> {
  const id = await findUserIdByEmail(email.trim().toLowerCase());
  if (!id) return null;
  const [row] = await db.select({ name: user.name }).from(user).where(eq(user.id, id));
  return { id, name: row?.name ?? "" };
}

/**
 * Valida sin guardar, para avisar antes de pedir la contraseña. Con una
 * contraseña de relleno que cumple la regla: la de verdad se valida después.
 */
export function validateUpsert(input: UpsertInput): string | null {
  const parsed = createUserSchema.safeParse({ ...input, password: "x".repeat(64) });
  return parsed.success ? null : firstError(parsed.error);
}

/**
 * Si el correo no existe, lo crea con esa contraseña (como «Crear usuario»
 * de /admin). Si existe, NO lo duplica ni toca su contraseña: solo cambia el
 * nombre, los roles y los restaurantes (como «Guardar» de /admin).
 */
export async function upsertUser(
  input: UpsertInput & { password?: string },
): Promise<{ action: "creado" | "actualizado"; userId: string }> {
  const current = await existingUser(input.email);
  if (!current) {
    const parsed = createUserSchema.safeParse({ ...input, password: input.password ?? "" });
    if (!parsed.success) throw new UserInputError(firstError(parsed.error));
    const userId = await createUserWithPassword(parsed.data);
    return { action: "creado", userId };
  }

  const parsed = updateAccessSchema.safeParse({ userId: current.id, roles: input.roles, restaurantIds: input.restaurantIds });
  if (!parsed.success) throw new UserInputError(firstError(parsed.error));
  const name = input.name.trim();
  if (!name || name.length > 100) throw new UserInputError("Escribe el nombre.");
  await setUserAccess(current.id, parsed.data.roles, parsed.data.restaurantIds);
  await db.update(user).set({ name, updatedAt: new Date() }).where(eq(user.id, current.id));
  return { action: "actualizado", userId: current.id };
}

