"use client";

// El canvas de Konva:Stage, Layer y los elementos.
//
// Es un Client Component y, además, se carga con `ssr: false` desde
// `editor-client.tsx`. Konva toca el DOM en el momento de importarse
// (`document`, canvas 2D), así que importarlo en el servidor revienta.
//
// La vista (zoom y desplazamiento) se guarda dentro de Konva y NO en estado de
// React a propósito: panear mueve el Stage en cada `dragMove` y pasar eso por
// estado re-renderizaría el árbol entero 60 veces por segundo. Solo se
// notifica el porcentaje de zoom al padre, que lo muestra en la barra.

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { ReactNode, RefObject } from "react";
import { Layer, Line, Rect, Stage, Transformer } from "react-konva";
import type Konva from "konva";

import { ElementNode } from "./element-node";
import type { ElementTypeInfo, LayoutElement } from "@/lib/layout/types";

export const MIN_SCALE = 0.2;
export const MAX_SCALE = 4;
const ZOOM_STEP = 1.2;
const MIN_SIZE = 24;

export type CanvasHandle = {
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
  /** Convierte coordenadas de pantalla a del lienzo. Lo usa el drop. */
  screenToStage: (clientX: number, clientY: number) => { x: number; y: number } | null;
  /**
   * Centro de lo que se ve ahora mismo, en coordenadas del lienzo. Lo usa el
   * "clic para añadir": si no, el elemento caería en el centro del lienzo y
   * no en el de la ventana, que es donde el usuario está mirando.
   */
  viewportCenter: () => { x: number; y: number } | null;
};

type Props = {
  layoutId: string;
  width: number;
  height: number;
  elements: LayoutElement[];
  typesById: Map<string, ElementTypeInfo>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
  /** Redimensionado mediante el Transformer. */
  onResize: (id: string, width: number, height: number) => void;
  onChange: () => void;
  onZoomChange: (percent: number) => void;
  /**
   * El handle se pasa como prop y no como `ref` a propósito: el componente se
   * carga con `next/dynamic({ ssr: false })` y no merece la pena depender de
   * que Next reenvíe los refs a través del `dynamic`.
   */
  controllerRef: RefObject<CanvasHandle | null>;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function KonvaCanvas({
  layoutId,
  width,
  height,
  elements,
  typesById,
  selectedId,
  onSelect,
  onMove,
  onResize,
  onChange,
  onZoomChange,
  controllerRef,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const nodesRef = useRef(new Map<string, Konva.Group>());

  const [size, setSize] = useState({ width: 0, height: 0 });
  // Mientras un elemento se arrastra, el Stage deja de ser arrastrable para
  // que Konva no mueva los dos a la vez.
  const [dragging, setDragging] = useState(false);

  const registerNode = useCallback((id: string, node: Konva.Group | null) => {
    if (node) nodesRef.current.set(id, node);
    else nodesRef.current.delete(id);
  }, []);

  // El Stage ocupa el hueco disponible. Sin esto habría que adivinar un alto
  // fijo y el mapa se descuadra en cuanto cambia el layout de la página.
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;

    const observer = new ResizeObserver(([entry]) => {
      const box = entry.contentRect;
      setSize({ width: Math.floor(box.width), height: Math.floor(box.height) });
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  /**
   * Zoom anclado a un punto de la pantalla.
   *
   * El truco es convertir el puntero a coordenadas del lienzo ANTES de cambiar
   * la escala, y luego recolocar el Stage para que ese punto siga ahí. Si
   * solo se hace `stage.scale()`, el mapa se aleja del cursor y la rueda se
   * siente rota.
   */
  const zoomAround = useCallback(
    (clientX: number, clientY: number, factor: number) => {
      const stage = stageRef.current;
      const node = containerRef.current;
      if (!stage || !node) return;

      const rect = node.getBoundingClientRect();
      const offsetX = clientX - rect.left;
      const offsetY = clientY - rect.top;

      const oldScale = stage.scaleX();
      const pointerInStage = {
        x: (offsetX - stage.x()) / oldScale,
        y: (offsetY - stage.y()) / oldScale,
      };

      const newScale = clamp(oldScale * factor, MIN_SCALE, MAX_SCALE);
      if (newScale === oldScale) return;

      stage.scale({ x: newScale, y: newScale });
      stage.position({
        x: offsetX - pointerInStage.x * newScale,
        y: offsetY - pointerInStage.y * newScale,
      });
      onZoomChange(Math.round(newScale * 100));
    },
    [onZoomChange],
  );

  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      // Sin esto, la rueda hace scroll de la página entera en vez de zoom.
      e.evt.preventDefault();
      const factor = e.evt.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
      zoomAround(e.evt.clientX, e.evt.clientY, factor);
    },
    [zoomAround],
  );

  const zoomByCentre = useCallback(
    (factor: number) => {
      const node = containerRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      zoomAround(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
    },
    [zoomAround],
  );

  const resetView = useCallback(() => {
    const stage = stageRef.current;
    const node = containerRef.current;
    if (!stage || !node) return;

    const rect = node.getBoundingClientRect();
    // "Ajustar" en vez de volver a 100%: si la zona no cabe, se ve entera.
    const fit = Math.min(
      rect.width / width,
      rect.height / height,
      1,
    );
    const scale = clamp(fit, MIN_SCALE, 1);
    stage.scale({ x: scale, y: scale });
    stage.position({
      x: (rect.width - width * scale) / 2,
      y: (rect.height - height * scale) / 2,
    });
    onZoomChange(Math.round(scale * 100));
  }, [height, onZoomChange, width]);

  useImperativeHandle(
    controllerRef,
    () => ({
      zoomIn: () => zoomByCentre(ZOOM_STEP),
      zoomOut: () => zoomByCentre(1 / ZOOM_STEP),
      resetView,
      screenToStage: (clientX, clientY) => {
        const stage = stageRef.current;
        const node = containerRef.current;
        if (!stage || !node) return null;
        const rect = node.getBoundingClientRect();
        return {
          x: (clientX - rect.left - stage.x()) / stage.scaleX(),
          y: (clientY - rect.top - stage.y()) / stage.scaleY(),
        };
      },
      viewportCenter: () => {
        const stage = stageRef.current;
        const node = containerRef.current;
        if (!stage || !node) return null;
        const rect = node.getBoundingClientRect();
        return {
          x: (rect.width / 2 - stage.x()) / stage.scaleX(),
          y: (rect.height / 2 - stage.y()) / stage.scaleY(),
        };
      },
    }),
    [resetView, zoomByCentre],
  );

  // Al cambiar de zona, la vista de la anterior no tiene sentido.
  useEffect(() => {
    resetView();
  }, [layoutId, resetView]);

  // El Transformer sigue siempre al elemento seleccionado. `elements.length`
  // en las dependencias cubre que el nodo se monte o se desmonte; la posición
  // no hace falta porque Konva ya sigue al nodo mientras se mueve.
  useEffect(() => {
    const transformer = transformerRef.current;
    if (!transformer) return;

    const node = selectedId ? nodesRef.current.get(selectedId) : undefined;
    transformer.nodes(node ? [node] : []);
    transformer.getLayer()?.batchDraw();
  }, [selectedId, elements.length]);

  // `Transformer` en una sola pieza: 4 tiradores de esquina, sin los de los
  // lados intermedios, que en un mapa solo estorban. La rotación se desactiva
  // porque los tipos de `element_types` no traen ángulo; la columna
  // `rotation` se queda a 0 y ya se podrá aprovechar en el paso 4.
  const transformerConfig = {
    rotateEnabled: false,
    keepRatio: false,
    enabledAnchors: [
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
    ] as Konva.TransformerConfig["enabledAnchors"],
    anchorSize: 9,
    anchorStroke: "#2563eb",
    anchorFill: "#ffffff",
    anchorCornerRadius: 2,
    borderStroke: "#2563eb",
    borderDash: [4, 3],
  };

  const handleTransformEnd = useCallback(
    (e: Konva.KonvaEventObject<Event>) => {
      const node = e.target;
      const id = node.id();
      const scaleX = node.scaleX();
      const scaleY = node.scaleY();

      // Konva termina el redimensionado cambiando la escala del nodo. Se
      // deshace y se convierte en tamaño real, que es lo que se guarda.
      node.scaleX(1);
      node.scaleY(1);

      const newWidth = Math.max(MIN_SIZE, node.width() * scaleX);
      const newHeight = Math.max(MIN_SIZE, node.height() * scaleY);
      node.width(newWidth);
      node.height(newHeight);

      onResize(id, Math.round(newWidth), Math.round(newHeight));
      onChange();
    },
    [onChange, onResize],
  );

  // Retícula de fondo cada GRID unidades. Va en el Layer de abajo y con
  // `listening={false}`: los clics la atraviesan y llegan al Stage, que es lo
  // que hace que hacer clic en el vacío deseleccione.
  const GRID = 50;
  const gridLines: ReactNode[] = [];
  for (let gx = GRID; gx < width; gx += GRID) {
    gridLines.push(
      <Line
        key={`grid-v-${gx}`}
        points={[gx, 0, gx, height]}
        stroke="#e5e7eb"
        strokeWidth={1}
        listening={false}
      />,
    );
  }
  for (let gy = GRID; gy < height; gy += GRID) {
    gridLines.push(
      <Line
        key={`grid-h-${gy}`}
        points={[0, gy, width, gy]}
        stroke="#e5e7eb"
        strokeWidth={1}
        listening={false}
      />,
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden bg-neutral-200"
    >
      {size.width > 0 ? (
        <Stage
          ref={stageRef}
          width={size.width}
          height={size.height}
          draggable={!dragging}
          onWheel={handleWheel}
          onMouseDown={(e) => {
            // Clic en el vacío: deseleccionar. Se comprueba que el objetivo
            // sea el propio Stage y no un elemento.
            if (e.target === e.target.getStage()) onSelect(null);
          }}
        >
          <Layer listening={false}>
            <Rect
              x={0}
              y={0}
              width={width}
              height={height}
              fill="#f9fafb"
              shadowColor="#9ca3af"
              shadowBlur={12}
              shadowOpacity={0.4}
            />
            {gridLines}
            <Rect
              x={0}
              y={0}
              width={width}
              height={height}
              stroke="#9ca3af"
              strokeWidth={1}
            />
          </Layer>

          <Layer>
            {elements.map((element) => {
              const type = typesById.get(element.elementTypeId);
              // Un elemento cuyo tipo se borró del catálogo no se dibuja, pero
              // tampoco rompe el mapa entero.
              if (!type) return null;
              return (
                <ElementNode
                  key={element.id}
                  element={element}
                  type={type}
                  selected={element.id === selectedId}
                  onSelect={onSelect}
                  onDragStart={() => setDragging(true)}
                  onDragMove={onMove}
                  onDragEnd={() => {
                    setDragging(false);
                    onChange();
                  }}
                  registerNode={registerNode}
                />
              );
            })}

            <Transformer
              {...transformerConfig}
              ref={transformerRef}
              onTransformEnd={handleTransformEnd}
            />
          </Layer>
        </Stage>
      ) : null}
    </div>
  );
}
