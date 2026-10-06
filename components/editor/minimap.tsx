"use client";

// Minimapa: el plano completo en pequeño, con un rectángulo que marca la parte
// que se ve. Tocarlo (o arrastrar sobre él) lleva la vista a ese punto.
//
// Es SVG en el DOM, no un segundo Stage de Konva: son unas pocas formas y así
// no duplica el coste del lienzo. La parte visible llega como un polígono en
// coordenadas del plano (con el giro de la vista puede no ser un rectángulo
// alineado) desde una suscripción propia: panear actualiza SOLO el minimapa,
// no el editor entero.

import { useRef, useSyncExternalStore } from "react";

import { elementStyle, visualStatus } from "@/lib/layout/element-style";
import { rotatedSize, rotatedToPlan } from "@/lib/layout/geometry";
import type { ElementTypeInfo, LayoutElement } from "@/lib/layout/types";
import { type Theme, withAlpha } from "@/lib/theme/theme";

export type ViewPolygon = { x: number; y: number }[] | null;

type Props = {
  width: number;
  height: number;
  /**
   * Giro del plano completo, el mismo que el del lienzo: el minimapa se dibuja
   * girado igual, o el rectángulo de "lo que se ve" no cuadraría con la vista.
   */
  rotation: number;
  elements: LayoutElement[];
  typesById: Map<string, ElementTypeInfo>;
  theme: Theme;
  subscribeView: (listener: () => void) => () => void;
  getView: () => ViewPolygon;
  /** Centra la vista en ese punto del plano. */
  onJump: (x: number, y: number) => void;
};

const MAX_WIDTH = 160;
const MAX_HEIGHT = 104;

export function Minimap({
  width,
  height,
  rotation,
  elements,
  typesById,
  theme,
  subscribeView,
  getView,
  onJump,
}: Props) {
  const view = useSyncExternalStore(subscribeView, getView, () => null);
  const svgRef = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);

  // Con 90° o 270° el minimapa pasa a ser alto en vez de ancho.
  const turned = rotatedSize(width, height, rotation);
  const scale = Math.min(MAX_WIDTH / turned.width, MAX_HEIGHT / turned.height);
  const shownWidth = Math.round(turned.width * scale);
  const shownHeight = Math.round(turned.height * scale);

  const jumpTo = (clientX: number, clientY: number) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    // El toque cae en el minimapa girado: se vuelve al punto del plano.
    const point = rotatedToPlan(
      {
        x: ((clientX - rect.left) / rect.width) * turned.width,
        y: ((clientY - rect.top) / rect.height) * turned.height,
      },
      width,
      height,
      rotation,
    );
    onJump(Math.max(0, Math.min(width, point.x)), Math.max(0, Math.min(height, point.y)));
  };

  return (
    <div className="rounded-2xl bg-panel/95 p-2 shadow-lg ring-1 ring-app-border">
      <svg
        ref={svgRef}
        role="img"
        aria-label="Minimapa del plano. Toca para ir a esa zona."
        width={shownWidth}
        height={shownHeight}
        viewBox={`0 0 ${turned.width} ${turned.height}`}
        className="block cursor-pointer touch-none rounded-lg"
        onPointerDown={(e) => {
          dragging.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          jumpTo(e.clientX, e.clientY);
        }}
        onPointerMove={(e) => {
          if (dragging.current) jumpTo(e.clientX, e.clientY);
        }}
        onPointerUp={() => {
          dragging.current = false;
        }}
      >
        {/* Todo el dibujo va en coordenadas del plano, girado alrededor de su
            centro como el Group del lienzo. */}
        <g
          transform={`translate(${turned.width / 2} ${turned.height / 2}) rotate(${rotation}) translate(${-width / 2} ${-height / 2})`}
        >
          <rect
            x={0}
            y={0}
            width={width}
            height={height}
            rx={24}
            fill={theme.mapBg}
            stroke={theme.line}
            strokeWidth={8}
          />
          {elements.map((e) => {
            const type = typesById.get(e.elementTypeId);
            if (!type) return null;
            const style = elementStyle(type);
            // La pared va del color de las paredes del local, como en el lienzo.
            const color = style.seatable
              ? theme.status[visualStatus(e)].stroke
              : style.shape === "wall"
                ? theme.line
                : type.color;
            const cx = e.x + e.width / 2;
            const cy = e.y + e.height / 2;
            return style.shape === "circle" ? (
              <circle
                key={e.id}
                cx={cx}
                cy={cy}
                r={Math.min(e.width, e.height) / 2}
                fill={color}
              />
            ) : (
              <rect
                key={e.id}
                x={e.x}
                y={e.y}
                width={e.width}
                height={e.height}
                rx={style.shape === "wall" ? 2 : 10}
                fill={withAlpha(color, style.seatable || style.shape === "wall" ? 1 : 0.6)}
                transform={e.rotation ? `rotate(${e.rotation} ${cx} ${cy})` : undefined}
              />
            );
          })}
          {view ? (
            <polygon
              points={view.map((p) => `${p.x},${p.y}`).join(" ")}
              fill={withAlpha(theme.accent, 0.14)}
              stroke={theme.accent}
              strokeWidth={Math.max(4, 2 / scale)}
              strokeLinejoin="round"
            />
          ) : null}
        </g>
      </svg>
    </div>
  );
}
