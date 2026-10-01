// Carga el lote de DATOS DE DEMOSTRACIÓN.
//
//   npm run db:demo
//   railway run npm run db:demo   (contra la base de producción)
//
// Qué hace exactamente está en `lib/demo/`: crea, en los 8 restaurantes reales,
// una zona demo con la sala completa (mesas con sillas, bancada, baños, caja y
// zona de juegos), clientes de la lista de espera AHORA con teléfonos de
// mentira (`0000-0000-...`), mesas demo ocupadas y reservadas, y ocho semanas
// de historial para que /analiticas y el asistente tengan algo que contar.
//
// Qué NO hace nunca: no crea ni toca marcas, restaurantes, el catálogo de
// tipos, usuarios ni contraseñas; no toca la zona real ni los planos que alguien
// haya dibujado a mano. Cada fila que inserta va marcada con `is_demo` y
// `demo_batch_id`, que es lo que usa `npm run db:demo:borrar` (o la pantalla
// /admin/datos-demo) para separarla del resto.
//
// Es idempotente: correrla dos veces deja lo mismo que correrla una, porque
// los ids son deterministas y el insert es `ON CONFLICT DO NOTHING`.
//
// Solo muestra el HOST de la base (para saber si vas a la de producción), nunca
// el token. Antes de escribir pide escribir «si». Sin terminal, no hace nada.

import { config } from "dotenv";

import { ask, requireTerminal } from "./lib/terminal.mts";

config({ path: [".env.local", ".env"], quiet: true });

const { loadDemoData, demoSummary } = await import("@/lib/demo/load");
const { DEMO_BATCH_ID, DEMO_HISTORY_DAYS } = await import("@/lib/demo/fixtures");

/** Solo el host de la base, para saber dónde se va a escribir (nunca el token). */
function databaseHost(): string {
  const url = process.env.TURSO_DATABASE_URL ?? "";
  try {
    return url.startsWith("file:") ? url : new URL(url).host;
  } catch {
    return "(TURSO_DATABASE_URL no válida)";
  }
}

try {
  // Antes de leer la base: sin terminal no se puede confirmar, así que ni
  // siquiera se llega a abrir conexión.
  requireTerminal("La confirmación");

  console.log("DATOS DE DEMOSTRACIÓN");
  console.log(`Base de datos: ${databaseHost()}`);
  console.log(`Lote: ${DEMO_BATCH_ID} (los datos que ya estén marcados con este lote no se duplican)`);
  console.log("");
  console.log("Esto carga datos FICTICIOS en los 8 restaurantes reales:");
  console.log("  - una zona de demostración por restaurante, con la sala completa;");
  console.log("  - clientes en la lista de espera, con teléfonos de mentira;");
  console.log("  - mesas de demostración ocupadas y reservadas;");
  console.log(`  - ${DEMO_HISTORY_DAYS} días de historial para las estadísticas y el asistente.`);
  console.log("");
  console.log("NO toca marcas, restaurantes, usuarios, contraseñas ni los planos reales.");
  console.log("Se borra después con `npm run db:demo:borrar` o desde /admin/datos-demo.");
  console.log("");

  const antes = await demoSummary();
  if (antes.activo) {
    console.log(`Aviso: ya hay datos de demostración (${antes.total} filas). Se recargan.`);
    console.log("");
  }

  const confirm = await ask(`¿Cargar datos de demostración en ${databaseHost()}? Escribe «si» para confirmar: `);
  if (confirm.toLowerCase() !== "si" && confirm.toLowerCase() !== "sí") {
    console.log("Cancelado. No se escribió nada.");
    process.exit(0);
  }

  const result = await loadDemoData();

  console.log("");
  console.log("Lote cargado. Filas nuevas de este lote:");
  console.log(`  zonas de demostración:  ${result.zonas}`);
  console.log(`  mesas de demostración:  ${result.mesas}`);
  console.log(`  clientes esperando:      ${result.esperando}`);
  console.log(`  clientes sentados:       ${result.sentados}`);
  console.log(`  mesas reservadas:        ${result.reservadas}`);
  console.log(`  historial (${DEMO_HISTORY_DAYS} días): ${result.historial}`);

  if (result.omitidos.length > 0) {
    console.log("");
    console.log(`Omitidos (el restaurante no existe en esta base): ${result.omitidos.join(", ")}`);
    console.log("  Corre `npm run db:restaurantes` para crearlos y vuelve a correr este script.");
  }

  const despues = await demoSummary();
  console.log("");
  console.log(`Total de datos de demostración ahora: ${despues.total}`);
  console.log(`  zonas ${despues.zonas} · mesas ${despues.mesas} · clientes ${despues.clientes}`);
  process.exit(0);
} catch (error) {
  console.error("No se pudo cargar el lote de demostración:", error);
  process.exit(1);
}