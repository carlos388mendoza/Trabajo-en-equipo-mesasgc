"use client";

// El canvas de Konva: Stage, Layer y los elementos.
//
// Es un Client Component y, además, se carga con `ssr: false` desde
// `editor-client.tsx`. Konva toca el DOM en el momento de importarse
// (`document`, canvas 2D), así que importarlo en el servidor revienta.
//
// La vista (zoom y desplazamiento) se guarda dentro de Konva y NO en estado de
// React a propósito: panear mueve el Stage en cada `dragMove` y pasar eso por
// estado re-renderizaría el árbol entero 60 veces por segundo. Solo se
// notifica el porcentaje de zoom al padre, que lo muestra en la barra.
//
// El giro del plano (`viewRotation`) es solo de la vista: gira un Group que
// envuelve todo el lienzo alrededor de su centro. Los elementos no cambian y
// no se guarda nada (ver README, "Pendiente").

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import type { ReactNode, RefObject } from "react";
import { Group, Layer, Line, Rect, Stage, Transformer } from "react-konva";
import Konva from "konva";

import { ElementNode } from "./element-node";
import { STATUS_COLORS, STATUS_ORDER } from "@/lib/layout/element-style";
import type { ElementTypeInfo, LayoutElement } from "@/lib/layout/types";

export const MIN_SCALE = 0.2;
export const MAX_SCALE = 4;
const ZOOM_STEP = 1.2;
const MIN_SIZE = 24;

// Con dos dedos en pantalla, Konva por defecto deja de detectar qué hay
// debajo mientras algo se arrastra, y el pellizco no llega a empezar.
Konva.hitOnDragEnabled = true;

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
  /** Giro de la vista en grados: 0, 90, 180 o 270. No se guarda. */
  viewRotation: number;
  elements: LayoutElement[];
  typesById: Map<string, ElementTypeInfo>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
  /** Redimensionado mediante el Transformer: tamaño y esquina nuevos. */
  onResize: (
    id: string,
    box: { x: number; y: number; width: number; height: number },
  ) => void;
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
  viewRotation,
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
  const contentRef = useRef<Konva.Group>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const nodesRef = useRef(new Map<string, Konva.Group>());
  // Distancia entre los dos dedos en el último `touchmove` del pellizco.
  const pinchRef = useRef<number | null>(null);

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

  // Pellizco con dos dedos. Mientras dura, ni el Stage ni un elemento se
  // arrastran: el primer dedo había empezado un arrastre y hay que cortarlo.
  const handleTouchMove = useCallback(
    (e: Konva.KonvaEventObject<TouchEvent>) => {
      const touches = e.evt.touches;
      if (touches.length !== 2) {
        pinchRef.current = null;
        return;
      }
      e.evt.preventDefault();
      const stage = stageRef.current;
      if (stage?.isDragging()) stage.stopDrag();
      for (const node of nodesRef.current.values()) {
        if (node.isDragging()) node.stopDrag();
      }

      const [a, b] = [touches[0], touches[1]];
      const distance = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const previous = pinchRef.current;
      pinchRef.current = distance;
      if (previous === null || previous === 0) return;

      zoomAround(
        (a.clientX + b.clientX) / 2,
        (a.clientY + b.clientY) / 2,
        distance / previous,
      );
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
    // Girado 90° o 270°, el plano ocupa en pantalla alto × ancho.
    const sideways = viewRotation % 180 !== 0;
    const shownWidth = sideways ? height : width;
    const shownHeight = sideways ? width : height;
    // "Ajustar" en vez de volver a 100%: si la zona no cabe, se ve entera.
    // El margen deja ver el borde del plano y la sombra.
    const fit = Math.min((rect.width - 32) / shownWidth, (rect.height - 32) / shownHeight, 1);
    const scale = clamp(fit, MIN_SCALE, 1);
    stage.scale({ x: scale, y: scale });
    // El plano gira alrededor de su centro, así que basta con llevar ese
    // centro al del hueco, gire como gire.
    stage.position({
      x: rect.width / 2 - (width / 2) * scale,
      y: rect.height / 2 - (height / 2) * scale,
    });
    onZoomChange(Math.round(scale * 100));
  }, [height, onZoomChange, viewRotation, width]);

  /** Pantalla -> lienzo, teniendo en cuenta zoom, desplazamiento y giro. */
  const toCanvas = useCallback((offsetX: number, offsetY: number) => {
    const content = contentRef.current;
    if (!content) return null;
    return content.getAbsoluteTransform().copy().invert().point({ x: offsetX, y: offsetY });
  }, []);

  useImperativeHandle(
    controllerRef,
    () => ({
      zoomIn: () => zoomByCentre(ZOOM_STEP),
      zoomOut: () => zoomByCentre(1 / ZOOM_STEP),
      resetView,
      screenToStage: (clientX, clientY) => {
        const node = containerRef.current;
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        return toCanvas(clientX - rect.left, clientY - rect.top);
      },
      viewportCenter: () => {
        const node = containerRef.current;
        if (!node) return null;
        const rect = node.getBoundingClientRect();
        return toCanvas(rect.width / 2, rect.height / 2);
      },
    }),
    [resetView, toCanvas, zoomByCentre],
  );

  // Al cambiar de zona o girar el plano, se vuelve a encuadrar.
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
  // lados intermedios, que en un mapa solo estorban. Tiradores grandes y
  // redondos para el dedo. El giro no se hace arrastrando (es difícil de
  // controlar en una tablet), sino con los botones del panel del elemento.
  const transformerConfig = {
    rotateEnabled: false,
    keepRatio: false,
    enabledAnchors: [
      "top-left",
      "top-right",
      "bottom-left",
      "bottom-right",
    ] as Konva.TransformerConfig["enabledAnchors"],
    anchorSize: 18,
    anchorStroke: "#2563eb",
    anchorStrokeWidth: 2,
    anchorFill: "#ffffff",
    anchorCornerRadius: 9,
    borderStroke: "#2563eb",
    borderDash: [4, 3],
    padding: 4,
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

      // El nodo se posiciona por su centro (ver `element-node.tsx`), y Konva
      // escala alrededor del `offset`, así que `x`/`y` ya son el centro nuevo.
      // Tirar de la esquina de arriba a la izquierda también MUEVE el
      // elemento: por eso se devuelve la posición, no solo el tamaño.
      onResize(id, {
        x: Math.round(node.x() - newWidth / 2),
        y: Math.round(node.y() - newHeight / 2),
        width: Math.round(newWidth),
        height: Math.round(newHeight),
      });
      onChange();
    },
    [onChange, onResize],
  );

  // Retícula de fondo: líneas finas cada 25 unidades y más marcadas cada 100,
  // como un papel milimetrado suave. Va en el Layer de abajo y con
  // `listening={false}`: los clics la atraviesan y llegan al Stage, que es lo
  // que hace que tocar el vacío deseleccione.
  const MINOR = 25;
  const MAJOR = 100;
  const gridLines: ReactNode[] = [];
  for (let gx = MINOR; gx < width; gx += MINOR) {
    gridLines.push(
      <Line
        key={`grid-v-${gx}`}
        points={[gx, 0, gx, height]}
        stroke={gx % MAJOR === 0 ? "#e2e8f0" : "#f1f5f9"}
        strokeWidth={1}
        listening={false}
      />,
    );
  }
  for (let gy = MINOR; gy < height; gy += MINOR) {
    gridLines.push(
      <Line
        key={`grid-h-${gy}`}
        points={[0, gy, width, gy]}
        stroke={gy % MAJOR === 0 ? "#e2e8f0" : "#f1f5f9"}
        strokeWidth={1}
        listening={false}
      />,
    );
  }

  // Mismo giro en las dos capas: el suelo y los elementos giran juntos.
  const rotated = {
    x: width / 2,
    y: height / 2,
    offsetX: width / 2,
    offsetY: height / 2,
    rotation: viewRotation,
  };

  const deselectOnEmpty = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    // Toque en el vacío: deseleccionar. Se comprueba que el objetivo sea el
    // propio Stage y no un elemento.
    if (e.target === e.target.getStage()) onSelect(null);
  };

  return (
    <div
      ref={containerRef}
      // `touch-none`: sin esto el navegador de la tablet se queda con el
      // pellizco y hace zoom de la página entera en vez del mapa.
      className="relative h-full w-full touch-none overflow-hidden bg-slate-100"
    >
      {size.width > 0 ? (
        <Stage
          ref={stageRef}
          width={size.width}
          height={size.height}
          draggable={!dragging}
          onWheel={handleWheel}
          onMouseDown={deselectOnEmpty}
          onTouchStart={deselectOnEmpty}
          onTouchMove={handleTouchMove}
          onTouchEnd={() => {
            pinchRef.current = null;
          }}
        >
          <Layer listening={false}>
            <Group {...rotated}>
              <Rect
                x={0}
                y={0}
                width={width}
                height={height}
                cornerRadius={14}
                fill="#ffffff"
                shadowColor="#64748b"
                shadowBlur={18}
                shadowOffsetY={4}
                shadowOpacity={0.18}
              />
              {gridLines}
              <Rect
                x={0}
                y={0}
                width={width}
                height={height}
                cornerRadius={14}
                stroke="#cbd5e1"
                strokeWidth={1.5}
              />
            </Group>
          </Layer>

          <Layer>
            <Group ref={contentRef} {...rotated}>
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
                    occupantName={null}
                    minutes={null}
                    pulse={0}
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
            </Group>

            <Transformer
              {...transformerConfig}
              ref={transformerRef}
              onTransformEnd={handleTransformEnd}
            />
          </Layer>
        </Stage>
      ) : null}

      <StatusLegend />
    </div>
  );
}

/** Leyenda de colores, fija en la esquina: no se mueve con el zoom. */
function StatusLegend() {
  return (
    <div className="pointer-events-none absolute bottom-3 right-3 flex flex-col gap-1.5 rounded-xl bg-white/95 px-3 py-2 text-xs text-neutral-700 shadow-md ring-1 ring-black/5">
      {STATUS_ORDER.map((status) => {
        const colors = STATUS_COLORS[status];
        return (
          <span key={status} className="flex items-center gap-2">
            <span
              aria-hidden
              className="h-3.5 w-3.5 rounded-full border-2"
              style={{ backgroundColor: colors.fill, borderColor: colors.stroke }}
            />
            {colors.label}
          </span>
        );
      })}
    </div>
  );
}
