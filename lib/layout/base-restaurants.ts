// Marcas y restaurantes reales de Grupo Comidas, y una zona vacía por
// restaurante.
//
// Los usa `npm run db:restaurantes` (seguro para producción) y el seed de
// desarrollo. Hace falta porque la app todavía no tiene pantalla para crear
// restaurantes, marcas ni zonas: sin estas filas el admin no puede asignar
// hosts ni el editor tiene dónde dibujar.
//
// `ensureBaseRestaurants` solo AÑADE lo que falta: no borra, no actualiza (salvo
// ponerle la ubicación real a un restaurante que no tenga ninguna) y
// nunca crea mesas, clientes ni usuarios. Si un restaurante ya tiene alguna
// zona (porque alguien ya dibujó su plano), no le crea otra.

import { and, eq, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { brands, restaurants, tableLayouts } from "@/lib/db/schema";
import { project } from "@/lib/map/projection";

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
 * Ubicación real de cada restaurante en su ciudad (grados decimales, WGS 84).
 * Son las de su barrio o su bulevar, con una precisión de unos cientos de
 * metros: bastan para el mapa general, que se acerca como mucho a una ciudad.
 * `mapX`/`mapY` se calculan de ahí con la proyección del mapa.
 *
 * `rest_centro` y `rest_norte` conservan los ids de los primeros
 * restaurantes de ejemplo, para que los usuarios de prueba sigan valiendo.
 */
const LOCATED = [
  { id: "rest_centro", name: "China Wok Centro", slug: "china-wok-centro", brandId: "brand_china_wok", city: TGU, latitude: 14.1049, longitude: -87.2063 },
  { id: "rest_norte", name: "Pizza Hut Norte", slug: "pizza-hut-norte", brandId: "brand_pizza_hut", city: SPS, latitude: 15.532, longitude: -88.02 },
  { id: "rest_tgu_pizza", name: "Pizza Hut Los Próceres", slug: "pizza-hut-los-proceres", brandId: "brand_pizza_hut", city: TGU, latitude: 14.0925, longitude: -87.18 },
  { id: "rest_tgu_kfc", name: "KFC Boulevard Morazán", slug: "kfc-boulevard-morazan", brandId: "brand_kfc", city: TGU, latitude: 14.096, longitude: -87.1905 },
  { id: "rest_tgu_dennys", name: "Denny's Las Lomas", slug: "dennys-las-lomas", brandId: "brand_dennys", city: TGU, latitude: 14.0845, longitude: -87.1745 },
  { id: "rest_sps_chinawok", name: "China Wok Circunvalación", slug: "china-wok-circunvalacion", brandId: "brand_china_wok", city: SPS, latitude: 15.505, longitude: -88.036 },
  { id: "rest_sps_kfc", name: "KFC Río Piedras", slug: "kfc-rio-piedras", brandId: "brand_kfc", city: SPS, latitude: 15.501, longitude: -88.018 },
  { id: "rest_sps_dennys", name: "Denny's Los Andes", slug: "dennys-los-andes", brandId: "brand_dennys", city: SPS, latitude: 15.513, longitude: -88.011 },
] as const;

export const BASE_RESTAURANTS = LOCATED.map((r) => {
  const { x, y } = project({ lat: r.latitude, lng: r.longitude });
  return { ...r, mapX: Math.round(x), mapY: Math.round(y) };
});

export type BaseRestaurantsResult = {
  brandsCreated: number;
  restaurantsCreated: number;
  /** Restaurantes que ya existían sin ubicación real y se la ganaron. */
  locationsFilled: number;
  zonesCreated: number;
};

export async function ensureBaseRestaurants(): Promise<BaseRestaurantsResult> {
  const result: BaseRestaurantsResult = { brandsCreated: 0, restaurantsCreated: 0, locationsFilled: 0, zonesCreated: 0 };

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

    // Única escritura sobre una fila que ya existía: si le falta la ubicación
    // real (se creó antes de la migración 0004), se le pone. Si ya tiene una,
    // aunque sea otra, no se toca. `map_x`/`map_y` tampoco: con latitud y
    // longitud el mapa ya no las usa.
    const filled = await db
      .update(restaurants)
      .set({ latitude: restaurant.latitude, longitude: restaurant.longitude })
      .where(and(eq(restaurants.id, restaurant.id), isNull(restaurants.latitude), isNull(restaurants.longitude)))
      .returning({ id: restaurants.id });
    if (inserted.length === 0) result.locationsFilled += filled.length;

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
