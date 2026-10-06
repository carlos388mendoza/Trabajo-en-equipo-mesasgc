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
// El giro del plano (`viewRotation`) gira un Group que envuelve todo el lienzo
// alrededor de su centro. Los elementos no cambian; el giro se guarda aparte,
// en `table_layouts.rotation` (ver README, «Giro del plano completo»).

import {
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  startTransition,
} from "react";
import type { RefObject } from "react";
import { Group, Layer, Rect, Shape, Stage, Transformer } from "react-konva";
import Konva from "konva";

import { ElementNode } from "./element-node";
import { Minimap, type ViewPolygon } from "./minimap";
import { STATUS_LABELS, STATUS_ORDER } from "@/lib/layout/element-style";
import type { Theme } from "@/lib/theme/theme";
import { useResolvedTheme } from "@/lib/theme/use-theme";
import type { ElementTypeInfo, LayoutElement } from "@/lib/layout/types";

export const MIN_SCALE = 0.2;
export const MAX_SCALE = 4;
/**
 * Hasta dónde acerca «Ajustar» cuando hay pocas mesas: lo justo para que
 * cada mesa se vea grande sin que una sola llene la pantalla.
 */
const FIT_MAX_SCALE = 1.6;
/** Margen alrededor de las mesas al encuadrar: sillas, nombre, mesero y cliente. */
const FIT_PADDING = 70;
const ZOOM_STEP = 1.2;
const MIN_SIZE = 24;

// Rendimiento en tablet y celular (ver README, «Editor fluido en tablet»):
//
//  - Densidad de píxeles como mucho 2: una pantalla de 3x pinta 2,25 veces
//    más píxeles que una de 2x y no se nota la diferencia en un plano.
//  - El pellizco se escucha con eventos táctiles NATIVOS del contenedor (ver
//    abajo), no con los de Konva. Así Konva no tiene que recalcular a qué
//    elemento toca cada dedo mientras algo se arrastra (`hitOnDragEnabled`),
//    que costaba un repintado extra en cada movimiento.
if (typeof window !== "undefined") {
  Konva.pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
}
Konva.hitOnDragEnabled = false;

/** Mesero de una mesa en la configuración que se está mirando: color y nombre. */
export type CanvasWaiterMark = { color: string; label: string };

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
  /**
   * La parte del plano que se ve en pantalla, en coordenadas del plano. Las
   * mesas nuevas se colocan dentro (ver `lib/layout/placement.ts`).
   */
  visibleBox: () => { left: number; top: number; right: number; bottom: number } | null;
  /**
   * Si un elemento queda fuera de lo que se ve (o pegado al borde), mueve el
   * plano para que quede a la vista. No cambia el zoom.
   */
  revealElement: (id: string) => void;
};

type Props = {
  layoutId: string;
  width: number;
  height: number;
  /** Giro de la vista en grados: 0, 90, 180 o 270. No se guarda. */
  viewRotation: number;
  /** Alto que tapan los paneles flotantes de arriba, para encuadrar debajo. */
  topInset?: number;
  elements: LayoutElement[];
  /** Contador por mesa que cambia con cada evento en vivo: dispara el pulso. */
  pulses: Record<string, number>;
  /** Hora actual en ms. La avanza el editor para el contador de minutos. */
  now: number;
  typesById: Map<string, ElementTypeInfo>;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  /** Justo antes de arrastrar o redimensionar: el editor guarda la foto para Deshacer. */
  onEditStart: () => void;
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
  /**
   * Plano en vivo (/mapa, /restaurante/[id]/mapa): se puede mirar, panear y
   * hacer zoom, pero las mesas no se arrastran ni se redimensionan. El
   * llamador pasa además `selectedId={null}` y un `onSelect` vacío.
   */
  readOnly?: boolean;
  /**
   * Zonas de meseros: mesa → color y nombre del mesero. Las mesas con marca
   * salen teñidas de ese color y con el nombre encima.
   */
  waiterMarks?: Record<string, CanvasWaiterMark>;
  /**
   * Toque (clic o tap) sobre un elemento. Lo usa el reparto de meseros para
   * pintar mesas. No sustituye a `onSelect`, que sigue llegando.
   */
  onElementTap?: (id: string) => void;
  /**
   * Selección en grupo: con esto, arrastrar sobre el vacío dibuja un
   * rectángulo (en vez de mover la vista) y al soltar devuelve las mesas
   * cuyo centro quedó dentro.
   */
  onMarquee?: (ids: string[]) => void;
};

/**
 * Minutos que lleva sentado el cliente, o null si la mesa está libre o no se
 * sabe la hora. Solo las mesas ocupadas reciben un número: así el `memo` de
 * las demás no se rompe cada vez que avanza el reloj.
 */
function minutesSeated(element: LayoutElement, now: number): number | null {
  if (!element.currentEntryId || element.seatedAt === null) return null;
  return Math.max(0, Math.floor((now - element.seatedAt) / 60_000));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function KonvaCanvas({
  layoutId,
  width,
  height,
  viewRotation,
  topInset = 0,
  elements,
  pulses,
  now,
  typesById,
  selectedId,
  onSelect,
  onEditStart,
  onMove,
  onResize,
  onChange,
  onZoomChange,
  controllerRef,
  readOnly = false,
  waiterMarks,
  onElementTap,
  onMarquee,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const contentRef = useRef<Konva.Group>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const nodesRef = useRef(new Map<string, Konva.Group>());

  // Los callbacks del padre se leen por ref: así los que se pasan a cada mesa
  // son SIEMPRE los mismos y el `memo` de `ElementNode` funciona. Si no, cada
  // render del editor (y hay uno por cada cambio de estado) volvía a pintar
  // todas las mesas aunque no hubiera cambiado ninguna.
  const callbacks = useRef({ onSelect, onElementTap, onEditStart, onMove, onChange, onZoomChange });
  useEffect(() => {
    callbacks.current = { onSelect, onElementTap, onEditStart, onMove, onChange, onZoomChange };
  });

  const [size, setSize] = useState({ width: 0, height: 0 });
  // Capa de arrastre: mientras se arrastra una mesa, vive aquí (ver
  // `handleNodeDragStart`).
  const dragGroupRef = useRef<Konva.Group>(null);
  const dragOrigin = useRef<{ id: string; index: number } | null>(null);
  // Rectángulo de la selección en grupo, en píxeles del contenedor. El ref
  // es para los manejadores de Konva, que leen el valor del momento.
  const [marquee, setMarquee] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const marqueeRef = useRef(marquee);
  useEffect(() => {
    marqueeRef.current = marquee;
  });

  const registerNode = useCallback((id: string, node: Konva.Group | null) => {
    if (node) nodesRef.current.set(id, node);
    else nodesRef.current.delete(id);
  }, []);

  const theme = useResolvedTheme();

  // --- Parte visible, para el minimapa --------------------------------------
  //
  // La vista vive en Konva (ver cabecera), así que el minimapa no puede leerla
  // de un estado de React. Se publica aquí: las 4 esquinas de la pantalla
  // pasadas a coordenadas del plano, como mucho una vez por fotograma, y solo
  // el minimapa se suscribe. Panear no re-renderiza el editor.
  const viewRef = useRef<ViewPolygon>(null);
  const viewListeners = useRef(new Set<() => void>());
  const viewFrame = useRef<number | null>(null);

  const subscribeView = useCallback((listener: () => void) => {
    viewListeners.current.add(listener);
    return () => {
      viewListeners.current.delete(listener);
    };
  }, []);
  const getView = useCallback(() => viewRef.current, []);

  // Como mucho unas 10 veces por segundo: el minimapa es una ayuda, y
  // repintarlo (es React) a 60 por segundo mientras se panea le quitaba
  // fotogramas al plano.
  const emitView = useCallback(() => {
    if (viewFrame.current !== null) return;
    viewFrame.current = window.setTimeout(() => {
      viewFrame.current = null;
      const content = contentRef.current;
      const node = containerRef.current;
      if (!content || !node) return;
      const inverse = content.getAbsoluteTransform().copy().invert();
      const w = node.clientWidth;
      const h = node.clientHeight;
      viewRef.current = [
        inverse.point({ x: 0, y: 0 }),
        inverse.point({ x: w, y: 0 }),
        inverse.point({ x: w, y: h }),
        inverse.point({ x: 0, y: h }),
      ];
      viewListeners.current.forEach((listener) => listener());
    }, 100);
  }, []);

  useEffect(
    () => () => {
      if (viewFrame.current !== null) window.clearTimeout(viewFrame.current);
      // Sin esto, tras el desmontaje y remontaje de Strict Mode el ref se
      // quedaba con el id del fotograma cancelado y `emitView` creía que ya
      // había uno en camino: el minimapa no volvía a enterarse de nada.
      viewFrame.current = null;
    },
    [],
  );

  /** Lleva la vista para que ese punto del plano quede en el centro. */
  const centerOn = useCallback(
    (x: number, y: number) => {
      const stage = stageRef.current;
      const content = contentRef.current;
      const node = containerRef.current;
      if (!stage || !content || !node) return;
      const onScreen = content.getAbsoluteTransform().point({ x, y });
      stage.position({
        x: stage.x() + node.clientWidth / 2 - onScreen.x,
        y: stage.y() + node.clientHeight / 2 - onScreen.y,
      });
      emitView();
    },
    [emitView],
  );

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

  // El porcentaje de zoom de la barra es estado del editor: actualizarlo en
  // cada paso del pellizco re-renderizaba el editor entero 60 veces por
  // segundo. Se avisa como mucho cada 150 ms, con el último valor.
  const zoomTimer = useRef<number | null>(null);
  const pendingZoom = useRef(100);
  const reportZoom = useCallback((scale: number) => {
    pendingZoom.current = Math.round(scale * 100);
    if (zoomTimer.current !== null) return;
    zoomTimer.current = window.setTimeout(() => {
      zoomTimer.current = null;
      callbacks.current.onZoomChange(pendingZoom.current);
    }, 150);
  }, []);
  useEffect(() => () => {
    if (zoomTimer.current !== null) window.clearTimeout(zoomTimer.current);
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
      reportZoom(newScale);
      emitView();
    },
    [emitView, reportZoom],
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

  // --- Cámara: mover el plano y pellizcar ---------------------------------
  //
  // Durante el gesto NO se redibuja nada: se desplaza (o escala) con CSS el
  // lienzo YA dibujado, que el navegador mueve en la tarjeta gráfica sin coste.
  // Al soltar, se pasa a Konva la vista nueva y se redibuja UNA vez. Es lo que
  // hace que mover el plano y el pellizco vayan a 60 FPS en una tablet: antes,
  // cada movimiento del dedo redibujaba el plano entero. Mientras se pellizca
  // el plano se ve un poco borroso; al soltar vuelve a estar nítido.
  //
  // Va con eventos de puntero nativos del contenedor (dedo, ratón o lápiz).
  // Un gesto que empieza sobre una mesa no mueve el plano: esa mesa la arrastra
  // Konva. El segundo dedo convierte cualquier gesto en pellizco.
  const panEnabledRef = useRef(true);
  useEffect(() => {
    panEnabledRef.current = !onMarquee;
  });
  useEffect(() => {
    const node = containerRef.current;
    if (!node) return;
    type Pt = { x: number; y: number };
    const pointers = new Map<number, Pt>();
    let gesture: null | {
      kind: "pan" | "pinch";
      base: { x: number; y: number; s: number };
      start: Pt;
      startDist: number;
      cur: { tx: number; ty: number; s: number };
    } = null;
    const local = (e: PointerEvent): Pt => {
      const r = node.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const contentDiv = () => stageRef.current?.content ?? null;
    const apply = () => {
      const div = contentDiv();
      if (!div || !gesture) return;
      div.style.transformOrigin = `${gesture.start.x}px ${gesture.start.y}px`;
      div.style.transform = `translate(${gesture.cur.tx}px, ${gesture.cur.ty}px) scale(${gesture.cur.s})`;
    };
    const commit = () => {
      const stage = stageRef.current;
      const g = gesture;
      gesture = null;
      const div = contentDiv();
      if (!stage || !g) return;
      const { tx, ty, s } = g.cur;
      if (tx !== 0 || ty !== 0 || s !== 1) {
        // Un punto en pantalla P pasó a O + (P - O)·s + t, con O = inicio.
        const O = g.start;
        stage.scale({ x: g.base.s * s, y: g.base.s * s });
        stage.position({ x: O.x + (g.base.x - O.x) * s + tx, y: O.y + (g.base.y - O.y) * s + ty });
        // Dibujar YA, antes de quitar el CSS: si no, un fotograma saltaría.
        stage.draw();
        reportZoom(g.base.s * s);
        emitView();
      }
      if (div) div.style.transform = "";
    };
    const startGesture = (kind: "pan" | "pinch") => {
      const stage = stageRef.current;
      if (!stage) return;
      const pts = [...pointers.values()];
      const start = kind === "pan" ? pts[0] : { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
      gesture = {
        kind,
        base: { x: stage.x(), y: stage.y(), s: stage.scaleX() },
        start,
        startDist: kind === "pinch" ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0,
        cur: { tx: 0, ty: 0, s: 1 },
      };
    };
    const onDown = (e: PointerEvent) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      const p = local(e);
      pointers.set(e.pointerId, p);
      const stage = stageRef.current;
      if (!stage) return;
      if (pointers.size === 2) {
        // Segundo dedo: pellizco. Si un dedo arrastraba una mesa, se suelta.
        if (gesture) commit();
        for (const n of nodesRef.current.values()) if (n.isDragging()) n.stopDrag();
        startGesture("pinch");
        return;
      }
      if (pointers.size !== 1 || !panEnabledRef.current) return;
      // Sobre una mesa: la arrastra Konva, no se mueve el plano.
      if (stage.getIntersection(p)) return;
      startGesture("pan");
    };
    const onMove = (e: PointerEvent) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, local(e));
      if (!gesture) return;
      if (gesture.kind === "pan") {
        const p = pointers.get(e.pointerId)!;
        gesture.cur = { tx: p.x - gesture.start.x, ty: p.y - gesture.start.y, s: 1 };
      } else if (pointers.size >= 2) {
        const [p1, p2] = [...pointers.values()];
        const d = Math.hypot(p1.x - p2.x, p1.y - p2.y);
        const s = clamp(gesture.base.s * (d / (gesture.startDist || 1)), MIN_SCALE, MAX_SCALE) / gesture.base.s;
        const mid = { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 };
        gesture.cur = { tx: mid.x - gesture.start.x, ty: mid.y - gesture.start.y, s };
      }
      apply();
    };
    const onUp = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId)) return;
      if (gesture && (pointers.size === 0 || gesture.kind === "pinch")) commit();
    };
    node.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);
    return () => {
      node.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
    };
  }, [emitView, reportZoom]);

  const zoomByCentre = useCallback(
    (factor: number) => {
      const node = containerRef.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      zoomAround(rect.left + rect.width / 2, rect.top + rect.height / 2, factor);
    },
    [zoomAround],
  );

  // Los elementos se leen por ref en `resetView`: si fueran dependencia, mover
  // una mesa en el editor volvería a encuadrar el plano en cada arrastre.
  const elementsRef = useRef(elements);
  useEffect(() => {
    elementsRef.current = elements;
  });

  const resetView = useCallback(() => {
    const stage = stageRef.current;
    const node = containerRef.current;
    if (!stage || !node) return;

    const rect = node.getBoundingClientRect();
    // Lo que tapan los paneles flotantes de arriba no cuenta como hueco.
    const freeHeight = rect.height - topInset;

    // Qué se encuadra: las MESAS que hay (con un margen para sus sillas y
    // etiquetas), no la zona entera. Si un local usa una esquina de un lienzo
    // grande, sus mesas se ven grandes y legibles. Sin elementos, la zona.
    const items = elementsRef.current;
    let box = { minX: 0, minY: 0, maxX: width, maxY: height };
    let maxFit = 1;
    if (items.length > 0) {
      box = {
        minX: Math.max(0, Math.min(...items.map((e) => e.x)) - FIT_PADDING),
        minY: Math.max(0, Math.min(...items.map((e) => e.y)) - FIT_PADDING),
        maxX: Math.min(width, Math.max(...items.map((e) => e.x + e.width)) + FIT_PADDING),
        maxY: Math.min(height, Math.max(...items.map((e) => e.y + e.height)) + FIT_PADDING),
      };
      maxFit = FIT_MAX_SCALE;
    }
    // El contenido gira alrededor del centro del plano: se giran las cuatro
    // esquinas de la caja y se encuadra la caja que resulta en pantalla.
    const rad = (viewRotation * Math.PI) / 180;
    const cos = Math.round(Math.cos(rad));
    const sin = Math.round(Math.sin(rad));
    const cx = width / 2;
    const cy = height / 2;
    const corners = [
      [box.minX, box.minY],
      [box.maxX, box.minY],
      [box.maxX, box.maxY],
      [box.minX, box.maxY],
    ].map(([px, py]) => ({
      x: cx + (px - cx) * cos - (py - cy) * sin,
      y: cy + (px - cx) * sin + (py - cy) * cos,
    }));
    const left = Math.min(...corners.map((p) => p.x));
    const right = Math.max(...corners.map((p) => p.x));
    const top = Math.min(...corners.map((p) => p.y));
    const bottom = Math.max(...corners.map((p) => p.y));

    // El margen deja ver el borde del plano y su brillo.
    const fit = Math.min((rect.width - 40) / (right - left), (freeHeight - 40) / (bottom - top), maxFit);
    const scale = clamp(fit, MIN_SCALE, maxFit);
    stage.scale({ x: scale, y: scale });
    stage.position({
      x: rect.width / 2 - ((left + right) / 2) * scale,
      y: topInset + freeHeight / 2 - ((top + bottom) / 2) * scale,
    });
    onZoomChange(Math.round(scale * 100));
    emitView();
  }, [emitView, height, onZoomChange, topInset, viewRotation, width]);

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
      visibleBox: () => {
        const node = containerRef.current;
        if (!node) return null;
        const w = node.clientWidth;
        const h = node.clientHeight;
        const corners = [toCanvas(0, 0), toCanvas(w, 0), toCanvas(w, h), toCanvas(0, h)];
        if (corners.some((p) => p === null)) return null;
        const xs = corners.map((p) => p!.x);
        const ys = corners.map((p) => p!.y);
        return { left: Math.min(...xs), top: Math.min(...ys), right: Math.max(...xs), bottom: Math.max(...ys) };
      },
      revealElement: (id: string) => {
        const stage = stageRef.current;
        const node = nodesRef.current.get(id);
        const box = containerRef.current;
        if (!stage || !node || !box) return;
        const r = node.getClientRect();
        const M = 16;
        const w = box.clientWidth;
        const h = box.clientHeight;
        if (r.x >= M && r.y >= M && r.x + r.width <= w - M && r.y + r.height <= h - M) return;
        stage.position({
          x: stage.x() + (w / 2 - (r.x + r.width / 2)),
          y: stage.y() + (h / 2 - (r.y + r.height / 2)),
        });
        stage.batchDraw();
        emitView();
      },
    }),
    [emitView, resetView, toCanvas, zoomByCentre],
  );

  // Se encuadra al abrir, al cambiar de zona y al girar el plano. `hasSize`
  // es lo que cubre la apertura: en el primer render el Stage todavía no
  // existe (se monta cuando el ResizeObserver mide el hueco), así que el
  // encuadre tiene que repetirse cuando aparece. Sin esto el mapa se abría al
  // 100% y en una tablet no cabía.
  const hasSize = size.width > 0;
  useEffect(() => {
    if (hasSize) resetView();
  }, [hasSize, layoutId, resetView]);

  // Si cambia el hueco (girar la tablet, abrir un aviso), cambia lo que se ve.
  useEffect(() => {
    emitView();
  }, [emitView, size]);

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
    anchorStroke: theme.accent,
    anchorStrokeWidth: 2,
    anchorFill: theme.panel,
    anchorCornerRadius: 9,
    borderStroke: theme.accent,
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

  // Retícula de fondo, tenue: líneas finas cada 25 unidades y algo más
  // marcadas cada 100, como el radar de un mapa visto desde arriba. Va en el
  // Layer de abajo y con `listening={false}`: los clics la atraviesan y llegan
  // al Stage, que es lo que hace que tocar el vacío deseleccione.
  //
  // Es UNA figura que traza todas las líneas en dos pasadas (finas y
  // marcadas), no una figura por línea: con ~80 líneas, cada movimiento del
  // plano costaba ~80 dibujos en vez de 2.
  const drawGrid = useCallback(
    (ctx: Konva.Context) => {
      const c = ctx._context;
      const MINOR = 25;
      const MAJOR = 100;
      c.lineWidth = 1;
      for (const major of [false, true]) {
        c.beginPath();
        for (let gx = MINOR; gx < width; gx += MINOR) {
          if ((gx % MAJOR === 0) !== major) continue;
          c.moveTo(gx, 0);
          c.lineTo(gx, height);
        }
        for (let gy = MINOR; gy < height; gy += MINOR) {
          if ((gy % MAJOR === 0) !== major) continue;
          c.moveTo(0, gy);
          c.lineTo(width, gy);
        }
        c.strokeStyle = major ? theme.gridMajor : theme.grid;
        c.stroke();
      }
    },
    [height, theme.grid, theme.gridMajor, width],
  );

  // Callbacks estables para las mesas (ver `callbacks` arriba).
  // Elegir una mesa re-renderiza el panel del editor: se marca como «no
  // urgente» para que React no bloquee los fotogramas del dedo (si el toque
  // sigue en un arrastre, el arrastre va primero).
  const handleSelect = useCallback((id: string) => {
    startTransition(() => callbacks.current.onSelect(id));
  }, []);
  const handleTap = useCallback((id: string) => callbacks.current.onElementTap?.(id), []);
  // Mientras se arrastra, la mesa pasa a una capa propia (`dragGroupRef`, con
  // el mismo giro que el plano): así cada movimiento redibuja SOLO esa mesa y
  // no las otras 40. Es la técnica que recomienda Konva para arrastrar rápido.
  // Al soltar vuelve a su sitio, en el mismo orden.
  const handleNodeDragStart = useCallback((id: string) => {
    const node = nodesRef.current.get(id);
    const dragGroup = dragGroupRef.current;
    if (node && dragGroup && node.getParent() !== dragGroup) {
      dragOrigin.current = { id, index: node.zIndex() };
      node.moveTo(dragGroup);
      contentRef.current?.getLayer()?.batchDraw();
      // La mesa se guarda como imagen mientras se arrastra (a la escala de
      // ahora, para que se vea nítida): cada movimiento copia esa imagen en
      // vez de volver a componer sus textos y figuras. Y el recuadro de
      // selección se esconde hasta soltar, para no redibujarlo en cada paso.
      const scale = stageRef.current?.scaleX() ?? 1;
      node.cache({ pixelRatio: Konva.pixelRatio * scale, offset: 24 });
      // El recuadro se desengancha hasta soltar: enganchado, se recalcula en
      // cada movimiento aunque no se vea.
      transformerRef.current?.nodes([]);
    }
  }, []);
  // Al SOLTAR: la mesa se movió sola durante el arrastre (es Konva quien la
  // mueve); el estado de React se actualiza una sola vez, aquí.
  const handleNodeDragEnd = useCallback((id: string, x: number, y: number) => {
    const node = nodesRef.current.get(id);
    const content = contentRef.current;
    if (node && content && dragOrigin.current?.id === id) {
      node.clearCache();
      node.moveTo(content);
      node.zIndex(Math.min(dragOrigin.current.index, content.children.length - 1));
      transformerRef.current?.nodes([node]);
      dragOrigin.current = null;
    }
    // La foto para Deshacer se toma AQUÍ y no al empezar: el estado todavía
    // tiene la posición de antes (la mesa la movió Konva, no React), y así
    // empezar a arrastrar no re-renderiza el editor.
    callbacks.current.onEditStart();
    callbacks.current.onMove(id, x, y);
    callbacks.current.onChange();
  }, []);
  const bounds = useMemo(() => ({ width, height }), [width, height]);

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
    if (e.target === e.target.getStage()) {
      onSelect(null);
      // Selección en grupo: el rectángulo empieza en el vacío.
      const pos = onMarquee ? e.target.getStage()?.getPointerPosition() : null;
      if (pos) {
        const box = { x0: pos.x, y0: pos.y, x1: pos.x, y1: pos.y };
        marqueeRef.current = box;
        setMarquee(box);
      }
    }
  };

  const moveMarquee = () => {
    const pos = marqueeRef.current ? stageRef.current?.getPointerPosition() : null;
    if (!pos || !marqueeRef.current) return;
    const box = { ...marqueeRef.current, x1: pos.x, y1: pos.y };
    marqueeRef.current = box;
    setMarquee(box);
  };

  const endMarquee = () => {
    const box = marqueeRef.current;
    const content = contentRef.current;
    marqueeRef.current = null;
    setMarquee(null);
    if (!box || !content || !onMarquee) return;
    const left = Math.min(box.x0, box.x1);
    const right = Math.max(box.x0, box.x1);
    const top = Math.min(box.y0, box.y1);
    const bottom = Math.max(box.y0, box.y1);
    // Un toque sin arrastrar no selecciona nada.
    if (right - left < 6 && bottom - top < 6) return;
    // El centro de cada elemento, pasado a pantalla con la transformación
    // real del contenido (zoom, paneo y giro de la vista incluidos).
    const transform = content.getAbsoluteTransform();
    const ids = elements
      .filter((el) => {
        const p = transform.point({ x: el.x + el.width / 2, y: el.y + el.height / 2 });
        return p.x >= left && p.x <= right && p.y >= top && p.y <= bottom;
      })
      .map((el) => el.id);
    onMarquee(ids);
  };

  return (
    <div
      ref={containerRef}
      // `touch-none`: sin esto el navegador de la tablet se queda con el
      // pellizco y hace zoom de la página entera en vez del mapa.
      className="relative h-full w-full touch-none overflow-hidden bg-app-bg"
    >
      {size.width > 0 ? (
        <Stage
          ref={stageRef}
          width={size.width}
          height={size.height}
          // El plano se mueve con la cámara de arriba, no arrastrando el Stage.
          draggable={false}
          onWheel={handleWheel}
          onMouseDown={deselectOnEmpty}
          onTouchStart={deselectOnEmpty}
          onTouchMove={() => {
            if (marqueeRef.current) moveMarquee();
          }}
          onMouseMove={moveMarquee}
          onMouseUp={endMarquee}
          onTouchEnd={endMarquee}
        >
          <Layer listening={false}>
            <Group {...rotated}>
              <Rect
                x={0}
                y={0}
                width={width}
                height={height}
                cornerRadius={14}
                fill={theme.mapBg}
              />
              <Shape sceneFunc={drawGrid} listening={false} perfectDrawEnabled={false} />
              {/* Paredes del local. Sin sombra difuminada: en una tablet,
                  repintar ese brillo en cada movimiento costaba más que el
                  resto del plano. */}
              <Rect
                x={0}
                y={0}
                width={width}
                height={height}
                cornerRadius={14}
                stroke={theme.line}
                strokeWidth={3}
                perfectDrawEnabled={false}
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
                    theme={theme}
                    selected={element.id === selectedId}
                    viewRotation={viewRotation}
                    occupantName={element.currentEntryId ? element.occupantName : null}
                    minutes={minutesSeated(element, now)}
                    pulse={pulses[element.id] ?? 0}
                    onSelect={handleSelect}
                    onTap={onElementTap ? handleTap : undefined}
                    waiter={waiterMarks?.[element.id] ?? null}
                    draggable={!readOnly}
                    bounds={bounds}
                    onDragStart={handleNodeDragStart}
                    onDragEnd={handleNodeDragEnd}
                    registerNode={registerNode}
                  />
                );
              })}
            </Group>
          </Layer>

          {/* La mesa que se está arrastrando (ver `handleNodeDragStart`). Sin
              `listening`: mientras se arrastra no hace falta saber qué hay
              bajo el dedo, y así no se redibuja su mapa de toques. */}
          <Layer listening={false}>
            <Group ref={dragGroupRef} {...rotated} />
          </Layer>

          {/* Selección y tiradores en su propia capa: elegir otra mesa repinta
              solo esta capa, no todas las mesas. */}
          {readOnly ? null : (
            <Layer>
              <Transformer
                {...transformerConfig}
                ref={transformerRef}
                onTransformStart={onEditStart}
                onTransformEnd={handleTransformEnd}
              />
            </Layer>
          )}
        </Stage>
      ) : null}

      {/* En un celular en vertical el minimapa taparía media sala: el plano ya
          cabe entero en la pantalla, así que no hace falta. */}
      <div className="pointer-events-none absolute bottom-3 left-3 hidden sm:block movil-horizontal:!hidden">
        <div className="pointer-events-auto">
          <Minimap
            width={width}
            height={height}
            rotation={viewRotation}
            elements={elements}
            typesById={typesById}
            theme={theme}
            subscribeView={subscribeView}
            getView={getView}
            onJump={centerOn}
          />
        </div>
      </div>

      {marquee ? (
        <div
          aria-hidden
          className="pointer-events-none absolute rounded-md border-2 border-dashed border-accent bg-accent/15"
          style={{
            left: Math.min(marquee.x0, marquee.x1),
            top: Math.min(marquee.y0, marquee.y1),
            width: Math.abs(marquee.x1 - marquee.x0),
            height: Math.abs(marquee.y1 - marquee.y0),
          }}
        />
      ) : null}

      <StatusLegend theme={theme} />
    </div>
  );
}

/**
 * Leyenda de colores: panel flotante semitransparente, fijo en la esquina (no
 * se mueve con el zoom). Los colores salen del tema, así que siempre coinciden
 * con los del mapa.
 */
function StatusLegend({ theme }: { theme: Theme }) {
  return (
    <div className="pointer-events-none absolute bottom-3 right-3 flex flex-col gap-1.5 rounded-2xl bg-panel/95 px-3 py-2.5 text-xs font-medium text-panel-text shadow-lg ring-1 ring-app-border">
      {STATUS_ORDER.map((status) => {
        const colors = theme.status[status];
        return (
          <span key={status} className="flex items-center gap-2">
            <span
              aria-hidden
              className="h-3.5 w-3.5 rounded-full border-2"
              style={{
                backgroundColor: colors.fill,
                borderColor: colors.stroke,
                boxShadow: `0 0 8px ${colors.stroke}`,
              }}
            />
            {STATUS_LABELS[status]}
          </span>
        );
      })}
    </div>
  );
}
