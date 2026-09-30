// Validación de lo que llega de /admin para marcas y restaurantes. Todo lo
// que llega a una action es no confiable: se valida aquí con Zod.

import { z } from "zod";

import { MAP_BOUNDS } from "@/lib/map/projection";

const idSchema = z.string().trim().min(1).max(80);

export const brandInputSchema = z.object({
  name: z.string().trim().min(1, "Escribe el nombre de la marca.").max(60, "El nombre es muy largo."),
  accentColor: z
    .string()
    .trim()
    .regex(/^#[0-9a-fA-F]{6}$/, "El color tiene que ser del tipo #rrggbb.")
    .transform((v) => v.toLowerCase()),
});

/**
 * La ubicación tiene que caer dentro del mapa de Honduras
 * (`MAP_BOUNDS` de `lib/map/projection.ts`): si no, el marcador saldría fuera.
 */
export const restaurantInputSchema = z.object({
  name: z.string().trim().min(1, "Escribe el nombre del restaurante.").max(100, "El nombre es muy largo."),
  brandId: idSchema,
  city: z.string().trim().min(1, "Escribe la ciudad.").max(60, "La ciudad es muy larga."),
  latitude: z.coerce
    .number({ message: "La latitud tiene que ser un número." })
    .min(MAP_BOUNDS.south, `La latitud tiene que estar entre ${MAP_BOUNDS.south} y ${MAP_BOUNDS.north} (Honduras).`)
    .max(MAP_BOUNDS.north, `La latitud tiene que estar entre ${MAP_BOUNDS.south} y ${MAP_BOUNDS.north} (Honduras).`),
  longitude: z.coerce
    .number({ message: "La longitud tiene que ser un número." })
    .min(MAP_BOUNDS.west, `La longitud tiene que estar entre ${MAP_BOUNDS.west} y ${MAP_BOUNDS.east} (Honduras).`)
    .max(MAP_BOUNDS.east, `La longitud tiene que estar entre ${MAP_BOUNDS.west} y ${MAP_BOUNDS.east} (Honduras).`),
});

export const updateBrandSchema = brandInputSchema.extend({ id: idSchema });
export const updateRestaurantSchema = restaurantInputSchema.extend({ id: idSchema });
export const setCatalogActiveSchema = z.object({ id: idSchema, active: z.boolean() });
