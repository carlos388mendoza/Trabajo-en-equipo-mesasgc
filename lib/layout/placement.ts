// Dónde cae un elemento nuevo o pegado, y los límites de la zona.
//
// Funciones puras (sin React ni Konva): las usa el editor y las prueba
// `verify:editor`. Todo en unidades del plano; `x`/`y` son la esquina de arriba
// a la izquierda del elemento SIN girar (lo que se guarda), y el elemento gira
// alrededor de su centro.

export type Box = { left: number; top: number; right: number; bottom: number };
export type Placeable = { width: number; height: number; rotation: number };
export type Placed = Placeable & { x: number; y: number };

/** Margen entre elementos al buscar hueco. */
const GAP = 8;
/** Paso de la búsqueda de hueco, en unidades del plano. */
const STEP = 16;

/** Mitad del ancho y del alto que ocupa un elemento girado (caja que lo envuelve). */
export function halfExtent({ width, height, rotation }: Placeable) {
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  return { hx: (width * cos + height * sin) / 2, hy: (width * sin + height * cos) / 2 };
}

/** Caja que ocupa un elemento colocado, girado incluido. */
export function occupiedBox(e: Placed): Box {
  const { hx, hy } = halfExtent(e);
  const cx = e.x + e.width / 2;
  const cy = e.y + e.height / 2;
  return { left: cx - hx, top: cy - hy, right: cx + hx, bottom: cy + hy };
}

function clampCenter(c: number, half: number, min: number, max: number): number {
  // Si el elemento es más grande que el hueco, se centra en él.
  if (max - min <= half * 2) return (min + max) / 2;
  return Math.min(Math.max(c, min + half), max - half);
}

/**
 * Lleva un elemento dentro de la zona (`zone`: ancho y alto del plano),
 * teniendo en cuenta su giro. Devuelve la esquina nueva, redondeada.
 */
export function clampToZone(e: Placed, zone: { width: number; height: number }): { x: number; y: number } {
  const { hx, hy } = halfExtent(e);
  const cx = clampCenter(e.x + e.width / 2, hx, 0, zone.width);
  const cy = clampCenter(e.y + e.height / 2, hy, 0, zone.height);
  return { x: Math.round(cx - e.width / 2), y: Math.round(cy - e.height / 2) };
}

function overlaps(a: Box, b: Box): boolean {
  return a.left < b.right + GAP && a.right + GAP > b.left && a.top < b.bottom + GAP && a.bottom + GAP > b.top;
}

/**
 * Coloca un elemento nuevo (o pegado) DENTRO de lo que se ve:
 *
 *  1. su centro en `preferred` (el centro de la pantalla, o junto al original
 *     al pegar), llevado dentro de la parte visible de la zona;
 *  2. si ahí ya hay otro elemento, el hueco libre más cercano dentro de lo
 *     visible (búsqueda en anillos alrededor del punto preferido);
 *  3. si no hay ningún hueco libre visible, se queda en el punto 1: visible
 *     aunque se solape, mejor que fuera de la pantalla.
 *
 * `visible` es la parte del plano que se ve en pantalla; se recorta a la zona.
 */
export function placeInView(
  item: Placeable,
  preferred: { x: number; y: number },
  visible: Box,
  zone: { width: number; height: number },
  existing: readonly Placed[],
): { x: number; y: number } {
  let area: Box = {
    left: Math.max(0, visible.left),
    top: Math.max(0, visible.top),
    right: Math.min(zone.width, visible.right),
    bottom: Math.min(zone.height, visible.bottom),
  };
  // Si lo visible está fuera de la zona (plano desplazado del todo), la zona.
  if (area.right <= area.left || area.bottom <= area.top) {
    area = { left: 0, top: 0, right: zone.width, bottom: zone.height };
  }
  const { hx, hy } = halfExtent(item);
  const fit = (c: { x: number; y: number }) => ({
    x: clampCenter(c.x, hx, area.left, area.right),
    y: clampCenter(c.y, hy, area.top, area.bottom),
  });
  const boxAt = (c: { x: number; y: number }): Box => ({ left: c.x - hx, top: c.y - hy, right: c.x + hx, bottom: c.y + hy });
  const others = existing.map(occupiedBox);
  const free = (c: { x: number; y: number }) => !others.some((o) => overlaps(boxAt(c), o));
  const corner = (c: { x: number; y: number }) => ({ x: Math.round(c.x - item.width / 2), y: Math.round(c.y - item.height / 2) });

  const start = fit(preferred);
  if (free(start)) return corner(start);

  const maxRing = Math.ceil(Math.max(area.right - area.left, area.bottom - area.top) / STEP);
  for (let ring = 1; ring <= maxRing; ring += 1) {
    // Los puntos del anillo, del más cercano al más lejano.
    const candidates: { x: number; y: number; d: number }[] = [];
    for (let i = -ring; i <= ring; i += 1) {
      for (const [dx, dy] of [[i, -ring], [i, ring], [-ring, i], [ring, i]]) {
        const c = { x: start.x + dx * STEP, y: start.y + dy * STEP };
        if (c.x - hx < area.left || c.x + hx > area.right || c.y - hy < area.top || c.y + hy > area.bottom) continue;
        candidates.push({ ...c, d: Math.hypot(dx, dy) });
      }
    }
    candidates.sort((a, b) => a.d - b.d);
    const hit = candidates.find(free);
    if (hit) return corner(hit);
  }
  return corner(start);
}
