// Proyección del mapa general: latitud y longitud → unidades del mapa.
//
// Es una proyección equirectangular centrada en Honduras: la longitud se
// multiplica por el coseno de la latitud media para que el país no salga
// estirado a lo ancho. En un país de 5° de alto la deformación es mínima, y
// así la cuenta es trivial y exacta en los dos sentidos (sin librerías).
//
// Las unidades son las de `restaurants.map_x` / `map_y`: el lienzo mide
// `MAP_WIDTH` × `MAP_HEIGHT`, con el origen arriba a la izquierda. El
// encuadre incluye las Islas del Cisne, al norte, y deja sitio para ver las
// fronteras con Guatemala, El Salvador y Nicaragua.
//
// Solo cuentas, sin React ni base de datos: lo usan el mapa, el seed,
// `db:restaurantes` y el script que genera la silueta.

export const MAP_BOUNDS = { west: -89.9, east: -82.9, south: 12.6, north: 17.6 } as const;

const MID_LATITUDE = (MAP_BOUNDS.north + MAP_BOUNDS.south) / 2;
const LONGITUDE_SCALE = Math.cos((MID_LATITUDE * Math.PI) / 180);

export const MAP_WIDTH = 1000;
/** Unidades del mapa por grado de latitud (y por grado de longitud ya corregido). */
const UNITS_PER_DEGREE = MAP_WIDTH / ((MAP_BOUNDS.east - MAP_BOUNDS.west) * LONGITUDE_SCALE);
export const MAP_HEIGHT = Math.round((MAP_BOUNDS.north - MAP_BOUNDS.south) * UNITS_PER_DEGREE);

export type LatLng = { lat: number; lng: number };
export type MapPoint = { x: number; y: number };

/** Latitud y longitud → punto del mapa. */
export function project({ lat, lng }: LatLng): MapPoint {
  return {
    x: (lng - MAP_BOUNDS.west) * LONGITUDE_SCALE * UNITS_PER_DEGREE,
    y: (MAP_BOUNDS.north - lat) * UNITS_PER_DEGREE,
  };
}

/** Punto del mapa → latitud y longitud. Inversa exacta de `project`. */
export function unproject({ x, y }: MapPoint): LatLng {
  return {
    lat: MAP_BOUNDS.north - y / UNITS_PER_DEGREE,
    lng: MAP_BOUNDS.west + x / (LONGITUDE_SCALE * UNITS_PER_DEGREE),
  };
}

/** Kilómetros → unidades del mapa (aproximado: 1° de latitud ≈ 111 km). */
export function kmToUnits(km: number): number {
  return (km / 111.32) * UNITS_PER_DEGREE;
}

/**
 * Posición de un restaurante en el mapa. Manda la latitud y longitud; si no
 * las tiene (una fila anterior a la migración 0004), se usan `map_x` y
 * `map_y` tal cual.
 */
export function restaurantPosition(r: {
  latitude: number | null;
  longitude: number | null;
  mapX: number | null;
  mapY: number | null;
}): MapPoint | null {
  if (r.latitude !== null && r.longitude !== null) return project({ lat: r.latitude, lng: r.longitude });
  if (r.mapX !== null && r.mapY !== null) return { x: r.mapX, y: r.mapY };
  return null;
}
