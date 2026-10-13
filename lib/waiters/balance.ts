// Reparto automático de mesas entre meseros, y la paleta de colores de las
// zonas. Funciones puras: las usa el servidor al crear una configuración y el
// navegador para el botón «Repartir automáticamente» (se ve el resultado antes
// de guardar). Sin base de datos ni React.

import { WAITER_HEXES, WAITER_PALETTE } from "./palette";

/**
 * Colores de zona: la paleta de meseros (ver `palette.ts`). Cada mesero se
 * reconoce solo por su color, así que el mesero N lleva siempre el color N.
 */
export const WAITER_COLORS = WAITER_HEXES;

/** Tope de meseros por configuración: uno por color de la paleta. */
export const MAX_WAITERS = WAITER_COLORS.length;

/**
 * El nombre interno del mesero N de una configuración nueva: el de su color
 * («Rojo»). No se enseña (el mesero se reconoce por el color), pero se apunta
 * en cada cliente que atiende, así que conviene que diga el color.
 */
export function defaultWaiterName(position: number): string {
  return WAITER_PALETTE[(position - 1) % WAITER_PALETTE.length].name;
}

export function defaultConfigName(count: number): string {
  return count === 1 ? "1 mesero" : `${count} meseros`;
}

export type BalanceTable = { id: string; layoutId: string; x: number; y: number };

/**
 * Reparte las mesas en `count` zonas contiguas y equilibradas: cada mesero
 * recibe el mismo número de mesas (como mucho una de diferencia).
 *
 * «Contiguas»: se recorre cada zona del plano en columnas (de izquierda a
 * derecha y, dentro de una columna, de arriba abajo) y se corta en tramos.
 * Así a cada mesero le toca un bloque de mesas vecinas y no mesas sueltas por
 * todo el local. Las zonas del plano se recorren en el orden de `layoutOrder`.
 *
 * Devuelve, para cada mesa, el índice (0..count-1) de su mesero.
 */
export function autoBalance(
  list: BalanceTable[],
  count: number,
  layoutOrder: string[] = [],
): Map<string, number> {
  const out = new Map<string, number>();
  if (count < 1 || list.length === 0) return out;
  const rank = new Map(layoutOrder.map((id, i) => [id, i]));
  // Columnas de 80 px: dos mesas casi alineadas cuentan como la misma columna.
  const COLUMN = 80;
  const sorted = [...list].sort(
    (a, b) =>
      (rank.get(a.layoutId) ?? Number.MAX_SAFE_INTEGER) - (rank.get(b.layoutId) ?? Number.MAX_SAFE_INTEGER) ||
      a.layoutId.localeCompare(b.layoutId) ||
      Math.floor(a.x / COLUMN) - Math.floor(b.x / COLUMN) ||
      a.y - b.y ||
      a.id.localeCompare(b.id),
  );
  const base = Math.floor(sorted.length / count);
  const extra = sorted.length % count;
  let i = 0;
  for (let zone = 0; zone < count; zone += 1) {
    const size = base + (zone < extra ? 1 : 0);
    for (let k = 0; k < size; k += 1) out.set(sorted[i++].id, zone);
  }
  return out;
}
