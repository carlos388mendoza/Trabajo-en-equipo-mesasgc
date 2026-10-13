// Pasa las configuraciones de meseros que ya existen a la paleta nueva
// (`lib/waiters/palette.ts`): el mesero N de cada configuración toma el color
// N. Cada mesero conserva sus mesas (el reparto no cambia) y su nombre
// interno (con el que está apuntado en los clientes que atendió).
//
//   npm run db:meseros-paleta                         (solo mira)
//   npm run db:meseros-paleta -- --confirmar=RECOLOREAR
//
// Guarda con `saveWaiterConfig`, lo mismo que «Editar zonas» → «Guardar» (con
// su bloqueo optimista por versión), después de validar con el mismo schema
// de Zod que la server action. No toca nada más.

import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

const { db } = await import("@/lib/db");
const { restaurants } = await import("@/lib/db/schema");
const { listWaiterConfigs, saveWaiterConfig } = await import("@/lib/waiters/configs");
const { saveWaiterConfigSchema } = await import("@/lib/waiters/validation");
const { WAITER_PALETTE, waiterColorName } = await import("@/lib/waiters/palette");

const CONFIRM = "RECOLOREAR";
const apply = process.argv.includes(`--confirmar=${CONFIRM}`);

function databaseHost(): string {
  const url = process.env.TURSO_DATABASE_URL ?? "";
  try {
    return url.startsWith("file:") ? url : new URL(url).host;
  } catch {
    return "(TURSO_DATABASE_URL no válida)";
  }
}

console.log(`Base de datos: ${databaseHost()}`);
let cambiadas = 0;
let iguales = 0;
let fallos = 0;
for (const r of await db.select({ id: restaurants.id, name: restaurants.name }).from(restaurants).orderBy(restaurants.name)) {
  for (const c of await listWaiterConfigs(r.id)) {
    const zones = [...c.zones].sort((a, b) => a.position - b.position);
    if (zones.length > WAITER_PALETTE.length) {
      fallos += 1;
      console.log(`  ${r.name} · «${c.name}»: ${zones.length} meseros, más que colores en la paleta. No se tocó.`);
      continue;
    }
    const nuevos = zones.map((z, i) => ({ id: z.id, waiterName: z.waiterName, color: WAITER_PALETTE[i].hex }));
    const sinCambio = nuevos.every((n, i) => n.color === zones[i].color.toLowerCase());
    const antes = zones.map((z) => `${waiterColorName(z.color)}(${z.tableIds.length})`).join(" ");
    const despues = nuevos.map((n, i) => `${WAITER_PALETTE[i].name}(${zones[i].tableIds.length})`).join(" ");
    if (sinCambio) {
      iguales += 1;
      continue;
    }
    console.log(`  ${r.name} · «${c.name}»${c.isActive ? " (activa)" : ""}: ${antes} → ${despues}`);
    if (!apply) {
      cambiadas += 1;
      continue;
    }
    const input = saveWaiterConfigSchema.parse({
      restaurantId: r.id,
      configId: c.id,
      version: c.version,
      name: c.name,
      zones: nuevos,
      assignments: zones.flatMap((z) => z.tableIds.map((tableId) => ({ tableId, zoneId: z.id }))),
    });
    const result = await saveWaiterConfig(input);
    if (result.ok) cambiadas += 1;
    else {
      fallos += 1;
      console.log(`    NO se guardó: ${result.error}`);
    }
  }
}
console.log(
  apply
    ? `\nRecoloreadas: ${cambiadas}. Ya estaban bien: ${iguales}. Fallos: ${fallos}.`
    : `\nSe recolorearían ${cambiadas} (ya están bien: ${iguales}). No se cambió nada. Para aplicar: npm run db:meseros-paleta -- --confirmar=${CONFIRM}`,
);
process.exit(fallos ? 1 : 0);
