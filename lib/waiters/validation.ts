// Validación de lo que llega a las server actions de zonas de meseros.
//
// Como en el editor: nada se da por bueno. Que la configuración, las zonas y
// las mesas sean de este restaurante lo comprueba `lib/waiters/configs.ts`
// contra la base de datos; aquí solo la forma y los topes.

import { z } from "zod";

import { MAX_WAITERS } from "./balance";
import { WAITER_HEXES } from "./palette";

const idSchema = z.string().min(1).max(64);

export const createWaiterConfigSchema = z.object({
  restaurantId: idSchema,
  waiterCount: z.number().int().min(1).max(MAX_WAITERS),
  name: z.string().trim().max(40).optional(),
});

export const waiterConfigRefSchema = z.object({
  restaurantId: idSchema,
  configId: idSchema,
});

export const saveWaiterConfigSchema = z.object({
  restaurantId: idSchema,
  configId: idSchema,
  version: z.number().int().min(1),
  name: z.string().trim().min(1).max(40),
  zones: z
    .array(
      z.object({
        id: idSchema,
        // Nombre interno (no se enseña): el mesero se reconoce por su color.
        waiterName: z.string().trim().min(1).max(30),
        // Solo colores de la paleta (`palette.ts`): muy distintos entre sí y
        // de los de estado de las mesas.
        color: z
          .string()
          .transform((c) => c.toLowerCase())
          .refine((c) => WAITER_HEXES.includes(c), "Ese color no es de la paleta de meseros."),
      }),
    )
    .min(1)
    .max(MAX_WAITERS)
    // Nunca dos meseros del mismo color en una configuración.
    .refine((zones) => new Set(zones.map((z) => z.color)).size === zones.length, "Dos meseros no pueden tener el mismo color."),
  assignments: z.array(z.object({ tableId: idSchema, zoneId: idSchema })).max(2_000),
});
