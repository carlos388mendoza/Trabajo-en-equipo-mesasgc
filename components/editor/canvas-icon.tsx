"use client";

// Un ícono de lucide dentro del lienzo de Konva.
//
// Se convierte a SVG y se pinta como imagen. Así es exactamente el mismo
// dibujo que en la paleta, con el mismo grosor, en vez de reinterpretarlo con
// formas de Konva.
//
// El SVG se pasa a un mapa de bits (un <canvas>) UNA vez. Dibujar una imagen
// SVG obliga al navegador a volver a interpretarla en cada fotograma; con 40
// mesas, era la mitad del tiempo de cada movimiento en una tablet.

import { useEffect, useMemo, useRef } from "react";
import { Image as KonvaImage } from "react-konva";
import type Konva from "konva";
import type { IconNode } from "lucide";

import { iconSvg } from "./icons";

// El SVG se rasteriza a este tamaño y Konva lo reduce: con zoom o en una
// pantalla de tablet (2x o 3x) se sigue viendo nítido.
const RASTER_SIZE = 96;

// Un mapa de bits por ícono y color para todo el mapa: 40 mesas iguales no
// cargan 40 veces el mismo SVG.
type IconBitmap = { canvas: HTMLCanvasElement; ready: boolean; waiting: Set<() => void> };
const cache = new Map<string, IconBitmap>();

function iconBitmap(node: IconNode, color: string): IconBitmap {
  const key = `${color}|${JSON.stringify(node)}`;
  let entry = cache.get(key);
  if (!entry) {
    const canvas = document.createElement("canvas");
    canvas.width = RASTER_SIZE;
    canvas.height = RASTER_SIZE;
    const created: IconBitmap = { canvas, ready: false, waiting: new Set() };
    const image = new window.Image();
    image.onload = () => {
      canvas.getContext("2d")?.drawImage(image, 0, 0, RASTER_SIZE, RASTER_SIZE);
      created.ready = true;
      created.waiting.forEach((redraw) => redraw());
      created.waiting.clear();
    };
    image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
      iconSvg(node, color, RASTER_SIZE),
    )}`;
    cache.set(key, created);
    entry = created;
  }
  return entry;
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
  const bitmap = useMemo(() => iconBitmap(node, color), [node, color]);

  // La primera vez que aparece un ícono, el SVG tarda un instante en cargarse
  // y Konva ya pintó el lienzo vacío. Al terminar, se vuelve a pintar.
  useEffect(() => {
    if (bitmap.ready) return;
    const redraw = () => ref.current?.getLayer()?.batchDraw();
    bitmap.waiting.add(redraw);
    return () => {
      bitmap.waiting.delete(redraw);
    };
  }, [bitmap]);

  return (
    <KonvaImage
      ref={ref}
      image={bitmap.canvas}
      perfectDrawEnabled={false}
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
