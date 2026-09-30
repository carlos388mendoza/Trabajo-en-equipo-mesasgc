// Marcas y restaurantes desde /admin: crear, editar y desactivar.
//
// Sin nada de Next: lo usan las actions de `app/admin/catalog-actions.ts` y
// `verify:editor`. Las actions validan con Zod (`lib/layout/catalog-input.ts`)
// y comprueban el permiso; aquí van las reglas de integridad.
//
// Nada se borra. Desactivar una marca o un restaurante lo saca de la
// operación (accesos, mapa, contadores), pero su historial sigue en las
// estadísticas. Un restaurante nuevo nace con una zona vacía, lista para
// dibujar el plano en el editor.

import { and, asc, count, eq, ne } from "drizzle-orm";

import { db } from "@/lib/db";
import { brands, restaurants, tableLayouts } from "@/lib/db/schema";
import { project } from "@/lib/map/projection";

export class CatalogInputError extends Error {}

export type AdminBrand = { id: string; name: string; accentColor: string; active: boolean; restaurants: number };

export type AdminRestaurant = {
  id: string;
  name: string;
  slug: string;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  active: boolean;
  brandId: string | null;
  zones: number;
};

export type BrandInput = { name: string; accentColor: string };

export type RestaurantInput = {
  name: string;
  brandId: string;
  city: string;
  latitude: number;
  longitude: number;
};

/** «Pizza Hut Los Próceres» → «pizza-hut-los-proceres». */
export function slugify(text: string): string {
  return (
    text
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60) || "sin-nombre"
  );
}

/** El primer `base`, `base-2`, `base-3`… que no esté ocupado. */
async function freeValue(base: string, taken: (value: string) => Promise<boolean>): Promise<string> {
  for (let n = 1; n < 1000; n++) {
    const candidate = n === 1 ? base : `${base}-${n}`;
    if (!(await taken(candidate))) return candidate;
  }
  throw new CatalogInputError("No se pudo generar un identificador libre.");
}

export async function listAdminBrands(): Promise<AdminBrand[]> {
  const [rows, counts] = await Promise.all([
    db.select().from(brands).orderBy(asc(brands.name)),
    db.select({ brandId: restaurants.brandId, n: count() }).from(restaurants).groupBy(restaurants.brandId),
  ]);
  return rows.map((b) => ({
    id: b.id,
    name: b.name,
    accentColor: b.accentColor,
    active: b.active,
    restaurants: Number(counts.find((c) => c.brandId === b.id)?.n ?? 0),
  }));
}

export async function listAdminRestaurants(): Promise<AdminRestaurant[]> {
  const [rows, zones] = await Promise.all([
    db
      .select({
        id: restaurants.id,
        name: restaurants.name,
        slug: restaurants.slug,
        city: restaurants.city,
        latitude: restaurants.latitude,
        longitude: restaurants.longitude,
        active: restaurants.active,
        brandId: restaurants.brandId,
      })
      .from(restaurants)
      .orderBy(asc(restaurants.name)),
    db.select({ restaurantId: tableLayouts.restaurantId, n: count() }).from(tableLayouts).groupBy(tableLayouts.restaurantId),
  ]);
  return rows.map((r) => ({ ...r, zones: Number(zones.find((z) => z.restaurantId === r.id)?.n ?? 0) }));
}

async function assertBrandNameFree(name: string, exceptId?: string): Promise<void> {
  const [clash] = await db
    .select({ id: brands.id })
    .from(brands)
    .where(exceptId ? and(eq(brands.name, name), ne(brands.id, exceptId)) : eq(brands.name, name))
    .limit(1);
  if (clash) throw new CatalogInputError(`Ya hay una marca llamada «${name}».`);
}

export async function createBrand(input: BrandInput): Promise<string> {
  await assertBrandNameFree(input.name);
  const id = await freeValue(`brand_${slugify(input.name).replace(/-/g, "_")}`, async (v) =>
    Boolean((await db.select({ id: brands.id }).from(brands).where(eq(brands.id, v)).limit(1))[0]),
  );
  await db.insert(brands).values({ id, name: input.name, accentColor: input.accentColor });
  return id;
}

export async function updateBrand(id: string, input: BrandInput): Promise<void> {
  await assertBrandNameFree(input.name, id);
  const updated = await db
    .update(brands)
    .set({ name: input.name, accentColor: input.accentColor, updatedAt: new Date() })
    .where(eq(brands.id, id))
    .returning({ id: brands.id });
  if (updated.length === 0) throw new CatalogInputError("Esa marca no existe.");
}

/** Desactivar una marca no toca sus restaurantes: solo deja de ofrecerse para los nuevos. */
export async function setBrandActive(id: string, active: boolean): Promise<void> {
  const updated = await db
    .update(brands)
    .set({ active, updatedAt: new Date() })
    .where(eq(brands.id, id))
    .returning({ id: brands.id });
  if (updated.length === 0) throw new CatalogInputError("Esa marca no existe.");
}

async function assertActiveBrand(brandId: string, currentBrandId?: string | null): Promise<void> {
  const [brand] = await db.select({ active: brands.active }).from(brands).where(eq(brands.id, brandId)).limit(1);
  if (!brand) throw new CatalogInputError("Esa marca no existe.");
  // Se puede conservar la marca que ya tenía aunque esté desactivada, pero no
  // elegir una desactivada nueva.
  if (!brand.active && brandId !== currentBrandId) throw new CatalogInputError("Esa marca está desactivada.");
}

function location(input: RestaurantInput) {
  const { x, y } = project({ lat: input.latitude, lng: input.longitude });
  return { latitude: input.latitude, longitude: input.longitude, mapX: Math.round(x), mapY: Math.round(y) };
}

/** Crea el restaurante y su zona vacía, juntos o ninguno. Devuelve el id. */
export async function createRestaurant(input: RestaurantInput): Promise<string> {
  await assertActiveBrand(input.brandId);
  const slug = await freeValue(slugify(input.name), async (v) =>
    Boolean((await db.select({ id: restaurants.id }).from(restaurants).where(eq(restaurants.slug, v)).limit(1))[0]),
  );
  const id = await freeValue(`rest_${slug.replace(/-/g, "_")}`, async (v) =>
    Boolean((await db.select({ id: restaurants.id }).from(restaurants).where(eq(restaurants.id, v)).limit(1))[0]),
  );
  await db.transaction(async (tx) => {
    await tx.insert(restaurants).values({ id, slug, name: input.name, brandId: input.brandId, city: input.city, ...location(input) });
    await tx.insert(tableLayouts).values({
      id: `zona_${id}`,
      restaurantId: id,
      name: "Comedor principal",
      description: "Zona inicial vacía: dibuja aquí el plano del local.",
      width: 1200,
      height: 800,
      sortOrder: 0,
      isDefault: true,
    });
  });
  return id;
}

/** Edita nombre, marca, ciudad y ubicación. El id y el slug no cambian: pueden estar en URLs guardadas. */
export async function updateRestaurant(id: string, input: RestaurantInput): Promise<void> {
  const [current] = await db.select({ brandId: restaurants.brandId }).from(restaurants).where(eq(restaurants.id, id)).limit(1);
  if (!current) throw new CatalogInputError("Ese restaurante no existe.");
  await assertActiveBrand(input.brandId, current.brandId);
  await db
    .update(restaurants)
    .set({ name: input.name, brandId: input.brandId, city: input.city, ...location(input), updatedAt: new Date() })
    .where(eq(restaurants.id, id));
}

/**
 * Activa o desactiva. No borra nada: ni el plano, ni la lista de espera, ni
 * las asignaciones de usuarios (al reactivarlo, sus hosts recuperan el
 * acceso).
 */
export async function setRestaurantActive(id: string, active: boolean): Promise<void> {
  const updated = await db
    .update(restaurants)
    .set({ active, updatedAt: new Date() })
    .where(eq(restaurants.id, id))
    .returning({ id: restaurants.id });
  if (updated.length === 0) throw new CatalogInputError("Ese restaurante no existe.");
}
