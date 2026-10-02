// Verificación de los DATOS DE DEMOSTRACIÓN.
//
//   npm run verify:demo
//
// No hay runner de tests en el repo, así que esto es un script que sale con
// código 1 si algo falla, como los demás `verify:*`.
//
// Qué cubre, y por qué:
//
//  - Que `loadDemoData()` sea IDEMPOTENTE: correrla dos veces no duplica nada
//    y no pisa lo que ya estaba.
//  - Que el lote cubra los 8 restaurantes con zonas demo completas (mesas con
//    sillas, butacas, baños, caja y zona de juegos), clientes esperando con
//    teléfonos de mentira, mesas ocupadas y reservadas, y ocho semanas de
//    historial.
//  - Que NUNCA se toquen datos reales: marcas, restaurantes, catálogo, usuarios,
//    zonas reales, mesas reales y clientes reales. Se siembran filas reales a
//    propósito ANTES de cargar el demo y se comprueba que sobreviven intactas.
//  - Que `borrarDemoData()` borre el lote entero y deje las filas reales como
//    estaban, sea repetible, y ABORTE (sin escribir nada) si un cliente real
//    depende de una mesa demo.
//  - Que las estadísticas y el asistente usen los datos demo como cualquier
//    otro (es la razón de que el historial exista).
//
// Usa una base SQLite temporal (`.verify-demo.db`) con las migraciones del repo,
// así que no toca ni la base de desarrollo ni Turso.

import { rmSync } from "node:fs";
import { resolve } from "node:path";

import { config } from "dotenv";

// Tiene que ir ANTES de cualquier acceso a `db`: lee la variable en el primer
// uso, no al importar el módulo.
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });
const DB_FILE = resolve(process.cwd(), ".verify-demo.db");
rmSync(DB_FILE, { force: true });
process.env.TURSO_DATABASE_URL = `file:${DB_FILE}`;

const { and, eq, isNotNull, sql } = await import("drizzle-orm");

const { applyAllMigrations } = await import("./migrations.mts");
const { db } = await import("@/lib/db");
const {
  brands,
  elementTypes,
  restaurants,
  tableLayouts,
  tables,
  user: authUser,
  userRoles,
  waitlistEntries,
} = await import("@/lib/db/schema");
const { loadDemoData, demoSummary } = await import("@/lib/demo/load");
const { borrarDemoData } = await import("@/lib/demo/delete");
const { BASE_BRANDS, BASE_RESTAURANTS } = await import("@/lib/layout/base-restaurants");
const { upsertElementTypeCatalog } = await import("@/lib/layout/catalog");
const { loadDemoHistory } = await import("@/lib/demo/history");
const { DEMO_BATCH_ID, DEMO_HISTORY_DAYS, DEMO_PHONE_PREFIX, DEMO_PLANS } =
  await import("@/lib/demo/fixtures");
const { getAnalytics } = await import("@/lib/analytics/data");

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FALLA ${name}${detail ? ` -> ${detail}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

// ---------------------------------------------------------------------------
// Esquema y datos de partida
// ---------------------------------------------------------------------------

section("Esquema y datos reales");

const applied = await applyAllMigrations(`file:${DB_FILE}`);
check(`las migraciones del repo se aplican (${applied.length})`, applied.length > 0);

await upsertElementTypeCatalog();

// Marcas y restaurantes REALES (los mismos ids que producción).
for (const brand of BASE_BRANDS) {
  await db.insert(brands).values(brand).onConflictDoNothing();
}
for (const restaurant of BASE_RESTAURANTS) {
  await db.insert(restaurants).values(restaurant).onConflictDoNothing();
}
check(`los ${BASE_RESTAURANTS.length} restaurantes reales están`, (await db.select().from(restaurants)).length === BASE_RESTAURANTS.length);

// La zona REAL de cada restaurante: vacía, como en producción. El demo NO la
// debe tocar.
for (const restaurant of BASE_RESTAURANTS) {
  await db
    .insert(tableLayouts)
    .values({
      id: `zona_${restaurant.id}`,
      restaurantId: restaurant.id,
      name: "Comedor principal",
      description: "Zona inicial vacía: dibuja aquí el plano del local.",
      width: 1200,
      height: 800,
      sortOrder: 0,
      isDefault: true,
    })
    .onConflictDoNothing();
}
const zonasReales = await db.select({ id: tableLayouts.id }).from(tableLayouts);
check("cada restaurante tiene su zona real", zonasReales.length === BASE_RESTAURANTS.length);

// Filas REALES que el demo no puede tocar. Van con `is_demo` en false (lo
// normal) y con nombres que se parecen a los del demo a propósito, para
// comprobar que el borrado no se guía por el nombre.
const REAL_MESA = "tbl_real_centro";
const REAL_CLIENTE = "wl_real_centro";
const ZONA_REAL = `zona_rest_centro`;
await db.insert(tables).values({
  id: REAL_MESA,
  restaurantId: "rest_centro",
  layoutId: ZONA_REAL,
  elementTypeId: "el_mesa-sillas",
  label: "Mesa real 1",
  x: 100,
  y: 100,
  capacity: 4,
});
await db.insert(waitlistEntries).values({
  id: REAL_CLIENTE,
  restaurantId: "rest_centro",
  customerName: "Cliente Real Pérez",
  partySize: 2,
  phone: "9988-7766",
  status: "esperando",
  arrivedAt: new Date(),
});
// Asignado a la mesa real: la garantía de "una mesa, un cliente" del paso 6.
await db
  .update(tables)
  .set({ status: "ocupada", currentEntryId: REAL_CLIENTE })
  .where(eq(tables.id, REAL_MESA));

// Un usuario real, para comprobar que el demo no crea usuarios ni los toca.
await db.insert(authUser).values({
  id: "usr_real",
  name: "Administrador Real",
  email: "real@grupocomidas.test",
  emailVerified: true,
  createdAt: new Date(),
  updatedAt: new Date(),
});
await db.insert(userRoles).values({ userId: "usr_real", role: "admin" }).onConflictDoNothing();
check("hay un usuario real y su rol", (await db.select().from(authUser)).length === 1);

// ---------------------------------------------------------------------------
// Carga del lote
// ---------------------------------------------------------------------------

section("Carga del lote de demostración");

// Un restaurante que ya tiene SU configuración de meseros: el demo no le
// añade las de ejemplo ni le cambia la activa.
const { createWaiterConfig, listWaiterConfigs } = await import("@/lib/waiters/configs");
const { waiterConfigs } = await import("@/lib/db/schema");
const CON_MESEROS = DEMO_PLANS[0].restaurantId;
const meserosReales = await createWaiterConfig({ restaurantId: CON_MESEROS, waiterCount: 4 });
check("hay una configuración de meseros real en un restaurante", meserosReales.ok && meserosReales.config.isActive);

const carga = await loadDemoData();
check("la carga informa del lote", carga.batchId === DEMO_BATCH_ID, carga.batchId);
check(`crea ${DEMO_PLANS.length} zonas demo`, carga.zonas === DEMO_PLANS.length, `${carga.zonas}`);
check("crea las mesas del demo", carga.mesas > 0, `${carga.mesas}`);
check("crea clientes esperando", carga.esperando > 0, `${carga.esperando}`);
check("sienta clientes en mesas demo", carga.sentados > 0, `${carga.sentados}`);
check("reserva mesas demo", carga.reservadas > 0, `${carga.reservadas}`);
check("no omite ningún restaurante", carga.omitidos.length === 0, carga.omitidos.join(", "));
{
  const demoConfigs = await db.select().from(waiterConfigs).where(eq(waiterConfigs.isDemo, true));
  check(
    "crea «2 meseros» y «3 meseros» de ejemplo donde no había ninguna",
    carga.meseros === (DEMO_PLANS.length - 1) * 2 && demoConfigs.length === carga.meseros && demoConfigs.every((c) => c.demoBatchId === DEMO_BATCH_ID),
    `${carga.meseros} / ${demoConfigs.length}`,
  );
  const propias = await listWaiterConfigs(CON_MESEROS);
  check("  y no toca el restaurante que ya tenía la suya", propias.length === 1 && propias[0].isActive && !propias[0].isDemo);
  const conMesero = await db.select({ n: sql<number>`count(*)` }).from(waitlistEntries).where(and(eq(waitlistEntries.isDemo, true), isNotNull(waitlistEntries.waiterName)));
  check("  los sentados del demo tienen mesero (estadísticas por mesero)", Number(conMesero[0].n) > 0, `${conMesero[0].n}`);
  check("  y las estadísticas los cuentan", (await getAnalytics()).waiters.length > 0);
}

const resumen1 = await demoSummary();
check("el resumen ve datos demo", resumen1.activo && resumen1.total > 0, JSON.stringify(resumen1));

// --- Idempotencia ----------------------------------------------------------

section("Idempotencia");

const antesDeRepetir = {
  zonas: (await db.select().from(tableLayouts).where(eq(tableLayouts.isDemo, true))).length,
  mesas: (await db.select().from(tables).where(eq(tables.isDemo, true))).length,
  clientes: (await db.select().from(waitlistEntries).where(eq(waitlistEntries.isDemo, true))).length,
};
const repetida = await loadDemoData();
check("la segunda carga no crea filas nuevas", repetida.zonas === 0 && repetida.mesas === 0 && repetida.esperando === 0 && repetida.sentados === 0 && repetida.reservadas === 0 && repetida.historial === 0, JSON.stringify(repetida));
const despuesDeRepetir = {
  zonas: (await db.select().from(tableLayouts).where(eq(tableLayouts.isDemo, true))).length,
  mesas: (await db.select().from(tables).where(eq(tables.isDemo, true))).length,
  clientes: (await db.select().from(waitlistEntries).where(eq(waitlistEntries.isDemo, true))).length,
};
check("los totales no cambian al repetir", JSON.stringify(antesDeRepetir) === JSON.stringify(despuesDeRepetir), `${JSON.stringify(antesDeRepetir)} vs ${JSON.stringify(despuesDeRepetir)}`);

// La tercera vez, con el historial ya dentro: sigue sin crear nada.
const tercera = await loadDemoHistory();
check("el historial también es idempotente", tercera.inserted === 0, `${tercera.inserted}`);

// --- Cobertura de los 8 restaurantes ---------------------------------------

section("Cobertura por restaurante");

const planesIds = DEMO_PLANS.map((p) => p.restaurantId);
for (const restaurantId of planesIds) {
  const zona = await db
    .select({ id: tableLayouts.id, isDemo: tableLayouts.isDemo, batch: tableLayouts.demoBatchId })
    .from(tableLayouts)
    .where(and(eq(tableLayouts.restaurantId, restaurantId), eq(tableLayouts.isDemo, true)));
  const mesas = await db
    .select({ id: tables.id, key: elementTypes.key })
    .from(tables)
    .innerJoin(elementTypes, eq(elementTypes.id, tables.elementTypeId))
    .where(and(eq(tables.restaurantId, restaurantId), eq(tables.isDemo, true)));
  const tipos = new Set(mesas.map((m) => m.key));
  const completa =
    zona.length === 1 &&
    zona[0].batch === DEMO_BATCH_ID &&
    tipos.has("mesa-sillas") &&
    tipos.has("mesa-butacas") &&
    tipos.has("bano") &&
    tipos.has("caja") &&
    tipos.has("area-juegos");
  check(`${restaurantId}: una zona demo con la sala completa`, completa, `${zona.length} zona(s), tipos: ${[...tipos].join(", ")}`);
}

// --- Teléfonos de mentira y notas ----------------------------------------

section("Los clientes del demo se identifican solos");

const clientesDemo = await db
  .select({ phone: waitlistEntries.phone, batch: waitlistEntries.demoBatchId })
  .from(waitlistEntries)
  .where(eq(waitlistEntries.isDemo, true));
check("todos los clientes demo llevan el lote", clientesDemo.every((c) => c.batch === DEMO_BATCH_ID));
const conTelefono = clientesDemo.filter((c) => c.phone !== null);
check(
  `todos los teléfonos son de mentira (${conTelefono.length} con teléfono)`,
  conTelefono.every((c) => (c.phone ?? "").startsWith(DEMO_PHONE_PREFIX)),
  conTelefono.find((c) => !(c.phone ?? "").startsWith(DEMO_PHONE_PREFIX))?.phone,
);

// --- Estados variados ------------------------------------------------------

section("Estados variados");

const estados = await db
  .select({ status: waitlistEntries.status, n: sql<number>`count(*)` })
  .from(waitlistEntries)
  .where(eq(waitlistEntries.isDemo, true))
  .groupBy(waitlistEntries.status);
const porEstado = new Map(estados.map((e) => [e.status, Number(e.n)]));
check("hay clientes esperando", (porEstado.get("esperando") ?? 0) > 0, JSON.stringify(Object.fromEntries(porEstado)));
check("hay clientes sentados", (porEstado.get("sentado") ?? 0) > 0);
check("hay clientes ausentes (el historial los trae)", (porEstado.get("ausente") ?? 0) > 0);

const mesasOcupadas = await db
  .select({ n: sql<number>`count(*)` })
  .from(tables)
  .where(and(eq(tables.isDemo, true), isNotNull(tables.currentEntryId)));
check("hay mesas demo ocupadas", Number(mesasOcupadas[0].n) > 0, `${mesasOcupadas[0].n}`);
const mesasReservadas = await db
  .select({ n: sql<number>`count(*)` })
  .from(tables)
  .where(and(eq(tables.isDemo, true), eq(tables.status, "reservada")));
check("hay mesas demo reservadas", Number(mesasReservadas[0].n) > 0, `${mesasReservadas[0].n}`);

// --- Historial ------------------------------------------------------------

section("Historial para estadísticas");

const fechas = await db
  .select({ arrivedAt: waitlistEntries.arrivedAt })
  .from(waitlistEntries)
  .where(and(eq(waitlistEntries.isDemo, true), eq(waitlistEntries.status, "sentado")));
const dias = new Set(fechas.map((f) => new Date(f.arrivedAt).toISOString().slice(0, 10)));
check(`el historial cubre ${DEMO_HISTORY_DAYS} días`, dias.size >= DEMO_HISTORY_DAYS - 2, `${dias.size} días distintos`);
check("el historial es numeroso", fechas.length > 1000, `${fechas.length} sentados`);

// Las estadísticas los leen como cualquier otro cliente: sin tocar nada.
const estadisticas = await getAnalytics({});
check(
  "las estadísticas ven el historial demo sin configuración extra",
  estadisticas.restaurants.length === BASE_RESTAURANTS.length &&
    estadisticas.restaurants.every((r) => r.groups > 0),
  `${estadisticas.restaurants.length} restaurantes, ${estadisticas.totals.groups} grupos`,
);
check(
  "  y calculan una espera promedio real",
  estadisticas.totals.averageWaitMinutes > 0,
  `${estadisticas.totals.averageWaitMinutes}`,
);
check(
  "  y un top de clientes (de los nombres inventados del demo)",
  estadisticas.topCustomers.length > 0,
  `${estadisticas.topCustomers.length}`,
);
check(
  "  y el resumen escrito menciona los grupos sentados",
  /se sentaron \d+ grupos/.test(estadisticas.summary),
  estadisticas.summary.slice(0, 80),
);

// --- Los datos reales no se tocaron --------------------------------------

section("Los datos reales siguen intactos");

const zonasFinales = await db.select().from(tableLayouts);
check(
  "siguen las 8 zonas reales, sin cambios",
  zonasFinales.filter((z) => !z.isDemo).length === BASE_RESTAURANTS.length,
  `${zonasFinales.filter((z) => !z.isDemo).length}`,
);
check(
  "  y las reales siguen siendo las de por defecto, vacías y sin tocar",
  zonasFinales
    .filter((z) => !z.isDemo)
    .every((z) => z.isDefault && z.name === "Comedor principal" && z.version === 1),
);
check(
  "las marcas siguen siendo las 4 reales",
  (await db.select().from(brands)).length === BASE_BRANDS.length,
  `${(await db.select().from(brands)).length}`,
);
check(
  "el catálogo sigue con sus tipos reales",
  (await db.select().from(elementTypes)).length === 8,
  `${(await db.select().from(elementTypes)).length}`,
);
check("no se creó ningún usuario", (await db.select().from(authUser)).length === 1);
check("no se tocó el rol del usuario real", (await db.select().from(userRoles)).length === 1);
const mesaReal = await db.select().from(tables).where(eq(tables.id, REAL_MESA));
check("la mesa real sigue ahí, ocupada y con su cliente", mesaReal.length === 1 && mesaReal[0].status === "ocupada" && mesaReal[0].currentEntryId === REAL_CLIENTE, JSON.stringify(mesaReal[0] ?? {}));
const clienteReal = await db.select().from(waitlistEntries).where(eq(waitlistEntries.id, REAL_CLIENTE));
check("el cliente real sigue esperando, sin marcar como demo", clienteReal.length === 1 && !clienteReal[0].isDemo && clienteReal[0].status === "esperando", JSON.stringify(clienteReal[0] ?? {}));

// ---------------------------------------------------------------------------
// Aborto: un cliente real no puede depender de una mesa demo
// ---------------------------------------------------------------------------

section("El borrado aborta si un dato real depende del demo");

{
  const mesaDemo = await db
    .select({ id: tables.id })
    .from(tables)
    .where(and(eq(tables.isDemo, true), eq(tables.restaurantId, "rest_norte")))
    .limit(1);
  check("hay una mesa demo donde colgar la prueba", mesaDemo.length === 1);

  // Un cliente REAL asignado a una mesa DEMO: la combinación que no puede
  // existir en el uso normal, pero que el borrado tiene que saber manejar.
  await db
    .insert(waitlistEntries)
    .values({
      id: "wl_real_colgado",
      restaurantId: "rest_norte",
      customerName: "Cliente Real Colgado",
      partySize: 2,
      status: "sentado",
      arrivedAt: new Date(),
      assignedTableId: mesaDemo[0].id,
    });

  const bloqueado = await borrarDemoData({ dryRun: true });
  check("el borrado se niega y explica por qué", !bloqueado.ok && bloqueado.clientesRealesEnMesasDemo === 1, JSON.stringify(bloqueado));
  check(
    "  y el mensaje dice que no se borró nada",
    !bloqueado.ok && bloqueado.error.includes("No se borró nada"),
  );
  const resumenTrasAbortar = await demoSummary();
  check("  y de verdad no se borró nada", resumenTrasAbortar.total === resumen1.total, `${resumenTrasAbortar.total} vs ${resumen1.total}`);

  // Se despeja la referencia y entonces sí puede borrar.
  await db.delete(waitlistEntries).where(eq(waitlistEntries.id, "wl_real_colgado"));
  const desbloqueado = await borrarDemoData({ dryRun: true });
  check("sin esa referencia, el borrado vuelve a estar disponible", desbloqueado.ok, JSON.stringify(bloqueado));
}

// ---------------------------------------------------------------------------
// Borrado
// ---------------------------------------------------------------------------

section("Borrado del lote");

{
  const realAntes = await db.select().from(waitlistEntries).where(eq(waitlistEntries.id, REAL_CLIENTE));
  const borrado = await borrarDemoData();
  check("el borrado termina bien", borrado.ok, JSON.stringify(borrado));
  if (borrado.ok) {
    check(`borra ${borrado.clientes} clientes demo`, borrado.clientes === resumen1.clientes, `${borrado.clientes} vs ${resumen1.clientes}`);
    check(`borra ${borrado.mesas} mesas demo`, borrado.mesas === resumen1.mesas, `${borrado.mesas} vs ${resumen1.mesas}`);
    check(`borra ${borrado.zonas} zonas demo`, borrado.zonas === resumen1.zonas, `${borrado.zonas} vs ${resumen1.zonas}`);
    check(`borra las ${borrado.meseros} configuraciones de meseros de ejemplo`, borrado.meseros === carga.meseros && (await db.select().from(waiterConfigs).where(eq(waiterConfigs.isDemo, true))).length === 0);
  }
  const propias = await listWaiterConfigs(CON_MESEROS);
  check("la configuración de meseros real sigue, activa", propias.length === 1 && propias[0].isActive && !propias[0].isDemo);

  const resumenFinal = await demoSummary();
  check("ya no queda nada marcado como demo", !resumenFinal.activo && resumenFinal.total === 0, JSON.stringify(resumenFinal));
  check(
    "las zonas demo desaparecieron",
    (await db.select().from(tableLayouts).where(eq(tableLayouts.isDemo, true))).length === 0,
  );
  check(
    "las mesas demo desaparecieron",
    (await db.select().from(tables).where(eq(tables.isDemo, true))).length === 0,
  );
  check(
    "los clientes demo desaparecieron",
    (await db.select().from(waitlistEntries).where(eq(waitlistEntries.isDemo, true))).length === 0,
  );

  // --- Lo real sobrevivió ------------------------------------------------
  section("Lo real sobrevivió al borrado");

  check("el cliente real sigue ahí, con su estado", (await db.select().from(waitlistEntries).where(eq(waitlistEntries.id, REAL_CLIENTE))).length === 1);
  const clienteRealFinal = await db.select().from(waitlistEntries).where(eq(waitlistEntries.id, REAL_CLIENTE));
  check(
    "  sin cambios: esperando, no demo, con su teléfono",
    clienteRealFinal[0].status === realAntes[0].status && !clienteRealFinal[0].isDemo && clienteRealFinal[0].phone === "9988-7766",
    JSON.stringify(clienteRealFinal[0]),
  );
  const mesaRealFinal = await db.select().from(tables).where(eq(tables.id, REAL_MESA));
  check("la mesa real sigue ocupada por su cliente", mesaRealFinal[0].currentEntryId === REAL_CLIENTE && mesaRealFinal[0].status === "ocupada");
  check("  y no quedó con el puntero colgado", mesaRealFinal[0].currentEntryId !== null);
  check(
    "las 8 zonas reales siguen en pie",
    (await db.select().from(tableLayouts).where(eq(tableLayouts.isDemo, false))).length === BASE_RESTAURANTS.length,
  );
  check("los 8 restaurantes siguen", (await db.select().from(restaurants)).length === BASE_RESTAURANTS.length);
  check("las 4 marcas siguen", (await db.select().from(brands)).length === BASE_BRANDS.length);
  check("el catálogo sigue intacto", (await db.select().from(elementTypes)).length === 8);
  check("el usuario real sigue, con su rol", (await db.select().from(authUser)).length === 1 && (await db.select().from(userRoles)).length === 1);

  // --- Repetible ----------------------------------------------------------
  section("El borrado se puede repetir");

  const otra = await borrarDemoData();
  check("una segunda vez no falla", otra.ok, JSON.stringify(otra));
  if (otra.ok) {
    check("  y no borra nada más", otra.clientes === 0 && otra.mesas === 0 && otra.zonas === 0, JSON.stringify(otra));
  }
  check("el cliente real sigue ahí después de repetir", (await db.select().from(waitlistEntries).where(eq(waitlistEntries.id, REAL_CLIENTE))).length === 1);
}

// ---------------------------------------------------------------------------
// Recarga tras borrar
// ---------------------------------------------------------------------------

section("Recarga tras borrar");

{
  const recargada = await loadDemoData();
  check("se puede volver a cargar", recargada.zonas === DEMO_PLANS.length, `${recargada.zonas}`);
  check("  con clientes esperando", recargada.esperando > 0, `${recargada.esperando}`);
  check("  y con historial", recargada.historial > 0, `${recargada.historial}`);
  const resumenRecargado = await demoSummary();
  check("  el resumen los ve", resumenRecargado.activo);
  check("  y el cliente real sigue ahí", (await db.select().from(waitlistEntries).where(eq(waitlistEntries.id, REAL_CLIENTE))).length === 1);
  check("  y su mesa real también", (await db.select().from(tables).where(eq(tables.id, REAL_MESA))).length === 1);
}

// ---------------------------------------------------------------------------
// Desglose por restaurante y borrado de UN restaurante (/admin, botón «Borrar
// demo de este restaurante»)
// ---------------------------------------------------------------------------

section("Desglose y borrado por restaurante");

{
  const { demoBreakdown } = await import("@/lib/demo/summary");
  const desglose = await demoBreakdown();
  const resumenAhora = await demoSummary();
  check("el desglose tiene un renglón por restaurante con demo", desglose.restaurantes.length === new Set(DEMO_PLANS.map((p) => p.restaurantId)).size, `${desglose.restaurantes.length}`);
  check("  clientes + historial = clientes demo del resumen", desglose.totales.clientes + desglose.totales.historial === resumenAhora.clientes, `${desglose.totales.clientes}+${desglose.totales.historial} vs ${resumenAhora.clientes}`);
  check("  mesas y zonas cuadran", desglose.totales.mesas === resumenAhora.mesas && desglose.totales.zonas === resumenAhora.zonas);
  check("  los clientes de hoy y el historial salen separados", desglose.totales.clientes > 0 && desglose.totales.historial > desglose.totales.clientes);

  const objetivo = "rest_centro";
  const otro = desglose.restaurantes.find((r) => r.restaurantId !== objetivo)!;
  const antesObjetivo = desglose.restaurantes.find((r) => r.restaurantId === objetivo)!;
  const realAntes = await db.select().from(waitlistEntries).where(eq(waitlistEntries.id, REAL_CLIENTE));
  const ensayo = await borrarDemoData({ restaurantId: objetivo, dryRun: true });
  check("el ensayo de un restaurante dice lo que borraría", ensayo.ok && ensayo.clientes === antesObjetivo.clientes + antesObjetivo.historial && ensayo.mesas === antesObjetivo.mesas && ensayo.zonas === antesObjetivo.zonas, JSON.stringify(ensayo));
  const uno = await borrarDemoData({ restaurantId: objetivo });
  const despues = await demoBreakdown();
  check(`borra solo el demo de ${objetivo}`, uno.ok && !despues.restaurantes.some((r) => r.restaurantId === objetivo), JSON.stringify(uno));
  check("  el demo de los demás restaurantes no se toca", JSON.stringify(despues.restaurantes.find((r) => r.restaurantId === otro.restaurantId)) === JSON.stringify(otro));
  check("  el cliente real de ese restaurante sigue intacto", JSON.stringify(await db.select().from(waitlistEntries).where(eq(waitlistEntries.id, REAL_CLIENTE))) === JSON.stringify(realAntes));
  check("  su mesa real también", (await db.select().from(tables).where(eq(tables.id, REAL_MESA))).length === 1);
  check("  no queda ninguna fila demo de ese restaurante", (await db.select().from(waitlistEntries).where(and(eq(waitlistEntries.restaurantId, objetivo), eq(waitlistEntries.isDemo, true)))).length === 0 && (await db.select().from(tables).where(and(eq(tables.restaurantId, objetivo), eq(tables.isDemo, true)))).length === 0);
  const otraVez = await borrarDemoData({ restaurantId: objetivo });
  check("  repetirlo no falla ni borra nada", otraVez.ok && otraVez.clientes === 0 && otraVez.mesas === 0 && otraVez.zonas === 0);
}

// ---------------------------------------------------------------------------
// Permisos: quién ve el aviso y quién puede borrar
//
// Se comprueba `can()` directamente, que es la única fuente de permisos de la
// app (`lib/auth/rbac.ts`). No hay permisos paralelos para el demo: se
// integra en los de siempre. Lo que pasa por HTTP (banner, pantalla y server
// action) lo comprueba `verify:auth`, que sí levanta la app de verdad.
// ---------------------------------------------------------------------------

section("Permisos de los datos de demostración");

{
  const { can } = await import("@/lib/auth/rbac");
  const { ROLES } = await import("@/lib/db/enums");
  type Subject = Parameters<typeof can>[0];
  const admin: Subject = { active: true, roles: [ROLES.ADMIN], restaurantIds: [] };
  const restaurante: Subject = { active: true, roles: [ROLES.RESTAURANTE], restaurantIds: ["rest_centro"] };
  const analitica: Subject = { active: true, roles: [ROLES.ANALITICA], restaurantIds: [] };
  const gerente: Subject = {
    active: true,
    roles: [ROLES.RESTAURANTE, ROLES.ANALITICA],
    restaurantIds: ["rest_centro"],
  };
  const inactivo: Subject = { active: false, roles: [ROLES.ADMIN], restaurantIds: [] };

  check("admin puede ver y borrar", can(admin, "demo:ver") && can(admin, "demo:borrar"));
  // Desde el 2 de octubre el aviso es solo de admin y analítica; el host ve la
  // etiqueta «Demo» en las cartas.
  check("restaurante NO ve el aviso (ve la etiqueta «Demo» en las cartas)", !can(restaurante, "demo:ver"));
  check("  ni puede borrar", !can(restaurante, "demo:borrar"));
  check("analitica puede ver el aviso", can(analitica, "demo:ver"));
  check("  pero NO puede borrar", !can(analitica, "demo:borrar"));
  check("con dos roles, los permisos se suman (analítica ve el aviso) y sigue sin poder borrar", can(gerente, "demo:ver") && !can(gerente, "demo:borrar"));
  check("un admin desactivado tampoco", !can(inactivo, "demo:ver") && !can(inactivo, "demo:borrar"));
  check("sin usuario, tampoco", !can(null, "demo:ver") && !can(null, "demo:borrar"));

  // Los permisos del demo no cambian los de antes: el admin sigue teniendo
  // todo y el resto, lo de siempre.
  const { ALL_ACTIONS } = await import("@/lib/auth/rbac");
  check("los permisos del admin son los de siempre, con los del demo y meseros:gestionar", can(admin, "usuarios:gestionar") && can(admin, "catalogo:gestionar") && can(admin, "meseros:gestionar") && ALL_ACTIONS.length === 15, `${ALL_ACTIONS.length}`);
  check("el demo no le da el mapa general a un host", !can(restaurante, "mapa:ver") && !can(restaurante, "analiticas:ver"));
}

// ---------------------------------------------------------------------------

console.log("");
if (failures.length === 0) {
  console.log(`verify:demo — ${passed} comprobaciones, todas correctas.`);
  process.exit(0);
}
console.log(`verify:demo — ${passed} correctas, ${failures.length} FALLIDAS:`);
for (const failure of failures) console.log(`  - ${failure}`);
process.exit(1);