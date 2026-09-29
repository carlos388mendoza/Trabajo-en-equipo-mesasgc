// Íconos del editor: los mismos en la paleta, en la barra y en el lienzo.
//
// El DOM usa `lucide-react`. Konva no puede pintar componentes de React, así
// que el lienzo usa el paquete gemelo `lucide`, que expone el MISMO dibujo
// como datos (una lista de `path`, `rect`, `circle`...). Los dos paquetes van
// fijados a la misma versión exacta en `package.json`: si se separaran, un
// ícono podría verse distinto en la paleta y en el mapa.

import type { LucideIcon } from "lucide-react";
import { Banknote, BrickWall, DoorOpen, Puzzle, Shapes, Sofa, Toilet, Utensils, Wine } from "lucide-react";
import {
  Banknote as BanknoteNode,
  BrickWall as BrickWallNode,
  DoorOpen as DoorOpenNode,
  type IconNode,
  Puzzle as PuzzleNode,
  Shapes as ShapesNode,
  Sofa as SofaNode,
  Toilet as ToiletNode,
  Utensils as UtensilsNode,
  Wine as WineNode,
} from "lucide";

/** Grosor de trazo de todos los íconos, en unidades del viewBox de 24. */
export const ICON_STROKE = 2;

type TypeIcon = { component: LucideIcon; node: IconNode };

// Por la `key` del tipo, como la forma (ver `element-style.ts`): el ícono es
// parte de cómo se dibuja un tipo, no un dato que se edite en la tabla.
const TYPE_ICONS: Record<string, TypeIcon> = {
  "mesa-sillas": { component: Utensils, node: UtensilsNode },
  "mesa-butacas": { component: Sofa, node: SofaNode },
  "area-juegos": { component: Puzzle, node: PuzzleNode },
  bano: { component: Toilet, node: ToiletNode },
  caja: { component: Banknote, node: BanknoteNode },
  barra: { component: Wine, node: WineNode },
  puerta: { component: DoorOpen, node: DoorOpenNode },
  pared: { component: BrickWall, node: BrickWallNode },
};

/** Un tipo nuevo del catálogo se ve con un ícono genérico, no vacío. */
const FALLBACK: TypeIcon = { component: Shapes, node: ShapesNode };

export function typeIcon(typeKey: string): TypeIcon {
  return TYPE_ICONS[typeKey] ?? FALLBACK;
}

/** SVG de un ícono de `lucide` con los atributos que usa `lucide-react`. */
export function iconSvg(node: IconNode, color: string, size: number): string {
  const escape = (v: string) => v.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  const body = node
    .map(([tag, attrs]) => {
      const list = Object.entries(attrs)
        .map(([k, v]) => `${k}="${escape(String(v))}"`)
        .join(" ");
      return `<${tag} ${list}/>`;
    })
    .join("");
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
    `viewBox="0 0 24 24" fill="none" stroke="${escape(color)}" ` +
    `stroke-width="${ICON_STROKE}" stroke-linecap="round" stroke-linejoin="round">` +
    `${body}</svg>`
  );
}
