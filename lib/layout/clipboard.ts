// Copiar y pegar elementos del editor: la copia que se pega.
//
// Función pura (sin React ni base de datos): la usa el editor y la prueba
// `verify:editor`. La regla que importa: la copia lleva lo VISUAL del original
// (tipo, tamaño, giro y puestos) y nada de lo que es del local ahora mismo
// (cliente sentado, estado ocupado o reservado). Tiene un id nuevo, así que al
// guardar es un elemento nuevo.

import type { TableStatus } from "@/lib/db/enums";

import { nextLabel } from "./element-style";
import type { LayoutElement } from "./types";

/** Cuánto se desplaza la copia para que se vea que hay dos. */
export const PASTE_OFFSET = 32;

export function pastedCopy(
  source: LayoutElement,
  options: {
    id: string;
    typeKey: string;
    /** Nombres que ya usa ese tipo en la zona, para el siguiente («Mesa 9»). */
    labelsOfType: readonly string[];
    /** Junto a qué elemento se pega (por defecto, junto al original). */
    anchor?: Pick<LayoutElement, "x" | "y">;
    /** Tamaño de la zona: la copia no se sale del lienzo. */
    zoneWidth: number;
    zoneHeight: number;
  },
): LayoutElement {
  const anchor = options.anchor ?? source;
  const clamp = (value: number, max: number) => Math.round(Math.min(Math.max(value, 0), Math.max(0, max)));
  return {
    id: options.id,
    elementTypeId: source.elementTypeId,
    label: nextLabel(options.typeKey, options.labelsOfType),
    x: clamp(anchor.x + PASTE_OFFSET, options.zoneWidth - source.width),
    y: clamp(anchor.y + PASTE_OFFSET, options.zoneHeight - source.height),
    width: source.width,
    height: source.height,
    rotation: source.rotation,
    capacity: source.capacity,
    // Nace libre: la ocupación es del local, no del dibujo.
    status: "libre" satisfies TableStatus,
    currentEntryId: null,
    occupantName: null,
    seatedAt: null,
  };
}
