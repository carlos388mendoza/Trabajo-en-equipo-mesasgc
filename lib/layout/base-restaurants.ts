// Marcas y restaurantes reales de Grupo Comidas, y una zona vacía por
// restaurante.
//
// Los usa `npm run db:restaurantes` (seguro para producción) y el seed de
// desarrollo. Hace falta porque la app todavía no tiene pantalla para crear
// restaurantes, marcas ni zonas: sin estas filas el admin no puede asignar
// hosts ni el editor tiene dónde dibujar.
//
// `ensureBaseRestaurants` solo AÑADE lo que falta: no borra, no actualiza y
// nunca crea mesas, clientes ni usuarios. Si un restaurante ya tiene alguna
// zona (porque alguien ya dibujó su plano), no le crea otra.

import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { brands, restaurants, tableLayouts } from "@/lib/db/schema";

/** Colores de acento: se evitan el amarillo y el rojo puros de la alerta del mapa. */
export const BASE_BRANDS = [
  { id: "brand_china_wok", name: "China Wok", accentColor: "#f97316" },
  { id: "brand_pizza_hut", name: "Pizza Hut", accentColor: "#ef4444" },
  { id: "brand_kfc", name: "KFC", accentColor: "#ec4899" },
  { id: "brand_dennys", name: "Denny's", accentColor: "#a3e635" },
] as const;

const TGU = "Tegucigalpa";
const SPS = "San Pedro Sula";

/**
 * `mapX`/`mapY` van de 0 a 1000 y caen dentro de los distritos que dibuja
 * `lib/map/world.ts`: San Pedro Sula arriba a la izquierda y Tegucigalpa
 * abajo a la derecha, más o menos como están en el país.
 *
 * `rest_centro` y `rest_norte` conservan los ids de los primeros
 * restaurantes de ejemplo, para que los usuarios de prueba sigan valiendo.
 */
export const BASE_RESTAURANTS = [
  { id: "rest_centro", name: "China Wok Centro", slug: "china-wok-centro", brandId: "brand_china_wok", city: TGU, mapX: 660, mapY: 610 },
  { id: "rest_norte", name: "Pizza Hut Norte", slug: "pizza-hut-norte", brandId: "brand_pizza_hut", city: SPS, mapX: 250, mapY: 190 },
  { id: "rest_tgu_pizza", name: "Pizza Hut Los Próceres", slug: "pizza-hut-los-proceres", brandId: "brand_pizza_hut", city: TGU, mapX: 830, mapY: 590 },
  { id: "rest_tgu_kfc", name: "KFC Boulevard Morazán", slug: "kfc-boulevard-morazan", brandId: "brand_kfc", city: TGU, mapX: 780, mapY: 740 },
  { id: "rest_tgu_dennys", name: "Denny's Las Lomas", slug: "dennys-las-lomas", brandId: "brand_dennys", city: TGU, mapX: 620, mapY: 830 },
  { id: "rest_sps_chinawok", name: "China Wok Circunvalación", slug: "china-wok-circunvalacion", brandId: "brand_china_wok", city: SPS, mapX: 380, mapY: 300 },
  { id: "rest_sps_kfc", name: "KFC Río Piedras", slug: "kfc-rio-piedras", brandId: "brand_kfc", city: SPS, mapX: 170, mapY: 360 },
  { id: "rest_sps_dennys", name: "Denny's Los Andes", slug: "dennys-los-andes", brandId: "brand_dennys", city: SPS, mapX: 330, mapY: 460 },
] as const;

export type BaseRestaurantsResult = {
  brandsCreated: number;
  restaurantsCreated: number;
  zonesCreated: number;
};

export async function ensureBaseRestaurants(): Promise<BaseRestaurantsResult> {
  const result: BaseRestaurantsResult = { brandsCreated: 0, restaurantsCreated: 0, zonesCreated: 0 };

  for (const brand of BASE_BRANDS) {
    const inserted = await db.insert(brands).values(brand).onConflictDoNothing().returning({ id: brands.id });
    result.brandsCreated += inserted.length;
  }

  for (const restaurant of BASE_RESTAURANTS) {
    // Sin `target`: cualquier choque (el id o el slug, que es único) deja la
    // fila que ya estaba tal cual.
    const inserted = await db
      .insert(restaurants)
      .values(restaurant)
      .onConflictDoNothing()
      .returning({ id: restaurants.id });
    result.restaurantsCreated += inserted.length;

    // La zona solo se crea si el restaurante existe con este id (no si otro
    // restaurante ocupa su slug) y todavía no tiene ninguna.
    const [owner] = await db.select({ id: restaurants.id }).from(restaurants).where(eq(restaurants.id, restaurant.id));
    if (!owner) continue;
    const [{ zones }] = await db
      .select({ zones: sql<number>`count(*)` })
      .from(tableLayouts)
      .where(eq(tableLayouts.restaurantId, restaurant.id));
    if (Number(zones) > 0) continue;
    const zone = await db
      .insert(tableLayouts)
      .values({
        id: `zona_${restaurant.id}`,
        restaurantId: restaurant.id,
        name: "Comedor principal",
        description: "Zona inicial vacía: dibuja aquí el plano del local.",
        width: 1200,
        height: 800,
        sortOrder: 0,
        isDefault: true,
      })
      .onConflictDoNothing()
      .returning({ id: tableLayouts.id });
    result.zonesCreated += zone.length;
  }

  return result;
}
