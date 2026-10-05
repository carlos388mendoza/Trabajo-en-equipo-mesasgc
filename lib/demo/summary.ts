// Cuánto hay de demostración en cada restaurante, para la sección «Datos de
// demostración» de /admin y para que la confirmación diga EXACTAMENTE qué se
// va a borrar.
//
//  - clientes: los de la fila de hoy (esperando o listos) y los que ocupan una
//    mesa ahora mismo;
//  - historial: el resto (sentados que ya se fueron y ausentes), que es lo que
//    alimenta las estadísticas;
//  - mesas y zonas: las de los planos de demostración;
//  - meseros: las configuraciones de zonas de meseros de ejemplo.
//
// Solo cuenta filas con `is_demo`. Sin nada de Next: lo usan la página, la
// server action y `verify:demo`.

import { eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { brands, restaurants, tableLayouts, tables, waiterConfigs, waitlistEntries } from "@/lib/db/schema";

export type DemoCounts = { clientes: number; historial: number; mesas: number; zonas: number; meseros: number };
export type DemoRestaurantRow = DemoCounts & { restaurantId: string; name: string; brand: string | null; total: number };
export type DemoBreakdown = { restaurantes: DemoRestaurantRow[]; totales: DemoCounts & { total: number } };

const ZERO: DemoCounts = { clientes: 0, historial: 0, mesas: 0, zonas: 0, meseros: 0 };

export async function demoBreakdown(): Promise<DemoBreakdown> {
  // «Activo» = esperando, listo, o sentado en una mesa que todavía lo tiene.
  const active = sql<number>`sum(case when ${waitlistEntries.status} in ('esperando', 'listo') or exists (select 1 from ${tables} where ${tables.currentEntryId} = ${waitlistEntries.id}) then 1 else 0 end)`;
  const [entryRows, tableRows, layoutRows, waiterRows, restaurantRows] = await Promise.all([
    db.select({ restaurantId: waitlistEntries.restaurantId, total: sql<number>`count(*)`, activos: active })
      .from(waitlistEntries).where(eq(waitlistEntries.isDemo, true)).groupBy(waitlistEntries.restaurantId),
    db.select({ restaurantId: tables.restaurantId, total: sql<number>`count(*)` })
      .from(tables).where(eq(tables.isDemo, true)).groupBy(tables.restaurantId),
    db.select({ restaurantId: tableLayouts.restaurantId, total: sql<number>`count(*)` })
      .from(tableLayouts).where(eq(tableLayouts.isDemo, true)).groupBy(tableLayouts.restaurantId),
    db.select({ restaurantId: waiterConfigs.restaurantId, total: sql<number>`count(*)` })
      .from(waiterConfigs).where(eq(waiterConfigs.isDemo, true)).groupBy(waiterConfigs.restaurantId),
    db.select({ id: restaurants.id, name: restaurants.name, brand: brands.name })
      .from(restaurants).leftJoin(brands, eq(brands.id, restaurants.brandId)),
  ]);

  const counts = new Map<string, DemoCounts>();
  const at = (id: string) => {
    if (!counts.has(id)) counts.set(id, { ...ZERO });
    return counts.get(id)!;
  };
  for (const row of entryRows) {
    const c = at(row.restaurantId);
    c.clientes = Number(row.activos ?? 0);
    c.historial = Number(row.total) - c.clientes;
  }
  for (const row of tableRows) at(row.restaurantId).mesas = Number(row.total);
  for (const row of layoutRows) at(row.restaurantId).zonas = Number(row.total);
  for (const row of waiterRows) at(row.restaurantId).meseros = Number(row.total);

  const names = new Map(restaurantRows.map((r) => [r.id, r]));
  const restaurantes = [...counts.entries()]
    .map(([restaurantId, c]) => ({
      restaurantId,
      name: names.get(restaurantId)?.name ?? restaurantId,
      brand: names.get(restaurantId)?.brand ?? null,
      ...c,
      total: c.clientes + c.historial + c.mesas + c.zonas + c.meseros,
    }))
    .filter((row) => row.total > 0)
    .sort((a, b) => (a.brand ?? "").localeCompare(b.brand ?? "", "es") || a.name.localeCompare(b.name, "es"));

  const totales = restaurantes.reduce(
    (sum, r) => ({
      clientes: sum.clientes + r.clientes,
      historial: sum.historial + r.historial,
      mesas: sum.mesas + r.mesas,
      zonas: sum.zonas + r.zonas,
      meseros: sum.meseros + r.meseros,
    }),
    { ...ZERO },
  );
  return {
    restaurantes,
    totales: { ...totales, total: totales.clientes + totales.historial + totales.mesas + totales.zonas + totales.meseros },
  };
}
