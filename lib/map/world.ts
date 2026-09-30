// El dibujo del mapa general: ciudades, distritos y la carretera que las une.
//
// Es un dibujo propio en un lienzo de 1000 × 1000 (las mismas unidades que
// `restaurants.map_x` / `map_y`), no un mapa real: no hay coordenadas GPS ni
// imágenes de terceros. San Pedro Sula queda arriba a la izquierda y
// Tegucigalpa abajo a la derecha, más o menos como en el país, y así un
// restaurante nuevo solo necesita caer dentro de su distrito.
//
// Solo datos, sin React: lo pinta `components/map/world-map.tsx`.

export const WORLD_SIZE = 1000;

export type District = {
  id: string;
  name: string;
  city: string;
  /** Polígono en unidades del mapa. */
  points: [number, number][];
  /** Dónde va el nombre del distrito. */
  label: [number, number];
};

export type City = {
  name: string;
  /** Nombre grande de la ciudad y su posición. */
  label: [number, number];
};

export const CITIES: City[] = [
  { name: "San Pedro Sula", label: [78, 56] },
  { name: "Tegucigalpa", label: [586, 486] },
];

export const DISTRICTS: District[] = [
  // San Pedro Sula
  {
    id: "sps-norte", name: "Norte", city: "San Pedro Sula",
    points: [[78, 96], [210, 78], [340, 86], [436, 70], [452, 160], [446, 236], [300, 252], [180, 244], [92, 262], [84, 180]],
    label: [98, 124],
  },
  {
    id: "sps-circunvalacion", name: "Circunvalación", city: "San Pedro Sula",
    points: [[92, 272], [180, 254], [300, 262], [450, 246], [468, 320], [474, 392], [330, 404], [200, 396], [104, 408], [96, 340]],
    label: [110, 298],
  },
  {
    id: "sps-sur", name: "Sur", city: "San Pedro Sula",
    points: [[106, 418], [200, 406], [330, 414], [476, 402], [462, 470], [444, 540], [320, 556], [210, 546], [128, 556], [112, 490]],
    label: [128, 536],
  },
  // Tegucigalpa
  {
    id: "tgu-centro", name: "Centro", city: "Tegucigalpa",
    points: [[540, 532], [640, 520], [738, 514], [744, 600], [734, 684], [640, 694], [556, 694], [548, 610]],
    label: [560, 556],
  },
  {
    id: "tgu-proceres", name: "Los Próceres", city: "Tegucigalpa",
    points: [[748, 510], [850, 498], [948, 496], [952, 590], [940, 676], [840, 686], [744, 684], [754, 600]],
    label: [770, 532],
  },
  {
    id: "tgu-morazan", name: "Morazán", city: "Tegucigalpa",
    points: [[700, 694], [810, 690], [932, 686], [936, 750], [922, 814], [800, 816], [692, 808], [696, 750]],
    label: [846, 716],
  },
  {
    id: "tgu-lomas", name: "Las Lomas", city: "Tegucigalpa",
    points: [[548, 704], [620, 698], [690, 700], [686, 800], [680, 910], [600, 918], [540, 916], [544, 810]],
    label: [556, 730],
  },
];

/** Carretera entre las dos ciudades: decorativa, da idea de distancia. */
export const HIGHWAY = {
  label: "CA-5",
  path: "M 440 470 C 500 500, 470 560, 548 610",
  labelAt: [494, 548] as [number, number],
};

export function pointsAttr(points: [number, number][]): string {
  return points.map(([x, y]) => `${x},${y}`).join(" ");
}
