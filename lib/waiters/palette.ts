// Paleta de los meseros: cada mesero se reconoce SOLO por su color.
//
// Colores muy distintos entre sí, en este orden (el del mesero 1 al 12): rojo,
// azul, amarillo, verde, morado, naranja, rosa, turquesa, café, gris oscuro,
// lima y lavanda (los dos últimos solo con 11 o 12 meseros). Elegidos para leerse de lejos en la tablet, sobre el fondo claro y
// el oscuro, y para no confundirse con los colores de ESTADO de las mesas
// (libre verde 600, ocupada rojo 600, reservada pizarra): el rojo del mesero es
// carmesí oscuro, el verde es verde bosque y el gris es más oscuro que el de
// «reservada». Además el mesero se marca con un borde grueso alrededor de la
// mesa y una franja encima, no con el relleno (que es el del estado).
//
// La lámina con la paleta en claro, oscuro y con simulación de daltonismo se
// genera con `scripts/waiters/lamina-paleta.mts`.
//
// En la base, `waiter_zones.waiter_name` sigue existiendo como clave interna
// (con él se apunta en cada cliente quién lo atendió). Las configuraciones
// nuevas guardan ahí el nombre del color («Rojo»); las de antes conservan el
// suyo, que ya no se enseña en ningún sitio.
//
// Sin base de datos ni React: lo usan el servidor, los componentes y las pruebas.

export type WaiterColor = { name: string; hex: string };

export const WAITER_PALETTE: readonly WaiterColor[] = [
  { name: "Rojo", hex: "#9b1220" },
  { name: "Azul", hex: "#2f80e0" },
  { name: "Amarillo", hex: "#f2d21b" },
  { name: "Verde", hex: "#17663c" },
  { name: "Morado", hex: "#7a14c9" },
  { name: "Naranja", hex: "#f08a2e" },
  { name: "Rosa", hex: "#f0368a" },
  { name: "Turquesa", hex: "#0fd0d6" },
  { name: "Café", hex: "#9a5a12" },
  { name: "Gris oscuro", hex: "#54585e" },
  // Dos más, para las configuraciones de 11 y 12 meseros (había en producción):
  // se distinguen algo peor con daltonismo, pero solo salen con tantos meseros.
  { name: "Lima", hex: "#6ab22a" },
  { name: "Lavanda", hex: "#b493f9" },
];

/** Los colores, en orden: el mesero N lleva el color N. */
export const WAITER_HEXES: readonly string[] = WAITER_PALETTE.map((c) => c.hex);

function rgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number];
}

/**
 * El nombre del color de un mesero («Rojo»). Si el color no es de la paleta
 * (una configuración de antes que todavía no se recoloreó), el del color más
 * parecido.
 */
export function waiterColorName(hex: string | null | undefined): string {
  if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return "sin color";
  const exact = WAITER_PALETTE.find((c) => c.hex === hex.toLowerCase());
  if (exact) return exact.name;
  const [r, g, b] = rgb(hex);
  let best = WAITER_PALETTE[0];
  let bestDistance = Infinity;
  for (const c of WAITER_PALETTE) {
    const [r2, g2, b2] = rgb(c.hex);
    const d = (r - r2) ** 2 + (g - g2) ** 2 + (b - b2) ** 2;
    if (d < bestDistance) {
      bestDistance = d;
      best = c;
    }
  }
  return best.name;
}

/** «Mesero rojo»: como se nombra al mesero en avisos, estadísticas y la IA. */
export function waiterLabel(hex: string | null | undefined): string {
  return hex ? `Mesero ${waiterColorName(hex).toLocaleLowerCase("es")}` : "Mesero sin color";
}

/** Si un nombre de mesero ES un color de la paleta («Rojo»), su color. */
export function paletteHexByName(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = name.trim().toLocaleLowerCase("es");
  return WAITER_PALETTE.find((c) => c.name.toLocaleLowerCase("es") === n)?.hex ?? null;
}

/**
 * Los colores para una configuración nueva de `count` meseros: los primeros
 * de la paleta, todos distintos.
 */
export function paletteFor(count: number): string[] {
  return WAITER_HEXES.slice(0, Math.max(0, Math.min(count, WAITER_HEXES.length)));
}
