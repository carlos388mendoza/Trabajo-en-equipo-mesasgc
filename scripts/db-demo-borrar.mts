// Borra el lote de DATOS DE DEMOSTRACIÓN.
//
//   npm run db:demo:borrar
//   railway run npm run db:demo:borrar   (contra la base de producción)
//
// Es el camino de RESPUESTA si no se puede usar la pantalla /admin/datos-demo
// (p. ej. no hay nadie con rol admin conectado). Hace exactamente lo mismo:
// llama a `borrarDemoData()` de `lib/demo/`, que es el mismo servicio que usa
// la web.
//
// Qué NO borra: marcas, restaurantes, el catálogo de tipos de elemento, usuarios,
// sesiones, cuentas, roles, asignaciones de restaurante, y cualquier zona, mesa o
// cliente REAL. Solo filas con `is_demo`.
//
// Todo va en una transacción y, si algún dato real depende de algo demo,
// ABORTA sin escribir nada en lugar de romper esa referencia.
//
// Es repetible: si no hay nada demo, lo dice y no hace nada.
//
// Solo muestra el HOST de la base, nunca el token, y pide escribir «BORRAR»
// para confirmar.

import { config } from "dotenv";

import { ask, requireTerminal } from "./lib/terminal.mts";

config({ path: [".env.local", ".env"], quiet: true });

const { borrarDemoData } = await import("@/lib/demo/delete");
const { demoSummary } = await import("@/lib/demo/load");

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
  requireTerminal("La confirmación");

  console.log("BORRADO DE DATOS DE DEMOSTRACIÓN");
  console.log(`Base de datos: ${databaseHost()}`);
  console.log("");

  // `dryRun`: hace las comprobaciones y cuenta sin escribir nada.
  const prevision = await borrarDemoData({ dryRun: true });
  if (!prevision.ok) {
    console.error("No se puede borrar ahora mismo:");
    console.error(`  ${prevision.error}`);
    process.exit(1);
  }

  const resumen = await demoSummary();
  console.log("Se va a borrar SOLO lo marcado como demostración:");
  console.log(`  zonas:                 ${prevision.zonas}`);
  console.log(`  mesas:                 ${prevision.mesas}`);
  console.log(`  clientes:              ${prevision.clientes}`);
  console.log(`  meseros (configs):     ${prevision.meseros}`);
  console.log("");
  console.log("NO se toca: marcas, restaurantes, catálogo de tipos, usuarios, sesiones,");
  console.log("roles ni ninguna zona, mesa o cliente real.");
  console.log("");
  console.log(`Estado actual: ${resumen.activo ? `SÍ hay datos demo (${resumen.total} filas)` : "no hay datos demo"}`);

  if (!resumen.activo) {
    console.log("");
    console.log("No hay nada que borrar. No se escribió nada.");
    process.exit(0);
  }

  console.log("");
  const confirm = await ask(`¿Borrar ${prevision.total} filas de demostración de ${databaseHost()}? Escribe «BORRAR» para confirmar: `);
  if (confirm.trim().toUpperCase() !== "BORRAR") {
    console.log("Cancelado. No se escribió nada.");
    process.exit(0);
  }

  const resultado = await borrarDemoData();
  if (!resultado.ok) {
    console.error("No se borró nada:", resultado.error);
    process.exit(1);
  }

  console.log("");
  console.log("Borrado:");
  console.log(`  zonas:    ${resultado.zonas}`);
  console.log(`  mesas:    ${resultado.mesas}`);
  console.log(`  clientes: ${resultado.clientes}`);
  console.log(`  meseros:  ${resultado.meseros}`);

  const despues = await demoSummary();
  console.log("");
  console.log(
    despues.activo
      ? `Quedan ${despues.total} filas marcadas como demostración.`
      : "Ya no quedan datos de demostración.",
  );
  process.exit(0);
} catch (error) {
  console.error("No se pudo borrar el lote de demostración:", error);
  process.exit(1);
}