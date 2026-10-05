// Validación de lo que llega a las server actions de zonas de meseros.
//
// Como en el editor: nada se da por bueno. Que la configuración, las zonas y
// las mesas sean de este restaurante lo comprueba `lib/waiters/configs.ts`
// contra la base de datos; aquí solo la forma y los topes.

import { z } from "zod";

import { MAX_WAITERS } from "./balance";

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
        waiterName: z.string().trim().min(1).max(30),
        // Solo #rrggbb: el color se pinta en el lienzo y en estilos en línea.
        color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
      }),
    )
    .min(1)
    .max(MAX_WAITERS),
  assignments: z.array(z.object({ tableId: idSchema, zoneId: idSchema })).max(2_000),
});
