// Geometría del mapa.
//
// Vive en su propio archivo porque la necesitan cosas distintas: la copia
// entre restaurantes (paso 3) y la rotación de una zona entera (paso 4), y en
// ambos casos la regla tiene que ser idéntica o el paso 4 deshace lo que hizo
// el 3.
//
// Aquí viven el rectángulo que envuelve a todos los elementos y la
// normalización, que usa la copia de una zona a otra de tamaño distinto, y el
// giro del plano completo, que usa el minimapa (abajo).

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

// ---------------------------------------------------------------------------
// Giro del plano completo (paso 4)
//
// El lienzo gira la zona alrededor de su centro (`viewRotation` en Konva). El
// minimapa tiene que girar IGUAL, y al tocarlo volver del punto girado al del
// plano. Las dos cuentas van aquí para que sean la misma en los dos sentidos.
// ---------------------------------------------------------------------------

/** Tamaño de la zona una vez girada: con 90° o 270° se cruzan ancho y alto. */
export function rotatedSize(width: number, height: number, rotation: number): { width: number; height: number } {
  return Math.abs(rotation) % 180 === 90 ? { width: height, height: width } : { width, height };
}

/**
 * Un punto del plano (sin girar) a coordenadas de la zona girada, que empieza
 * en (0, 0). Positivo es a derechas, como Konva y SVG (el eje y va hacia abajo).
 */
export function planToRotated(
  point: { x: number; y: number },
  width: number,
  height: number,
  rotation: number,
): { x: number; y: number } {
  const size = rotatedSize(width, height, rotation);
  const rad = (rotation * Math.PI) / 180;
  const dx = point.x - width / 2;
  const dy = point.y - height / 2;
  return {
    x: size.width / 2 + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: size.height / 2 + dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}

/** Lo contrario de `planToRotated`: de la zona girada al plano. */
export function rotatedToPlan(
  point: { x: number; y: number },
  width: number,
  height: number,
  rotation: number,
): { x: number; y: number } {
  const size = rotatedSize(width, height, rotation);
  const rad = (-rotation * Math.PI) / 180;
  const dx = point.x - size.width / 2;
  const dy = point.y - size.height / 2;
  return {
    x: width / 2 + dx * Math.cos(rad) - dy * Math.sin(rad),
    y: height / 2 + dx * Math.sin(rad) + dy * Math.cos(rad),
  };
}
