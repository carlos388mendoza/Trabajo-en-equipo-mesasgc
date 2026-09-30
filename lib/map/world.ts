// El dibujo del mapa general: Honduras entero, sus ciudades principales y los
// encuadres para acercarse.
//
// La silueta, los 18 departamentos y los vecinos vienen de Natural Earth
// (dominio público) en `lib/map/honduras-geo.ts`, generado por
// `scripts/map/generate-honduras.mts`. Todo va en las unidades de
// `lib/map/projection.ts`, las mismas que `restaurants.map_x` / `map_y`.
//
// Solo datos y cuentas, sin React: lo pinta `components/map/world-map.tsx`.

import { MAP_HEIGHT, MAP_WIDTH, kmToUnits, project } from "@/lib/map/projection";

export { DEPARTMENTS, HONDURAS_PATH, NEIGHBORS } from "@/lib/map/honduras-geo";
export { MAP_HEIGHT, MAP_WIDTH };

/** [x, y, ancho, alto] del `viewBox` del SVG. */
export type ViewBox = [number, number, number, number];

export type City = {
  name: string;
  x: number;
  y: number;
  /** 1 = capital, 2 = ciudad grande, 3 = el resto. Decide el tamaño del rótulo. */
  rank: 1 | 2 | 3;
  /** Hacia dónde va el nombre, para que no pise el punto ni a otra ciudad. */
  labelSide: "right" | "left" | "above" | "below";
};

const city = (name: string, lat: number, lng: number, rank: City["rank"], labelSide: City["labelSide"] = "right"): City => {
  const { x, y } = project({ lat, lng });
  return { name, x, y, rank, labelSide };
};

/** Ciudades principales, tengan o no restaurantes (centro de cada ciudad). */
export const CITIES: City[] = [
  city("Tegucigalpa", 14.0723, -87.1921, 1, "below"),
  city("San Pedro Sula", 15.5042, -88.025, 2, "left"),
  city("La Ceiba", 15.7597, -86.7822, 2, "below"),
  city("Choluteca", 13.3007, -87.1908, 2, "right"),
  city("Comayagua", 14.4598, -87.6376, 3, "left"),
  city("El Progreso", 15.4003, -87.8069, 3, "below"),
  city("Puerto Cortés", 15.8256, -87.929, 3, "above"),
  city("Danlí", 14.0333, -86.5833, 3, "right"),
  city("Juticalpa", 14.6667, -86.2167, 3, "right"),
  city("Santa Rosa de Copán", 14.7667, -88.7792, 3, "below"),
  city("Roatán", 16.3167, -86.5333, 3, "above"),
];

/** Todo Honduras, con un poco de mar alrededor. */
export const FULL_VIEW: ViewBox = [-10, -10, MAP_WIDTH + 20, MAP_HEIGHT + 20];

/** Lo más cerca que deja llegar la rueda o el pellizco: unos 5 km de ancho. */
export const MIN_VIEW_WIDTH = kmToUnits(5);
/** Lo más lejos: un poco más que todo el país. */
export const MAX_VIEW_WIDTH = FULL_VIEW[2] * 1.4;

/** Encuadre de `widthKm` de ancho centrado en (x, y), con la proporción del mapa. */
export function viewAround(x: number, y: number, widthKm: number): ViewBox {
  const width = kmToUnits(widthKm);
  const height = (width * FULL_VIEW[3]) / FULL_VIEW[2];
  return [x - width / 2, y - height / 2, width, height];
}

/** Ciudades con botón de «acercarse». */
export const ZOOM_CITIES = ["Tegucigalpa", "San Pedro Sula"] as const;

export function cityView(name: string): ViewBox {
  const c = CITIES.find((item) => item.name === name);
  return c ? viewAround(c.x, c.y, 16) : FULL_VIEW;
}

/** El menor encuadre que contiene todos los puntos, con margen y la proporción del mapa. */
export function viewAroundPoints(points: { x: number; y: number }[], minWidthKm = 8): ViewBox {
  if (points.length === 0) return FULL_VIEW;
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const aspect = FULL_VIEW[2] / FULL_VIEW[3];
  const spanX = Math.max(Math.max(...xs) - Math.min(...xs), (Math.max(...ys) - Math.min(...ys)) * aspect);
  const width = Math.max(spanX * 1.8, kmToUnits(minWidthKm));
  const height = width / aspect;
  return [cx - width / 2, cy - height / 2, width, height];
}

/**
 * Deja el encuadre dentro de los límites: ni más cerca ni más lejos de lo
 * permitido, y sin irse del todo fuera del mapa al arrastrar.
 */
export function clampView([x, y, width, height]: ViewBox): ViewBox {
  const aspect = height / width;
  const w = Math.min(MAX_VIEW_WIDTH, Math.max(MIN_VIEW_WIDTH, width));
  const h = w * aspect;
  const cx = Math.min(FULL_VIEW[0] + FULL_VIEW[2], Math.max(FULL_VIEW[0], x + width / 2));
  const cy = Math.min(FULL_VIEW[1] + FULL_VIEW[3], Math.max(FULL_VIEW[1], y + height / 2));
  return [cx - w / 2, cy - h / 2, w, h];
}
