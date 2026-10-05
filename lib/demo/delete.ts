// Borrado del lote de DATOS DE DEMOSTRACIÓN.
//
//   npm run db:demo:borrar   (el único camino: la sección de datos demo y su
//                             aviso se quitaron de la interfaz el 5 de octubre;
//                             los datos y este servicio se quedan)
//
// Es el ÚNICO sitio que borra datos de demostración, y lo usan tanto el script
// como la pantalla de administración. Los dos caminos hacen exactamente lo
// mismo.
//
// Garantías, en orden de importancia:
//
//  1. SOLO se borran filas con `is_demo = true`. Cada DELETE lleva ese filtro;
//     no hay excepciones, ni "si el nombre empieza por demo", ni borrados por
//     rango de fechas. Las marcas, los restaurantes, el catálogo de tipos, los
//     usuarios, sus sesiones, sus roles, sus asignaciones de restaurante y
//     cualquier zona o mesa real quedan intactos.
//
//  2. Es TRANSACCIONAL: o se borra el lote entero, o no se borra nada. Con
//     Turso, una transacción es una sola petición.
//
//  3. Si algo REAL depende de algo demo, ABORTA y lo dice. No se resuelve
//     destroying datos reales ni "arreglando" referencias a la fuerza. Concreto:
//
//      - Si un cliente REAL (`is_demo = false`) está asignado a una mesa demo,
//        borrar la mesa dejaría al cliente real con `assigned_table_id = null`
//        (la FK es ON DELETE SET NULL). En vez de aceptar eso, se aborta: es
//        más seguro que un cliente real pierda su mesa sin que nadie lo
//        pidiera.
//      - Si una mesa REAL (`is_demo = false`) estuviera en una zona demo, no se
//        puede borrar la zona sin llevársela. También aborta.
//
//  4. Es REPETIBLE: si no hay nada demo, no hace nada y lo dice. Se puede
//     correr dos veces sin miedo.
//
// Orden de borrado, por las claves foráneas:
//
//   1. `waitlist_entries` demo  -> 2. `tables` demo  -> 3. `table_layouts` demo
//
// El paso 1 va primero porque `waitlist_entries.assigned_table_id` apunta a
// `tables` con ON DELETE SET NULL y `tables.current_entry_id` (puntero blando,
// sin FK) apunta a `waitlist_entries`. Al revés, borrar mesas primero dejaría
// el puntero blando apuntando a clientes ya borrados.
// `table_layouts` va el último porque de él cuelgan las mesas por cascada.
//
// `tables.current_entry_id` no tiene foreign key (es un puntero blando a
// propósito, para que el histórico sobreviva), así que hay que limpiarlo a mano
// ANTES de borrar la mesa: si no, en la tabla `tables` puede quedar un id que
// ya no existe.

import { and, asc, eq, inArray, isNotNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { tableLayouts, tables, waiterConfigs, waitlistEntries } from "@/lib/db/schema";

export type DemoDeleteResult = {
  ok: true;
  /** Filas borradas de este lote. */
  clientes: number;
  mesas: number;
  zonas: number;
  /** Configuraciones de meseros de ejemplo. */
  meseros: number;
  /** Filas demo que no se borraron, con el motivo. */
  omitidos: { clientes: number; mesas: number };
};

export type DemoDeleteBlocked = {
  ok: false;
  /** Por qué no se puede borrar, en castellano, para enseñárselo a alguien. */
  error: string;
  /** Lo que bloquea, para diagnosticar sin tocar nada. */
  clientesRealesEnMesasDemo: number;
  mesasRealesEnZonasDemo: number;
};

/**
 * Borra todo lo que tenga `is_demo`, o explica por qué no puede.
 *
 * Con `restaurantId`, solo lo de ESE restaurante (botón «Borrar demo de este
 * restaurante» de /admin): las mismas garantías, recortadas a sus filas.
 *
 * `dryRun: true` hace la misma comprobación y devuelve lo que habría de borrar
 * sin escribir nada: lo usa la pantalla para confirmar antes de hacerlo.
 */
export async function borrarDemoData(
  options: { dryRun?: boolean; restaurantId?: string } = {},
): Promise<DemoDeleteResult | DemoDeleteBlocked> {
  const { restaurantId } = options;
  // El mismo recorte para las tres tablas: todas tienen `restaurant_id`.
  const inEntries = restaurantId ? eq(waitlistEntries.restaurantId, restaurantId) : undefined;
  const inTables = restaurantId ? eq(tables.restaurantId, restaurantId) : undefined;
  const inLayouts = restaurantId ? eq(tableLayouts.restaurantId, restaurantId) : undefined;
  const inWaiters = restaurantId ? eq(waiterConfigs.restaurantId, restaurantId) : undefined;

  // --- (3) Comprobaciones ANTES de escribir nada -------------------------
  // Clientes reales sentados en mesas demo: borrarlas les dejaría sin mesa.
  const [{ count: clientesReales }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(waitlistEntries)
    .where(
      and(
        sql`${waitlistEntries.isDemo} = 0`,
        isNotNull(waitlistEntries.assignedTableId),
        restaurantId
          ? sql`exists (select 1 from ${tables} where ${tables.id} = ${waitlistEntries.assignedTableId} and ${tables.isDemo} = 1 and ${tables.restaurantId} = ${restaurantId})`
          : sql`exists (select 1 from ${tables} where ${tables.id} = ${waitlistEntries.assignedTableId} and ${tables.isDemo} = 1)`,
      ),
    );

  // Mesas reales dentro de zonas demo: borraría la zona y con ella la mesa.
  const [{ count: mesasReales }] = await db
    .select({ count: sql<number>`count(*)` })
    .from(tables)
    .where(
      and(
        sql`${tables.isDemo} = 0`,
        sql`exists (select 1 from ${tableLayouts} where ${tableLayouts.id} = ${tables.layoutId} and ${tableLayouts.isDemo} = 1)`,
        inTables,
      ),
    );

  if (Number(clientesReales) > 0 || Number(mesasReales) > 0) {
    const partes: string[] = [];
    if (Number(clientesReales) > 0) {
      partes.push(
        `${clientesReales} cliente(s) REALES están asignados a mesas de demostración`,
      );
    }
    if (Number(mesasReales) > 0) {
      partes.push(`${mesasReales} mesa(s) REALES están en zonas de demostración`);
    }
    return {
      ok: false,
      error:
        `${partes.join(" y ")}. No se borró nada para no dañar esos datos reales. ` +
        "Revisa esas filas a mano (o libéralas) y vuelve a intentarlo.",
      clientesRealesEnMesasDemo: Number(clientesReales),
      mesasRealesEnZonasDemo: Number(mesasReales),
    };
  }

  // --- Conteo previo (lo que se va a borrar) ---------------------------
  const [clientesDemo, mesasDemo, zonasDemo, meserosDemo] = await Promise.all([
    db.select({ n: sql<number>`count(*)` }).from(waitlistEntries).where(and(eq(waitlistEntries.isDemo, true), inEntries)),
    db.select({ n: sql<number>`count(*)` }).from(tables).where(and(eq(tables.isDemo, true), inTables)),
    db.select({ n: sql<number>`count(*)` }).from(tableLayouts).where(and(eq(tableLayouts.isDemo, true), inLayouts)),
    db.select({ n: sql<number>`count(*)` }).from(waiterConfigs).where(and(eq(waiterConfigs.isDemo, true), inWaiters)),
  ]);
  const clientes = Number(clientesDemo[0].n);
  const mesas = Number(mesasDemo[0].n);
  const zonas = Number(zonasDemo[0].n);
  const meseros = Number(meserosDemo[0].n);

  if (options.dryRun) {
    return { ok: true, clientes, mesas, zonas, meseros, omitidos: { clientes: 0, mesas: 0 } };
  }

  if (clientes === 0 && mesas === 0 && zonas === 0 && meseros === 0) {
    // Nada que borrar. Es el estado normal si se corrió dos veces.
    return { ok: true, clientes: 0, mesas: 0, zonas: 0, meseros: 0, omitidos: { clientes: 0, mesas: 0 } };
  }

  // --- (2) Todo o nada --------------------------------------------------
  const borrados = await db.transaction(async (tx) => {
    // 1. Los clientes demo primero: son los que apuntan a las mesas (FK SET
    //    NULL) y las mesas demo apuntan a ellos (puntero blando).
    const clientesBorrados = await tx
      .delete(waitlistEntries)
      .where(and(eq(waitlistEntries.isDemo, true), inEntries))
      .returning({ id: waitlistEntries.id });

    // 2. Las mesas demo. Antes se les vacía `current_entry_id`: es un puntero
    //    blando SIN foreign key, así que la base no lo limpia por nosotros y
    //    dejaría un id inexistente.
    await tx
      .update(tables)
      .set({ currentEntryId: null, status: "libre", updatedAt: new Date() })
      .where(and(eq(tables.isDemo, true), isNotNull(tables.currentEntryId), inTables));

    const mesasBorradas = await tx
      .delete(tables)
      .where(and(eq(tables.isDemo, true), inTables))
      .returning({ id: tables.id });

    // 3. Las zonas demo, al final: de ellas cuelgan las mesas por cascada.
    const zonasBorradas = await tx
      .delete(tableLayouts)
      .where(and(eq(tableLayouts.isDemo, true), inLayouts))
      .returning({ id: tableLayouts.id });

    // 4. Las configuraciones de meseros de ejemplo (sus zonas y su reparto
    //    se van en cascada). Si alguna era la activa, pasa a activa la
    //    primera que le quede al restaurante: así un restaurante que ya tenía
    //    las suyas no se queda sin meseros por borrar el demo.
    const meserosBorrados = await tx
      .delete(waiterConfigs)
      .where(and(eq(waiterConfigs.isDemo, true), inWaiters))
      .returning({ restaurantId: waiterConfigs.restaurantId, isActive: waiterConfigs.isActive });
    const sinActiva = [...new Set(meserosBorrados.filter((c) => c.isActive).map((c) => c.restaurantId))];
    if (sinActiva.length > 0) {
      const quedan = await tx
        .select({ id: waiterConfigs.id, restaurantId: waiterConfigs.restaurantId })
        .from(waiterConfigs)
        .where(inArray(waiterConfigs.restaurantId, sinActiva))
        .orderBy(asc(waiterConfigs.waiterCount), asc(waiterConfigs.sortOrder));
      for (const id of sinActiva) {
        const next = quedan.find((c) => c.restaurantId === id);
        if (next) await tx.update(waiterConfigs).set({ isActive: true }).where(eq(waiterConfigs.id, next.id));
      }
    }

    return {
      clientes: clientesBorrados.length,
      mesas: mesasBorradas.length,
      zonas: zonasBorradas.length,
      meseros: meserosBorrados.length,
    };
  });

  return {
    ok: true,
    ...borrados,
    omitidos: { clientes: 0, mesas: 0 },
  };
}