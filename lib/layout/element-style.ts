// Cómo se ve cada tipo de elemento en el mapa.
//
// Función pura a propósito: el color y la forma de un tipo son reglas de
// negocio (baños pequeños, cajas sin sillas) y se pueden comprobar sin
// montar el canvas.

import { isSeatableElement } from "@/lib/db/enums";
import type { StatusKey } from "@/lib/theme/theme";
import type { ElementTypeInfo } from "./types";

export type ElementShape = "circle" | "rect" | "booth" | "zone" | "bar" | "door" | "wall";

export type ElementStyle = {
  shape: ElementShape;
  /** Radio de esquina para los rectángulos. */
  cornerRadius: number;
  /** Trazo discontinuo: solo lo usan las zonas grandes. */
  dashed: boolean;
  /** Si el elemento admite clientes y por tanto se pinta su capacidad. */
  seatable: boolean;
  /** Color de fondo, aclarado a partir del color del tipo. */
  fill: string;
  /** Color del borde. */
  stroke: string;
  textColor: string;
  /**
   * Si lleva su etiqueta encima. La pared no: con 18 unidades de grueso, la
   * etiqueta la taparía entera. Su nombre se ve al seleccionarla.
   */
  showLabel: boolean;
};

// Colores de estado de una mesa. Los pinta el editor, pero el que decide que
// una mesa está ocupada es el paso 6 (asignación de clientes).
export const OCCUPIED_FILL = "#dc2626";
export const OCCUPIED_STROKE = "#7f1d1d";
export const FREE_STROKE = "#1f2937";
export const SELECTED_STROKE = "#2563eb";

/**
 * Estado que se PINTA en una mesa.
 *
 * "ocupada" sale del puntero `currentEntryId`, que es la verdad (lo escribe la
 * asignación con su bloqueo); la columna `status` solo se mira para
 * "reservada", que no tiene puntero.
 */
export type VisualStatus = StatusKey;

export function visualStatus(element: {
  currentEntryId: string | null;
  status: string;
}): VisualStatus {
  if (element.currentEntryId !== null) return "ocupada";
  if (element.status === "reservada") return "reservada";
  return "libre";
}

// Los COLORES de cada estado están en `lib/theme/theme.ts`: cambian con el
// tema para leerse bien sobre cualquier fondo. Aquí solo el nombre.
export const STATUS_LABELS: Record<VisualStatus, string> = {
  libre: "Libre",
  ocupada: "Ocupada",
  reservada: "Reservada",
};

/** Orden de la leyenda. */
export const STATUS_ORDER: readonly VisualStatus[] = ["libre", "ocupada", "reservada"];

function normalizeHex(hex: string): string {
  const clean = hex.trim().replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  return `#${full.padEnd(6, "0").slice(0, 6)}`;
}

/** Devuelve `#rrggbb` con `amount` de blanco (positivo) o negro (negativo). */
export function shade(hex: string, amount: number): string {
  const clean = normalizeHex(hex).slice(1);
  const num = parseInt(clean, 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((num >> 16) & 0xff) + amount);
  const g = clamp(((num >> 8) & 0xff) + amount);
  const b = clamp((num & 0xff) + amount);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

/**
 * Estilo de un elemento.
 *
 * La forma no está en `element_types` a propósito: sale de la `key` del tipo.
 * Así una mesa con sillas siempre es redonda aunque alguien le cambie el
 * color, y cambiar la forma de un tipo no requiere migrar la base de datos.
 */
export function elementStyle(type: ElementTypeInfo): ElementStyle {
  const color = normalizeHex(type.color);
  const seatable = isSeatableElement(type.key);

  switch (type.key) {
    case "mesa-sillas":
      return {
        shape: "circle",
        cornerRadius: 0,
        dashed: false,
        seatable,
        fill: shade(color, 90),
        stroke: seatable ? FREE_STROKE : color,
        textColor: "#111827",
        showLabel: true,
      };
    case "mesa-butacas":
      return {
        shape: "booth",
        cornerRadius: 6,
        dashed: false,
        seatable,
        fill: shade(color, 90),
        stroke: FREE_STROKE,
        textColor: "#111827",
        showLabel: true,
      };
    case "area-juegos":
      return {
        shape: "zone",
        cornerRadius: 16,
        dashed: true,
        seatable,
        fill: shade(color, 110),
        stroke: color,
        textColor: "#111827",
        showLabel: true,
      };
    case "bano":
      return {
        shape: "rect",
        cornerRadius: 4,
        dashed: false,
        seatable,
        fill: shade(color, 120),
        stroke: color,
        textColor: "#111827",
        showLabel: true,
      };
    case "caja":
      return {
        shape: "rect",
        cornerRadius: 2,
        dashed: false,
        seatable,
        fill: shade(color, 90),
        stroke: color,
        textColor: "#111827",
        showLabel: true,
      };
    case "barra":
      return {
        shape: "bar",
        cornerRadius: 10,
        dashed: false,
        seatable,
        fill: shade(color, 90),
        stroke: color,
        textColor: "#111827",
        showLabel: true,
      };
    case "puerta":
      return {
        shape: "door",
        cornerRadius: 0,
        dashed: false,
        seatable,
        fill: shade(color, 110),
        stroke: color,
        textColor: "#111827",
        showLabel: true,
      };
    case "pared":
      return {
        shape: "wall",
        cornerRadius: 2,
        dashed: false,
        seatable,
        fill: color,
        stroke: color,
        textColor: "#111827",
        showLabel: false,
      };
    default:
      // Un tipo nuevo añadido al catálogo se dibuja como rectángulo genérico
      // en vez de desaparecer del mapa.
      return {
        shape: "rect",
        cornerRadius: 4,
        dashed: false,
        seatable,
        fill: shade(color, 90),
        stroke: color,
        textColor: "#111827",
        showLabel: true,
      };
  }
}

/**
 * Cuántas sillas dibujar alrededor de una mesa.
 *
 * Se limita a 8 por lo que quepa de verdad: en una mesa de 20 puestos pintar
 * 20 rectángulos solo tapa la etiqueta.
 */
export function visibleSeats(capacity: number | null): number {
  if (!capacity || capacity < 1) return 0;
  return Math.min(capacity, 8);
}

/**
 * Nombre corto por tipo, para numerar lo que se suelta en el mapa.
 *
 * El `label` de `element_types` es para leer ("Mesa con sillas"); para una
 * etiqueta de 30 píxeles hace falta algo que quepa ("Mesa 3").
 */
const SHORT_NAMES: Record<string, string> = {
  "mesa-sillas": "Mesa",
  "mesa-butacas": "Mesa",
  "area-juegos": "Juegos",
  bano: "Baño",
  caja: "Caja",
  barra: "Barra",
  puerta: "Puerta",
  pared: "Pared",
};

export function shortName(typeKey: string): string {
  return SHORT_NAMES[typeKey] ?? "Elemento";
}

/**
 * Siguiente etiqueta libre para un tipo, del estilo "Mesa 3".
 *
 * Se busca el primer número libre entre las etiquetas ya usadas de ESE tipo.
 * Contar y sumar no vale: si alguien borra la Mesa 2, la siguiente debe
 * reutilizar ese número en vez de saltar a la 4.
 */
export function nextLabel(
  typeKey: string,
  existingLabels: readonly string[],
): string {
  const base = shortName(typeKey);
  const taken = new Set(existingLabels);
  for (let n = 1; n < 10_000; n += 1) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} ${Date.now().toString(36)}`;
}
