"use server";

// Server actions del mapa general y del plano en vivo.
//
// Capa fina, como las del editor: Zod → permiso → `lib/map`. Las llaman el
// respaldo de 30 s del mapa y el plano en vivo al recibir un aviso por el
// socket (el aviso dice que algo cambió, no el qué).

import { z } from "zod";

import { can } from "@/lib/auth/rbac";
import { guardAction } from "@/lib/auth/session";
import { getCounters } from "@/lib/map/counters";
import { type LivePlan, getLivePlan } from "@/lib/map/queries";
import type { RestaurantCounters } from "@/lib/realtime/events";

export type OverviewResult = { ok: true; counters: RestaurantCounters[] } | { ok: false; error: string };

/** Contadores de todos los restaurantes. Exige `mapa:ver`. */
export async function loadOverviewCounters(): Promise<OverviewResult> {
  const guard = await guardAction("mapa:ver");
  if (!guard.ok) return guard;
  return { ok: true, counters: await getCounters() };
}

const planInputSchema = z.object({ restaurantId: z.string().min(1).max(64) });

export type LivePlanResult = { ok: true; plan: LivePlan } | { ok: false; error: string };

/**
 * Plano en vivo de un restaurante. Exige `plano:ver` en ESE restaurante; los
 * nombres de los clientes solo salen con `plano:clientes`.
 */
export async function loadLivePlan(raw: unknown): Promise<LivePlanResult> {
  const parsed = planInputSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Restaurante no válido." };
  const { restaurantId } = parsed.data;

  const guard = await guardAction("plano:ver", restaurantId);
  if (!guard.ok) return guard;

  const plan = await getLivePlan(restaurantId, can(guard.user, "plano:clientes", restaurantId));
  if (!plan) return { ok: false, error: "Ese restaurante no existe." };
  return { ok: true, plan };
}
