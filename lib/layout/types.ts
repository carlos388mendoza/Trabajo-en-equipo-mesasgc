import type { LayoutRotation } from "@/lib/db/enums";

// Tipos que viajan entre el servidor (page -> server action) y el editor.
//
// Se defines aquí y no dentro de un componente porque los necesitan las dos
// partes: la page de Next es un Server Component y el canvas es un Client
// Component. Son datos planos (sin Date ni clases) para que el paso entre
// ambos sea solo JSON.

/** Fila de `element_types`: un tipo de la paleta del editor. */
export type ElementTypeInfo = {
  id: string;
  /** Clave estable: "mesa-sillas", "caja", etc. */
  key: string;
  label: string;
  /** Hex del color del tipo, p. ej. "#3b82f6". */
  color: string;
  icon: string;
  width: number;
  height: number;
  defaultCapacity: number | null;
};

/** Fila de `table_layouts` resumida, para el selector de zonas. */
export type LayoutSummary = {
  id: string;
  name: string;
  sortOrder: number;
  isDefault: boolean;
};

/**
 * Un elemento colocado en el mapa.
 *
 * `status` y `currentEntryId` SOLO SE LEEN: los escribe la asignación de
 * clientes (paso 6), nunca el editor. Vienen para que el canvas pueda pintar
 * una mesa ocupada, pero el guardado no los toca.
 */
export type LayoutElement = {
  id: string;
  elementTypeId: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  capacity: number | null;
  status: string;
  currentEntryId: string | null;
  /** Cliente sentado: solo lectura, igual que `currentEntryId`. */
  occupantName: string | null;
  /** Cuándo se sentó, en milisegundos. Alimenta el contador de minutos. */
  seatedAt: number | null;
};

/** Una zona con su estructura, tal y como la carga y guarda el editor. */
export type LayoutPayload = {
  id: string;
  restaurantId: string;
  name: string;
  /** Tamaño del lienzo en unidades del editor. */
  width: number;
  height: number;
  /** Se incrementa en cada guardado; el cliente lo manda para detectar losses. */
  version: number;
  /** Giro del plano completo: 0, 90, 180 o 270. */
  rotation: LayoutRotation;
  elements: LayoutElement[];
};
