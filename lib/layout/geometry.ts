// Geometría del mapa.
//
// Vive en su propio archivo porque la necesitan cosas distintas: la copia
// entre restaurantes (paso 3) y la rotación de una zona entera (paso 4), y en
// ambos casos la regla tiene que ser idéntica o el paso 4 deshace lo que hizo
// el 3.
//
// Lo único que vive aquí por ahora es el rectángulo que envuelve a todos los
// elementos y la normalización, que usa la copia de una zona a otra de tamaño
// distinto. La matemática de rotación se añade en el paso 4, cuando exista
// quien la use, y no antes.

export type Box = { x: number; y: number; width: number; height: number };

/** El rectángulo que envuelve a todos los elementos. */
export function boundingBox(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const b of boxes) {
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.width);
    maxY = Math.max(maxY, b.y + b.height);
  }

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/** Desplaza todos los elementos para que el conjunto empiece en (0, 0). */
export function normalize(boxes: readonly Box[]): Box[] {
  const bounds = boundingBox(boxes);
  if (!bounds) return [];
  return boxes.map((b) => ({ ...b, x: b.x - bounds.x, y: b.y - bounds.y }));
}
