// Qué texto cabe dentro de una mesa del plano en vivo, y de qué tamaño.
//
// El plano en vivo se mira de lejos y con prisa: cada mesa lleva solo su
// nombre en grande y, si está ocupada y hay sitio, el cliente en corto con sus
// personas y el tiempo que lleva. Todo DENTRO de la mesa (antes las píldoras
// del cliente y del mesero colgaban fuera y se pisaban con la mesa de al lado).
//
// Los tamaños se piensan en PÍXELES DE PANTALLA (lo que de verdad se lee) y se
// pasan a unidades del plano dividiendo por la escala de la vista. Así la letra
// nunca baja de 12 px: si con el zoom alejado ya no cabe, se queda solo el
// nombre de la mesa (o su forma corta, «M12»), y al acercar vuelven el cliente
// y el tiempo.
//
// Funciones puras (sin Konva ni React): las prueba `verify:editor`. El ancho
// de cada texto lo mide quien llama (en el navegador, con un canvas); sin
// medidor se usa una estimación prudente.

/** Letra mínima en pantalla, en px. */
export const LIVE_MIN_FONT = 12;
/** Letra máxima del nombre de la mesa, en px. */
export const LIVE_MAX_LABEL_FONT = 22;
/** Debajo de este lado (px) la marca del mesero (su inicial) no se dibuja. */
export const LIVE_MIN_SIDE_FOR_BADGE = 44;
/**
 * Cuánto crece una mesa con sillas en el plano en vivo (unidades del plano):
 * ahí no se dibujan las sillas, y la mesa ocupa su sitio. Es lo que ya medían
 * las sillas en el editor, así que dos mesas vecinas no llegan a tocarse.
 */
export const LIVE_GROW_WITH_SEATS = 14;
export const LIVE_GROW_WITHOUT_SEATS = 3;

/** Ancho de `text` en px con esa letra (negrita o no). */
export type MeasureText = (text: string, px: number, bold: boolean) => number;

/** Estimación sin canvas: ancho medio por letra (negrita un poco más). */
export const estimateText: MeasureText = (text, px, bold) => text.length * px * (bold ? 0.62 : 0.56);

export type LiveLine = {
  text: string;
  /** Arriba de la línea, desde el centro de la mesa (unidades del plano). */
  y: number;
  /** Letra, en unidades del plano. */
  font: number;
  /** Ancho útil de esa línea (unidades del plano): el texto se centra en él. */
  width: number;
  bold: boolean;
};

/**
 * El tamaño de la mesa tal como se ve: si entre su giro y el de la vista
 * queda de lado, ancho y alto se intercambian; en un ángulo raro se usa el
 * cuadrado del lado menor (lo que seguro cabe).
 */
export function visibleBox(width: number, height: number, rotation: number): { w: number; h: number } {
  const angle = ((rotation % 180) + 180) % 180;
  if (angle < 1 || angle > 179) return { w: width, h: height };
  if (Math.abs(angle - 90) < 1) return { w: height, h: width };
  const side = Math.min(width, height);
  return { w: side, h: side };
}

/**
 * Las líneas de texto de una mesa: el nombre (en una o dos líneas) y, si
 * caben enteros, el cliente («Ana T. · 4») y el tiempo («1 h 20 min»).
 *
 * @param box   tamaño visible de la mesa (unidades del plano)
 * @param round mesa redonda: cada línea mide la cuerda del círculo a su altura
 * @param scale escala de la vista (px de pantalla por unidad del plano)
 * @param texts `who` admite varias versiones, de la más completa a la más corta
 */
export function liveTextLines(
  box: { w: number; h: number },
  round: boolean,
  scale: number,
  texts: { label: string; who?: readonly string[] | null; time?: string | null },
  measure: MeasureText = estimateText,
): LiveLine[] {
  const W = box.w * scale;
  const H = box.h * scale;
  const radius = Math.min(W, H) / 2;
  // Ancho útil a la altura [top, bottom] (px, desde el centro).
  const widthAt = (top: number, bottom: number) => {
    if (!round) return W * 0.86;
    const far = Math.max(Math.abs(top), Math.abs(bottom));
    return far >= radius ? 0 : 2 * Math.sqrt(radius * radius - far * far) * 0.9;
  };
  const innerH = H * (round ? 0.84 : 0.86);
  const fits = (text: string, px: number, bold: boolean, top: number) => measure(text, px, bold) <= widthAt(top, top + px);
  const toPlan = (px: number) => px / scale;
  const line = (text: string, top: number, px: number, bold: boolean): LiveLine => ({
    text,
    y: toPlan(top),
    font: toPlan(px),
    width: toPlan(Math.max(widthAt(top, top + px), px * 2)),
    bold,
  });

  // El nombre de la mesa en una línea: lo más grande que quepa, sin bajar
  // de 12 px. null si ni así cabe.
  const labelPx = (maxPx: number, top: (px: number) => number): number | null => {
    for (let px = Math.min(maxPx, LIVE_MAX_LABEL_FONT); px >= LIVE_MIN_FONT; px -= 1) {
      if (fits(texts.label, px, true, top(px))) return px;
    }
    return null;
  };

  const time = texts.time ?? null;
  for (const who of texts.who ?? []) {
    // Con cliente: tres líneas (nombre, cliente, tiempo), del mayor tamaño
    // que entre; si ni con la letra mínima caben enteras, se prueba la
    // versión más corta del cliente, y al final solo el nombre.
    for (let labelMax = Math.min(LIVE_MAX_LABEL_FONT, innerH * 0.3); labelMax >= LIVE_MIN_FONT; labelMax -= 1) {
      const detail = Math.max(LIVE_MIN_FONT, Math.min(15, labelMax * 0.72));
      const gap = 3;
      const total = labelMax + gap + detail * 1.15 * (time ? 2 : 1);
      if (total > innerH) continue;
      const top = -total / 2;
      const whoTop = top + labelMax + gap;
      const timeTop = whoTop + detail * 1.15;
      if (!fits(who, detail, false, whoTop) || (time && !fits(time, detail, true, timeTop))) continue;
      const px = labelPx(labelMax, () => top);
      if (px === null) continue;
      const lines = [line(texts.label, top, px, true), line(who, whoTop, detail, false)];
      if (time) lines.push(line(time, timeTop, detail, true));
      return lines;
    }
  }

  // Solo el nombre: en una línea…
  const single = labelPx(Math.max(LIVE_MIN_FONT, innerH * 0.32), (px) => -px / 2);
  if (single !== null) return [line(texts.label, -single / 2, single, true)];
  // …en dos («Bancada / terraza»), si tiene espacios y caben…
  const words = texts.label.trim().split(/\s+/);
  if (words.length > 1) {
    const cut = Math.ceil(words.length / 2);
    const [a, b] = [words.slice(0, cut).join(" "), words.slice(cut).join(" ")];
    for (let px = Math.min(16, innerH * 0.4); px >= LIVE_MIN_FONT; px -= 1) {
      const top = -px * 1.1;
      if (px * 2.2 <= innerH && fits(a, px, true, top) && fits(b, px, true, top + px * 1.1)) {
        return [line(a, top, px, true), line(b, top + px * 1.1, px, true)];
      }
    }
  }
  // …o en su forma corta («Mesa 12» → «M12»), que con el zoom alejado
  // sigue diciendo qué mesa es.
  return [line(compactLabel(texts.label), -LIVE_MIN_FONT / 2, LIVE_MIN_FONT, true)];
}

/** «Mesa 12» → «M12», «Terraza 3» → «T3», «Bancada terraza» → «BT». */
export function compactLabel(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean);
  const letters = words
    .filter((word) => !/^\d+$/.test(word))
    .map((word) => word[0].toLocaleUpperCase("es"))
    .join("");
  const number = label.match(/(\d+)\s*$/)?.[1] ?? "";
  return letters.slice(0, 2) + number || label;
}

/**
 * La escala de la vista, redondeada HACIA ABAJO a escalones de ~12 % (así la
 * letra calculada con ella nunca sale menor en pantalla). Las mesas solo se
 * vuelven a dibujar cuando cambia el escalón (al terminar un pellizco), no en
 * cada cuadro. Así el plano en vivo sigue a 60 FPS.
 */
export function scaleStep(scale: number): number {
  const step = Math.log(1.12);
  return Number(Math.exp(Math.floor(Math.log(Math.max(scale, 0.05)) / step + 1e-9) * step).toFixed(4));
}
