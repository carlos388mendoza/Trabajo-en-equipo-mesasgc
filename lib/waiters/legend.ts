// Leyenda de meseros de «Ver clientes» (modo sencillo): quién atiende hoy y de
// qué color, y de qué color va cada cliente según quién lo atendió.
//
// Funciones puras, sin base de datos ni React: salen de las mesas que el modo
// sencillo ya tiene (`listSeatableTables`, con el mesero y el color de la
// configuración ACTIVA en cada mesa). Así la leyenda funciona también sin
// conexión (con la copia guardada de las mesas) y se pone al día sola cada
// vez que se recargan las mesas, por ejemplo al cambiar la cantidad de
// meseros con [−] [+]. Las prueban `verify:editor` y `verify:realtime`.

import { WAITER_COLORS } from "@/lib/waiters/balance";

export type WaiterLegendItem = { name: string; color: string };

type TableWithWaiter = { waiterName: string | null; waiterColor: string | null };

/**
 * Los meseros de la configuración activa: los mismos que cuenta
 * «Meseros activos: [−] N [+]», aunque alguno tenga sus mesas en otra zona
 * que no sea el Comedor principal. En el orden de sus colores, que es el de
 * sus posiciones («Mesero 1» primero). Vacía si el restaurante no tiene zonas
 * de meseros activas.
 */
export function waiterLegend(tables: readonly TableWithWaiter[]): WaiterLegendItem[] {
  const byName = new Map<string, string>();
  for (const t of tables) {
    if (t.waiterName && t.waiterColor && !byName.has(t.waiterName)) byName.set(t.waiterName, t.waiterColor);
  }
  const rank = (color: string) => {
    const i = (WAITER_COLORS as readonly string[]).indexOf(color.toLowerCase());
    return i === -1 ? WAITER_COLORS.length : i;
  };
  return [...byName]
    .map(([name, color]) => ({ name, color }))
    .sort((a, b) => rank(a.color) - rank(b.color) || a.name.localeCompare(b.name, "es"));
}

/**
 * El color de un cliente según el mesero que lo atendió (`waiterName`, que se
 * apunta al sentarlo). Null si no tiene mesero o si ese mesero ya no está en
 * la configuración activa: entonces se enseña su nombre en gris.
 */
export function waiterColorFor(legend: readonly WaiterLegendItem[], waiterName: string | null | undefined): string | null {
  if (!waiterName) return null;
  return legend.find((item) => item.name === waiterName)?.color ?? null;
}
