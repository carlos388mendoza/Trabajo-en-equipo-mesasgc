// Carga del lote de DATOS DE DEMOSTRACIÓN.
//
//   npm run db:demo
//
// Qué crea, en los 8 restaurantes reales de Grupo Comidas:
//
//  1. Una ZONA demo por restaurante (`is_demo`), con la sala completa: mesas con
//     sillas, una bancada, baños, caja y zona de juegos. Es una zona nueva, no
//     la real: el plano que alguien haya dibujado a mano no se lee ni se toca.
//  2. Clientes de la lista de espera AHORA: los que esperan, con sus minutos
//     de espera, y los que se sientan en las mesas demo.
//  3. Mesas demo ocupadas y reservadas.
//  4. Ocho semanas de historial (ver `lib/demo/history.ts`), para que
//     /analiticas y el asistente tengan algo que contar.
//
// Qué NO hace, nunca:
//
//  - No crea ni modifica marcas, restaurantes, el catálogo de tipos de elemento
//    ni usuarios. No hay contraseñas en este archivo ni en el lote.
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

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { SEATABLE_ELEMENT_KEYS } from "@/lib/db/enums";
import { elementTypes, restaurants, tableLayouts, tables, waiterConfigs, waitlistEntries } from "@/lib/db/schema";
import { assignTable } from "@/lib/tables/assign";
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

/** Los ids de tipo de elemento del catálogo, por clave. */
async function typeIdsByKey(): Promise<Map<string, string>> {
  const rows = await db.select({ id: elementTypes.id, key: elementTypes.key }).from(elementTypes);
  return new Map(rows.map((r) => [r.key, r.id]));
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
  const typeIds = await typeIdsByKey();

  const missingTypes = [...new Set(DEMO_PLANS.flatMap((p) => p.tables.map((t) => t.typeKey)))]
    .filter((key) => !typeIds.has(key));
  if (missingTypes.length > 0) {
    throw new Error(
      `Faltan tipos de elemento en el catálogo: ${missingTypes.join(", ")}. ` +
        "Corre `npm run db:catalog` primero. No se escribió nada.",
    );
  }

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

  let zonas = 0;
  let mesas = 0;
  let esperando = 0;
  let sentados = 0;
  let reservadas = 0;
  let meseros = 0;

  for (const plan of plans) {
    // --- Zona demo -------------------------------------------------------
    // `isDefault` va a false a propósito: la zona por defecto de cada
    // restaurante es la real y el índice único (una por defecto) no admite dos.
    const zona = await db
      .insert(tableLayouts)
      .values({
        id: plan.layout.id,
        restaurantId: plan.layout.restaurantId,
        name: plan.layout.name,
        description: plan.layout.description,
        width: 1000,
        height: 800,
        sortOrder: plan.layout.sortOrder,
        isDefault: false,
        isDemo: true,
        demoBatchId: batchId,
      })
      .onConflictDoNothing({ target: tableLayouts.id })
      .returning({ id: tableLayouts.id });
    zonas += zona.length;

    // --- Mesas demo ------------------------------------------------------
    // Solo se insertan las que faltan: repetir la carga no reescribe las que ya
    // están, así que una mesa que un host ya está usando no se toca.
    const existing = new Set(
      (
        await db
          .select({ id: tables.id })
          .from(tables)
          .where(eq(tables.layoutId, plan.layout.id))
      ).map((r) => r.id),
    );
    const nuevas = plan.tables.filter((t) => !existing.has(t.id));
    if (nuevas.length > 0) {
      const created = await db
        .insert(tables)
        .values(
          nuevas.map((t) => ({
            id: t.id,
            restaurantId: plan.restaurantId,
            layoutId: t.layoutId,
            elementTypeId: typeIds.get(t.typeKey)!,
            label: t.label,
            x: t.x,
            y: t.y,
            width: 80,
            height: 80,
            rotation: 0,
            capacity: t.capacity,
            // Las mesas nacen libres: la ocupación la pone el paso de sentar,
            // con `assignTable`, igual que lo haría un host.
            isDemo: true,
            demoBatchId: batchId,
          })),
        )
        .onConflictDoNothing()
        .returning({ id: tables.id });
      mesas += created.length;
    }

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
    // Los que van a sentarse también pasaron por la lista: llegaron antes.
    const toSeat = Array.from({ length: plan.occupied }, (_, i) => ({
      id: `${DEMO_ID_PREFIX}s_${plan.restaurantId}_${i + 1}`,
      restaurantId: plan.restaurantId,
      customerName: demoName(i + 7),
      partySize: 2 + (i % 3),
      phone: demoPhone(i + 100),
      notes: DEMO_NOTE,
      status: "esperando" as const,
      arrivedAt: new Date(now - (12 + i * 3) * 60_000),
    }));
    const nuevosClientes = [...waiting, ...toSeat];
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
    // restaurante, y repetir la carga no las duplica. Van ANTES de sentar a
    // nadie para que los sentados del demo tengan mesero.
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

    // --- Ocupar mesas con `assignTable` ----------------------------------
    // Se usa el camino de verdad (el mismo que un host), para que el estado
    // "ocupada", el `current_entry_id` y el "sentado" del cliente queden
    // exactamente como los deja la app. Solo se escriben mesas DEMO.
    const demoTables = await db
      .select({ id: tables.id, currentEntryId: tables.currentEntryId, status: tables.status })
      .from(tables)
      .where(
        and(
          eq(tables.restaurantId, plan.restaurantId),
          eq(tables.isDemo, true),
          inArray(
            tables.elementTypeId,
            [...SEATABLE_ELEMENT_KEYS].map((key) => typeIds.get(key)!).filter(Boolean),
          ),
        ),
      )
      .orderBy(asc(tables.x), asc(tables.y), asc(tables.id));
    const libres = demoTables.filter(
      (t) => t.currentEntryId === null && t.status !== "reservada",
    );

    for (const entry of toSeat) {
      const [libreTable] = libres;
      if (!libreTable) break;
      // Si el cliente ya está sentado de una carga anterior, `assignTable` lo
      // rechaza y se pasa al siguiente, sin romper nada.
      const result = await assignTable({
        restaurantId: plan.restaurantId,
        tableId: libreTable.id,
        entryId: entry.id,
        userId: null,
      });
      if (result.ok) {
        libres.shift();
        sentados += 1;
      }
    }

    // --- Reservar mesas ---------------------------------------------------
    // El estado "reservada" lo escribe el demo, no la app: no hay pantalla de
    // reservas todavía (ver docs/estado-del-proyecto.md, "Lo que falta"). Solo
    // mesas demo libres.
    //
    // Se mira cuántas HAY ya reservadas y se completa hasta `plan.reserved`, en
    // vez de reservar otras tantas cada vez: si no, repetir la carga reservaría
    // mesas nuevas en cada corrida y el lote dejaría de ser idempotente.
    const yaReservadas = demoTables.filter((t) => t.status === "reservada").length;
    const faltan = Math.max(0, plan.reserved - yaReservadas);
    // `slice(-0)` sería `slice(0)`, que devuelve el array entero: con `faltan`
    // en cero hay que devolver una lista vacía, no "todas las libres".
    const reservables = faltan > 0 ? libres.slice(-faltan) : [];
    for (const mesa of reservables) {
      const updated = await db
        .update(tables)
        .set({
          status: "reservada",
          version: sql`${tables.version} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(tables.id, mesa.id), eq(tables.isDemo, true), isNull(tables.currentEntryId)))
        .returning({ id: tables.id });
      reservadas += updated.length;
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