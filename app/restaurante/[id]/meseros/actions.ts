"use server";

// Server actions de las zonas de meseros.
//
// Capa fina, como las del editor: Zod → permiso → `lib/waiters` → aviso por
// el socket y revalidar. Crear, guardar, borrar y ACTIVAR piden
// `meseros:gestionar` (admin, y el rol restaurante en los suyos); leer pide
// solo `plano:ver`, así que analítica las ve pero no las cambia.
//
// El aviso `waiters:changed` llega a todas las tablets del restaurante (su
// room). Analítica no está en la room: su plano se entera por la sala
// overview (`emitOverview`) y el respaldo de 30 s.

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { guardAction } from "@/lib/auth/session";
import { emitOverview } from "@/lib/realtime/overview";
import { emitToRestaurant } from "@/lib/realtime/registry";
import {
  type WaiterConfig,
  type WaiterResult,
  activateWaiterConfig,
  createWaiterConfig,
  deleteWaiterConfig,
  listWaiterConfigs,
  saveWaiterConfig,
} from "@/lib/waiters/configs";
import { createWaiterConfigSchema, saveWaiterConfigSchema, waiterConfigRefSchema } from "@/lib/waiters/validation";

const INVALID = "Los datos de la configuración de meseros no son válidos.";

async function announce(restaurantId: string) {
  const configs = await listWaiterConfigs(restaurantId);
  emitToRestaurant(restaurantId, "waiters:changed", { activeConfigId: configs.find((c) => c.isActive)?.id ?? null });
  void emitOverview(restaurantId);
  revalidatePath(`/restaurante/${restaurantId}/mapa`);
  revalidatePath(`/restaurante/${restaurantId}/editor`);
  return configs;
}

export type WaiterConfigsResult = WaiterResult<{ configs: WaiterConfig[] }>;

/** Las configuraciones de un restaurante. Basta con poder ver su plano. */
export async function loadWaiterConfigs(raw: unknown): Promise<WaiterConfigsResult> {
  const parsed = z.object({ restaurantId: z.string().min(1).max(64) }).safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Restaurante no válido." };
  const guard = await guardAction("plano:ver", parsed.data.restaurantId);
  if (!guard.ok) return guard;
  return { ok: true, configs: await listWaiterConfigs(parsed.data.restaurantId) };
}

export async function createWaiterConfigAction(raw: unknown): Promise<WaiterResult<{ configs: WaiterConfig[]; configId: string }>> {
  const parsed = createWaiterConfigSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: INVALID };
  const guard = await guardAction("meseros:gestionar", parsed.data.restaurantId);
  if (!guard.ok) return guard;
  const result = await createWaiterConfig(parsed.data);
  if (!result.ok) return result;
  return { ok: true, configId: result.config.id, configs: await announce(parsed.data.restaurantId) };
}

export async function saveWaiterConfigAction(raw: unknown): Promise<WaiterConfigsResult> {
  const parsed = saveWaiterConfigSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: INVALID };
  const guard = await guardAction("meseros:gestionar", parsed.data.restaurantId);
  if (!guard.ok) return guard;
  const result = await saveWaiterConfig(parsed.data);
  if (!result.ok) return result;
  return { ok: true, configs: await announce(parsed.data.restaurantId) };
}

/** El «un toque»: pasa a activa otra configuración. */
export async function activateWaiterConfigAction(raw: unknown): Promise<WaiterConfigsResult> {
  const parsed = waiterConfigRefSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: INVALID };
  const guard = await guardAction("meseros:gestionar", parsed.data.restaurantId);
  if (!guard.ok) return guard;
  const result = await activateWaiterConfig(parsed.data);
  if (!result.ok) return result;
  return { ok: true, configs: await announce(parsed.data.restaurantId) };
}

export async function deleteWaiterConfigAction(raw: unknown): Promise<WaiterConfigsResult> {
  const parsed = waiterConfigRefSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: INVALID };
  const guard = await guardAction("meseros:gestionar", parsed.data.restaurantId);
  if (!guard.ok) return guard;
  const result = await deleteWaiterConfig(parsed.data);
  if (!result.ok) return result;
  return { ok: true, configs: await announce(parsed.data.restaurantId) };
}
