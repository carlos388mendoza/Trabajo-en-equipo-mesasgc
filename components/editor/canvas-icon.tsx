"use client";

// Un ícono de lucide dentro del lienzo de Konva.
//
// Se convierte a SVG y se pinta como imagen. Así es exactamente el mismo
// dibujo que en la paleta, con el mismo grosor, en vez de reinterpretarlo con
// formas de Konva.

import { useEffect, useMemo, useRef } from "react";
import { Image as KonvaImage } from "react-konva";
import type Konva from "konva";
import type { IconNode } from "lucide";

import { iconSvg } from "./icons";

// El SVG se rasteriza a este tamaño y Konva lo reduce: con zoom o en una
// pantalla de tablet (2x o 3x) se sigue viendo nítido.
const RASTER_SIZE = 96;

// Una imagen por ícono y color para todo el mapa: 40 mesas iguales no cargan
// 40 veces el mismo SVG.
const cache = new Map<string, HTMLImageElement>();

function iconImage(node: IconNode, color: string): HTMLImageElement {
  const key = `${color}|${JSON.stringify(node)}`;
  let image = cache.get(key);
  if (!image) {
    image = new window.Image();
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
      iconSvg(node, color, RASTER_SIZE),
    )}`;
    cache.set(key, image);
  }
  return image;
}

type Props = {
  node: IconNode;
  color: string;
  /** Lado del ícono en unidades del lienzo. */
  size: number;
  /** Centro del ícono. */
  x: number;
  y: number;
  opacity?: number;
  /** Para contrarrestar el giro del elemento y que el ícono no se tuerza. */
  rotation?: number;
};

export function CanvasIcon({ node, color, size, x, y, opacity = 1, rotation = 0 }: Props) {
  const ref = useRef<Konva.Image>(null);
  const image = useMemo(() => iconImage(node, color), [node, color]);

  // La primera vez que aparece un ícono, la imagen tarda un instante en
  // cargarse y Konva ya pintó sin ella. Al terminar, se vuelve a pintar.
  useEffect(() => {
    if (image.complete) return;
    const redraw = () => ref.current?.getLayer()?.batchDraw();
    image.addEventListener("load", redraw);
    return () => image.removeEventListener("load", redraw);
  }, [image]);

  return (
    <KonvaImage
      ref={ref}
      image={image}
      x={x}
      y={y}
      width={size}
      height={size}
      offsetX={size / 2}
      offsetY={size / 2}
      rotation={rotation}
      opacity={opacity}
      listening={false}
    />
  );
}
