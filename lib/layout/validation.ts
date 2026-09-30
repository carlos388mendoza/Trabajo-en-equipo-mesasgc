// Validación de lo que el editor envía al servidor.
//
// El canvas es código del cliente: cualquiera puede llamar a la server action
// a mano con un `fetch`. Por eso NADA de lo que llega se da por bueno, ni
// siquiera que los ids pertenezcan a la zona (eso se comprueba en la action,
// contra la base de datos).

import { z } from "zod";

import { LAYOUT_ROTATIONS, type LayoutRotation } from "@/lib/db/enums";

/** Un id de la app es un UUID generado con crypto.randomUUID(). */
const idSchema = z.string().min(1).max(64);

export const layoutElementInputSchema = z.object({
  id: idSchema,
  elementTypeId: idSchema,
  label: z.string().min(1).max(60),
  // Tope generoso: el lienzo es de miles de unidades y las coordenadas se
  // multiplican por el zoom, así que un número grande de por sí no es un
  // ataque. Lo que no tiene sentido es NaN, Infinity o un millón de mesas.
  x: z.number().finite().min(-100_000).max(100_000),
  y: z.number().finite().min(-100_000).max(100_000),
  width: z.number().finite().min(10).max(10_000),
  height: z.number().finite().min(10).max(10_000),
  /** Grados, como en Konva. */
  rotation: z.number().finite().min(-360).max(360),
  capacity: z.number().int().min(1).max(100).nullable(),
});

export const saveLayoutInputSchema = z.object({
  layoutId: idSchema,
  restaurantId: idSchema,
  width: z.number().finite().min(200).max(20_000),
  height: z.number().finite().min(200).max(20_000),
  /**
   * Giro del plano completo. Opcional para no romper a quien guarde sin él:
   * si no viene, se conserva el que ya tenía la zona.
   */
  rotation: z
    .number()
    .int()
    .refine((v): v is LayoutRotation => (LAYOUT_ROTATIONS as readonly number[]).includes(v), {
      message: "El giro del plano tiene que ser 0, 90, 180 o 270.",
    })
    .optional(),
  elements: z.array(layoutElementInputSchema).max(500),
});

// ---------------------------------------------------------------------------
// Copia de estructura entre restaurantes (paso 3)
// ---------------------------------------------------------------------------

export const copyLayoutInputSchema = z.object({
  sourceRestaurantId: idSchema,
  targetRestaurantId: idSchema,
  /** Sin esto solo se puede copiar a un destino que esté vacío. */
  replace: z.boolean(),
});

export const copyZoneInputSchema = z.object({
  sourceRestaurantId: idSchema,
  sourceLayoutId: idSchema,
  targetLayoutId: idSchema,
});

export type SaveLayoutInput = z.infer<typeof saveLayoutInputSchema>;
export type CopyLayoutInput = z.infer<typeof copyLayoutInputSchema>;
export type CopyZoneInput = z.infer<typeof copyZoneInputSchema>;
