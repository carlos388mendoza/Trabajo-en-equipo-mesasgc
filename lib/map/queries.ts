// Lecturas del mapa general y del plano en vivo.
//
// No importa nada de Next: lo usan las páginas /mapa y
// /restaurante/[id]/mapa y sus server actions, que antes comprueban el
// permiso. Aquí solo se decide QUÉ datos salen, según `withNames`.

import { asc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { getElementTypes, getLayout, getLayoutsForRestaurant } from "@/lib/db/queries/layouts";
import { brands, restaurants } from "@/lib/db/schema";
import type { ElementTypeInfo, LayoutPayload } from "@/lib/layout/types";
import { restaurantPosition } from "@/lib/map/projection";
import { type WaiterConfig, listWaiterConfigs } from "@/lib/waiters/configs";

export type BrandInfo = { id: string; name: string; accentColor: string };

export type MapRestaurant = {
  id: string;
  name: string;
  city: string | null;
  /**
   * Posición en unidades del mapa (`lib/map/projection.ts`), ya calculada:
   * sale de la latitud y la longitud si las hay, y si no de `map_x`/`map_y`.
   * null = sin posición: sale en la lista, no en el mapa.
   */
  mapX: number | null;
  mapY: number | null;
  latitude: number | null;
  longitude: number | null;
  brand: BrandInfo | null;
};

export async function listBrands(): Promise<BrandInfo[]> {
  return db
    .select({ id: brands.id, name: brands.name, accentColor: brands.accentColor })
    .from(brands)
    .orderBy(asc(brands.name));
}

/**
 * Los restaurantes ACTIVOS con su marca. Uno desactivado no sale en el mapa
 * (no se opera), aunque su historial siga en las estadísticas. El filtro por
 * permiso lo hace quien llama.
 */
export async function getMapRestaurants(): Promise<MapRestaurant[]> {
  const rows = await db
    .select({
      id: restaurants.id,
      name: restaurants.name,
      city: restaurants.city,
      mapX: restaurants.mapX,
      mapY: restaurants.mapY,
      latitude: restaurants.latitude,
      longitude: restaurants.longitude,
      brandId: brands.id,
      brandName: brands.name,
      brandColor: brands.accentColor,
    })
    .from(restaurants)
    .leftJoin(brands, eq(brands.id, restaurants.brandId))
    .where(eq(restaurants.active, true))
    .orderBy(asc(restaurants.name));

  return rows.map((r) => {
    const position = restaurantPosition(r);
    return {
      id: r.id,
      name: r.name,
      city: r.city,
      mapX: position ? Math.round(position.x * 10) / 10 : null,
      mapY: position ? Math.round(position.y * 10) / 10 : null,
      latitude: r.latitude,
      longitude: r.longitude,
      brand:
        r.brandId && r.brandName && r.brandColor
          ? { id: r.brandId, name: r.brandName, accentColor: r.brandColor }
          : null,
    };
  });
}

export async function getMapRestaurant(restaurantId: string): Promise<MapRestaurant | null> {
  return (await getMapRestaurants()).find((r) => r.id === restaurantId) ?? null;
}

/**
 * Id que sustituye al del cliente cuando el plano va sin nombres. El lienzo
 * pinta una mesa como ocupada si `currentEntryId` no es null; con este valor
 * sigue sabiendo que está ocupada, pero no quién la ocupa.
 */
export const HIDDEN_ENTRY_ID = "oculto";

export type LivePlan = {
  restaurant: MapRestaurant;
  /** false para analitica: sin nombres ni ids de clientes (`plano:clientes`). */
  showNames: boolean;
  types: ElementTypeInfo[];
  zones: LayoutPayload[];
  /** Zona del plano por defecto del restaurante: la que se abre al entrar. */
  defaultZoneId: string | null;
  /**
   * Zonas de meseros del restaurante (la activa marcada). Nombres de meseros
   * y colores: no son datos de clientes, así que salen también para analítica.
   */
  waiterConfigs: WaiterConfig[];
};

/**
 * El plano en vivo de un restaurante: todas sus zonas con sus mesas.
 *
 * Sin `withNames`, los datos del cliente NO salen del servidor: ocultarlos en
 * el navegador no protegería nada, porque se verían en la respuesta.
 */
export async function getLivePlan(restaurantId: string, withNames: boolean): Promise<LivePlan | null> {
  const restaurant = await getMapRestaurant(restaurantId);
  if (!restaurant) return null;

  const [summaries, types, waiterConfigs] = await Promise.all([
    getLayoutsForRestaurant(restaurantId),
    getElementTypes(),
    listWaiterConfigs(restaurantId),
  ]);
  const loaded = await Promise.all(summaries.map((z) => getLayout(z.id, restaurantId)));
  const zones = loaded
    .filter((z): z is LayoutPayload => z !== null)
    .map((zone) =>
      withNames
        ? zone
        : {
            ...zone,
            elements: zone.elements.map((e) => ({
              ...e,
              currentEntryId: e.currentEntryId ? HIDDEN_ENTRY_ID : null,
              occupantName: null,
              seatedAt: null,
            })),
          },
    );

  const defaultZoneId = summaries.find((z) => z.isDefault)?.id ?? null;
  return { restaurant, showNames: withNames, types, zones, defaultZoneId, waiterConfigs };
}
