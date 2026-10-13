// Carga del lote de DATOS DE DEMOSTRACIÓN.
//
//   npm run db:demo
//
// Qué crea, en los 8 restaurantes reales de Grupo Comidas:
//
//  1. Clientes de la lista de espera AHORA: los que esperan, con sus minutos
//     de espera.
//  2. Configuraciones de meseros de ejemplo, si el restaurante no tiene.
//  3. Ocho semanas de historial (ver `lib/demo/history.ts`), para que
//     /analiticas y el asistente tengan algo que contar.
//
// Qué NO hace, nunca:
//
//  - No crea zonas ni mesas (hasta octubre de 2026 creaba un «Comedor
//    (demostración)» por restaurante; se quitaron), ni marcas, restaurantes,
//    el catálogo de tipos de elemento o usuarios. No hay contraseñas en este archivo ni en el lote.
//  - No toca la zona real de un restaurante, ni sus mesas, ni sus clientes.
//  - No cambia el estado de ninguna mesa real.
//
// Cómo se sabe qué es demo: cada fila que inserta lleva `is_demo = true` y
// `demo_batch_id` con el id del lote (`lib/demo/fixtures.ts`). No se fía de los
// nombres. `borrarDemoData()` (lib/demo/delete.ts) usa esas columnas, y por eso
// renombrar o duplicar cosas nunca confunde el borrado.
//
// Es idempotente: los ids son deterministas y todo el insert es
// `ON CONFLICT DO NOTHING`, así que correrla dos veces deja exactamente lo
// mismo que correrla una.

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { restaurants, tableLayouts, tables, waiterConfigs, waitlistEntries } from "@/lib/db/schema";
import { createWaiterConfig, waiterNameForTableSql } from "@/lib/waiters/configs";

import {
  DEMO_BATCH_ID,
  DEMO_FIRST_NAMES,
  DEMO_ID_PREFIX,
  DEMO_LAST_NAMES,
  DEMO_NOTE,
  DEMO_PHONE_PREFIX,
  DEMO_PLANS,
} from "./fixtures";
import { loadDemoHistory } from "./history";

export type DemoLoadResult = {
  batchId: string;
  /** Filas NUEVAS de este lote (no cuenta las que ya estaban). */
  zonas: number;
  mesas: number;
  esperando: number;
  sentados: number;
  reservadas: number;
  /** Configuraciones de meseros de ejemplo creadas en esta carga. */
  meseros: number;
  historial: number;
  /** Restaurantes del plan que no existen en la base. */
  omitidos: string[];
};

/** Telefono de mentira: mismo prefijo en todos, distinto final. */
function demoPhone(index: number): string {
  return `${DEMO_PHONE_PREFIX}${String(1000 + (index % 9000))}`;
}

/** Nombre de cliente del demo, del listado de nombres inventados. */
function demoName(index: number): string {
  const first = DEMO_FIRST_NAMES[index % DEMO_FIRST_NAMES.length];
  const last = DEMO_LAST_NAMES[index % DEMO_LAST_NAMES.length];
  const last2 = DEMO_LAST_NAMES[(index * 7 + 3) % DEMO_LAST_NAMES.length];
  return last === last2 ? `${first} ${last}` : `${first} ${last} ${last2}`;
}

/**
 * Carga (o recarga) el lote de demostración completo.
 *
 * No pide confirmación: eso es del script (`scripts/db-demo.mts`), que la pide
 * antes de llamar. Esta función es la que usan el script y las pruebas.
 */
export async function loadDemoData(
  options: { batchId?: string } = {},
): Promise<DemoLoadResult> {
  const batchId = options.batchId ?? DEMO_BATCH_ID;

  // Los restaurantes tienen que existir: el demo los usa, no los crea. Si
  // falta alguno (base sin `npm run db:restaurantes`) se avisa y se sigue con
  // los que sí están, en vez de inventar marcas o locales.
  const wantedIds = DEMO_PLANS.map((p) => p.restaurantId);
  const present = new Set(
    (await db.select({ id: restaurants.id }).from(restaurants).where(inArray(restaurants.id, wantedIds)))
      .map((r) => r.id),
  );
  const omitidos = wantedIds.filter((id) => !present.has(id));
  const plans = DEMO_PLANS.filter((p) => present.has(p.restaurantId));

  // Zonas, mesas, sentados y reservadas siempre en cero: ya no se crean.
  const zonas = 0;
  const mesas = 0;
  let esperando = 0;
  const sentados = 0;
  const reservadas = 0;
  let meseros = 0;

  for (const plan of plans) {
    // Ya no se crean zonas ni mesas de demostración (octubre de 2026: se
    // quitaron los «Comedor (demostración)»). El demo son clientes: los que
    // esperan ahora y el historial de ocho semanas. No se sienta ni se reserva
    // a nadie: eso ocuparía mesas REALES.

    // --- Clientes de ahora ----------------------------------------------
    const now = Date.now();
    const waiting = plan.waitingMinutes.map((minutes, i) => ({
      id: `${DEMO_ID_PREFIX}w_${plan.restaurantId}_${i + 1}`,
      restaurantId: plan.restaurantId,
      customerName: demoName(i + plan.waitingMinutes.length * 3),
      partySize: 2 + (i % 4),
      phone: demoPhone(i),
      notes: DEMO_NOTE,
      status: "esperando" as const,
      arrivedAt: new Date(now - minutes * 60_000),
    }));
    const nuevosClientes = waiting;
    if (nuevosClientes.length > 0) {
      const created = await db
        .insert(waitlistEntries)
        .values(
          nuevosClientes.map((entry) => ({
            ...entry,
            isDemo: true,
            demoBatchId: batchId,
          })),
        )
        .onConflictDoNothing({ target: waitlistEntries.id })
        .returning({ id: waitlistEntries.id });
      waiting.forEach((entry) => {
        if (created.some((c) => c.id === entry.id)) esperando += 1;
      });
    }

    // --- Zonas de meseros de ejemplo ---------------------------------------
    // «2 meseros» (activa) y «3 meseros», marcadas como demo. Solo si el
    // restaurante no tiene ninguna: nunca se mezclan con las que ya creó el
    // restaurante, y repetir la carga no las duplica.
    const [hasConfigs] = await db
      .select({ id: waiterConfigs.id })
      .from(waiterConfigs)
      .where(eq(waiterConfigs.restaurantId, plan.restaurantId))
      .limit(1);
    if (!hasConfigs) {
      for (const count of [2, 3]) {
        const created = await createWaiterConfig({ restaurantId: plan.restaurantId, waiterCount: count, demoBatchId: batchId });
        if (created.ok) meseros += 1;
      }
    }
  }

  // --- Historial de ocho semanas ------------------------------------------
  const historial = await loadDemoHistory(batchId);
  if (omitidos.length > 0) omitidos.push(...historial.skipped);

  // El historial demo se inserta ya sentado: se le apunta el mesero de su
  // mesa en la configuración activa, para que las estadísticas por mesero
  // tengan datos. Solo filas demo sin mesero (repetir la carga no cambia nada).
  await db
    .update(waitlistEntries)
    .set({ waiterName: waiterNameForTableSql(waitlistEntries.assignedTableId) })
    .where(and(eq(waitlistEntries.isDemo, true), isNull(waitlistEntries.waiterName), sql`${waitlistEntries.assignedTableId} is not null`));

  return {
    batchId,
    zonas,
    mesas,
    esperando,
    sentados,
    reservadas,
    meseros,
    historial: historial.inserted,
    omitidos: [...new Set(omitidos)],
  };
}

/**
 * Cuántos datos de demostración hay ahora mismo, y de qué tipo.
 *
 * Lo usan los scripts (`db:demo`, `db:demo:borrar`) y las pruebas. Solo cuenta filas con `is_demo`: las reales no se ven aquí.
 */
export async function demoSummary() {
  const [zonasRows, mesasRows, clientesRows, meserosRows] = await Promise.all([
    db.select({ total: sql<number>`count(*)` }).from(tableLayouts).where(eq(tableLayouts.isDemo, true)),
    db.select({ total: sql<number>`count(*)` }).from(tables).where(eq(tables.isDemo, true)),
    db.select({ total: sql<number>`count(*)` }).from(waitlistEntries).where(eq(waitlistEntries.isDemo, true)),
    db.select({ total: sql<number>`count(*)` }).from(waiterConfigs).where(eq(waiterConfigs.isDemo, true)),
  ]);
  const zonas = zonasRows[0]?.total ?? 0;
  const mesas = mesasRows[0]?.total ?? 0;
  const clientes = clientesRows[0]?.total ?? 0;
  const meseros = Number(meserosRows[0]?.total ?? 0);
  const total = Number(zonas) + Number(mesas) + Number(clientes) + meseros;
  return {
    zonas: Number(zonas),
    mesas: Number(mesas),
    clientes: Number(clientes),
    /** Configuraciones de zonas de meseros de ejemplo. */
    meseros,
    total,
    /** Con esto se decide si aparece el aviso en la app. */
    activo: total > 0,
  };
}