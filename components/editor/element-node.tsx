"use client";

// Un elemento colocado en el mapa.
//
// Estilo "radar" visto desde arriba: cuerpos con relleno translúcido del color
// de su estado, bordes marcados con un brillo suave, y un marcador redondo con
// el ícono del tipo. Todos los colores llegan en `theme` (ver
// `lib/theme/theme.ts`), así que el mismo dibujo sirve para Claro, Oscuro y
// Personalizado.
//
// El Group es lo único arrastrable, así que Konva solo mueve un elemento y
// nunca el resto de la escena. Se posiciona por su CENTRO (`offset` = mitad del
// tamaño) para que girar un elemento lo gire sobre sí mismo y no sobre su
// esquina. En la base de datos `x`/`y` siguen siendo la esquina superior
// izquierda sin girar: la conversión se hace aquí y en el Transformer.

import { memo, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Circle, Group, Line, Rect, Text } from "react-konva";
import Konva from "konva";

import { elementStyle, visibleSeats, visualStatus } from "@/lib/layout/element-style";
import type { ElementTypeInfo, LayoutElement } from "@/lib/layout/types";
import { type Theme, readableOn, withAlpha } from "@/lib/theme/theme";
import { formatDuration, initialOf, shortName } from "@/lib/time/duration";

import { CanvasIcon } from "./canvas-icon";
import { typeIcon } from "./icons";
import { halfExtent } from "@/lib/layout/placement";
import {
  LIVE_GROW_WITH_SEATS,
  LIVE_GROW_WITHOUT_SEATS,
  LIVE_MIN_FONT,
  LIVE_MIN_SIDE_FOR_BADGE,
  type MeasureText,
  estimateText,
  liveTextLines,
  visibleBox,
} from "./live-marks";

export const CANVAS_FONT =
  "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

// Medidor de textos del plano en vivo: el ancho real con la letra del lienzo,
// medido una vez a 100 px y guardado (el ancho crece en proporción). Un 4 %
// de margen por las diferencias de redondeo entre el canvas y Konva.
let measureContext: CanvasRenderingContext2D | null = null;
const measured = new Map<string, number>();
const measureText: MeasureText = (text, px, bold) => {
  const key = `${bold ? "b" : "n"}|${text}`;
  let at100 = measured.get(key);
  if (at100 === undefined) {
    if (typeof document === "undefined") return estimateText(text, px, bold);
    measureContext ??= document.createElement("canvas").getContext("2d");
    if (!measureContext) return estimateText(text, px, bold);
    measureContext.font = `${bold ? "bold " : ""}100px ${CANVAS_FONT}`;
    at100 = measureContext.measureText(text).width;
    measured.set(key, at100);
  }
  return (at100 * px * 1.04) / 100;
};

// Tamaño de lo que va ENCIMA de la mesa: el marcador redondo, la píldora del
// nombre, la del mesero y la del cliente. Son los números base, en unidades del
// plano; como el escenario de Konva se escala entero (zoom y ajuste a la
// pantalla), un número mayor aquí sale mayor en todas partes, sin romper nada.
const LABEL_FONT = 15;
const LABEL_HEIGHT = 26;
const MARKER_RADIUS = 15;
const MARKER_ICON = 18;
const WAITER_HEIGHT = 26;
const WAITER_FONT = 13;
const WAITER_MIN_WIDTH = 104;
const OCCUPANT_HEIGHT = 28;
const OCCUPANT_FONT = 13;
const OCCUPANT_MIN_WIDTH = 150;

/**
 * Cuánto crece lo que va encima de una mesa respecto a una normal: una mesa
 * grande admite un marcador y un nombre más grandes, y una pequeña se ahogaría.
 * Proporcional al lado mayor del elemento y acotado, para que dos mesas juntas
 * nunca se pisen ni la información se salga de la zona.
 */
export function markScale(width: number, height: number): number {
  const lado = Math.max(width, height);
  return Math.max(1, Math.min(1.4, lado / 75));
}

type Props = {
  element: LayoutElement;
  type: ElementTypeInfo;
  theme: Theme;
  selected: boolean;
  /** Giro de la vista del plano, para que el texto quede derecho en pantalla. */
  viewRotation: number;
  /** Nombre del cliente sentado; null si la mesa está libre. */
  occupantName: string | null;
  /** Minutos que lleva sentado; null si no se sabe. */
  minutes: number | null;
  /**
   * Cambia cada vez que la mesa cambia por un evento en vivo. Cada cambio
   * dispara la onda; el valor en sí no importa.
   */
  pulse: number;
  onSelect: (id: string) => void;
  /** Clic o tap completo (no al empezar a arrastrar): reparto de meseros. */
  onTap?: (id: string) => void;
  /** Mesero de la mesa en la configuración que se mira; null si no tiene. */
  waiter?: { color: string; label: string } | null;
  /** Falso en el plano en vivo (solo lectura): la mesa no se mueve. */
  draggable?: boolean;
  /** Avisa al canvas de que un arrastre empezó, para que suelte el Stage. */
  onDragStart: (id: string) => void;
  /**
   * Al SOLTAR, con la esquina superior izquierda nueva. Durante el arrastre
   * no se avisa a nadie: Konva mueve la mesa solo (ver README, «Editor fluido
   * en tablet»).
   */
  onDragEnd: (id: string, x: number, y: number) => void;
  /** Tamaño de la zona: la mesa no se puede arrastrar fuera. */
  bounds?: { width: number; height: number };
  registerNode: (id: string, node: Konva.Group | null) => void;
  /**
   * Plano en vivo: dibujo limpio para mirar de lejos (ver `live-marks.ts`).
   * Cada mesa lleva dentro su nombre en grande y, si cabe, el cliente en
   * corto con sus personas y el tiempo; el mesero va en el borde (su color)
   * y su inicial. Sin sillas, sin íconos y sin píldoras colgando fuera.
   */
  live?: boolean;
  /** Escala de la vista (por escalones, ver `scaleStep`): solo con `live`. */
  screenScale?: number;
  /** Personas del grupo sentado (plano en vivo); null si no se sabe. */
  partySize?: number | null;
};

// Sin sombras difuminadas (el antiguo brillo de «radar»): en una tablet,
// repintarlas en cada movimiento del dedo era lo que más frenaba el editor.
// Cada figura lleva `perfectDrawEnabled={false}`, que ahorra un lienzo
// intermedio al dibujar relleno + borde con transparencia.



/** Etiqueta con el nombre, del color de los paneles: se lee sobre cualquier fondo. */
function LabelPill({
  text,
  width,
  y,
  escala,
  theme,
}: {
  text: string;
  width: number;
  y: number;
  escala: number;
  theme: Theme;
}) {
  const alto = LABEL_HEIGHT * escala;
  const fuente = LABEL_FONT * escala;
  return (
    <Group y={y} listening={false}>
      <Rect
        x={-width / 2}
        y={-alto / 2}
        width={width}
        height={alto}
        cornerRadius={alto / 2}
        fill={withAlpha(theme.panel, 0.92)}
        stroke={theme.border}
        strokeWidth={1}
      />
      <Text
        x={-width / 2}
        y={-fuente / 2 + 1}
        width={width}
        align="center"
        text={text}
        fontSize={fuente}
        fontStyle="bold"
        fontFamily={CANVAS_FONT}
        fill={theme.panelText}
        wrap="none"
        ellipsis
      />
    </Group>
  );
}

function ElementNodeBase({
  element,
  type,
  theme,
  selected,
  viewRotation,
  occupantName,
  minutes,
  pulse,
  onSelect,
  onTap,
  waiter = null,
  draggable = true,
  onDragStart,
  onDragEnd,
  bounds,
  registerNode,
  live = false,
  screenScale = 1,
  partySize = null,
}: Props) {
  const waveRef = useRef<Konva.Circle | null>(null);
  // En pantallas táctiles algunos navegadores mandan `tap` y además un
  // `click` emulado: sin esto, una mesa se pintaría y despintaría de golpe.
  const lastTap = useRef(0);
  const tap = (e: Konva.KonvaEventObject<Event>) => {
    if (!onTap) return;
    const now = e.evt.timeStamp;
    if (now - lastTap.current < 400) return;
    lastTap.current = now;
    onTap(element.id);
  };
  const echoRef = useRef<Konva.Circle | null>(null);

  const style = elementStyle(type);
  const { width, height } = element;
  const status = visualStatus(element);
  const colors = theme.status[status];
  const icon = typeIcon(type.key).node;
  const baseRadius = Math.max(width, height) / 2 + 6;
  // Lo que va encima de la mesa (marcador, nombre, mesero, cliente) crece con
  // ella, dentro de unos límites: más presencia sin que dos mesas se pisen.
  const MS = markScale(width, height);

  // Onda expansiva cuando la mesa cambia por un evento en vivo: un anillo del
  // color del estado nuevo que crece y se desvanece, y un eco detrás. Se salta
  // el primer render: solo avisa de cambios, no de lo que ya estaba.
  const firstPulse = useRef(pulse);
  useEffect(() => {
    if (pulse === firstPulse.current) return;
    const waves: [Konva.Circle | null, number][] = [
      [waveRef.current, 0],
      [echoRef.current, 0.22],
    ];
    const timers: number[] = [];
    for (const [ring, delay] of waves) {
      if (!ring) continue;
      timers.push(
        window.setTimeout(() => {
          ring.radius(baseRadius);
          ring.strokeWidth(4);
          ring.opacity(0.9);
          ring.visible(true);
          ring.to({
            radius: baseRadius * 2.2,
            strokeWidth: 1,
            opacity: 0,
            duration: 0.9,
            easing: Konva.Easings.EaseOut,
            onFinish: () => ring.visible(false),
          });
        }, delay * 1000),
      );
    }
    return () => timers.forEach((t) => window.clearTimeout(t));
    // `baseRadius` a propósito fuera: redimensionar no debe lanzar la onda.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pulse]);

  const radius = Math.min(width, height) / 2;
  // En el plano en vivo no hay sillas: el estado y el texto se leen mejor.
  const seats = style.seatable && !live ? visibleSeats(element.capacity) : 0;

  // Sillas alrededor de la mesa, redondeadas y mirando hacia fuera: se lee de
  // un vistazo que es una mesa con sillas y cuántos caben.
  const chairs: ReactNode[] = [];
  for (let i = 0; i < seats; i += 1) {
    const angle = (360 / seats) * i - 90;
    const rad = (angle * Math.PI) / 180;
    chairs.push(
      <Rect
        key={`seat-${i}`}
        x={width / 2 + Math.cos(rad) * (radius + 9)}
        y={height / 2 + Math.sin(rad) * (radius + 9)}
        width={16}
        height={11}
        offsetX={8}
        offsetY={5.5}
        rotation={angle + 90}
        cornerRadius={4}
        fill={colors.seat}
        stroke={colors.stroke}
        strokeWidth={1}
        listening={false}
      />,
    );
  }

  let body: ReactNode;
  // Dónde va el nombre y dónde el ícono, en coordenadas locales.
  let labelY = height / 2;
  let iconY: number | null = null;

  switch (style.shape) {
    case "circle":
      body = (
        <>
          {chairs}
          <Circle
            x={width / 2}
            y={height / 2}
            radius={radius}
            fill={colors.fill}
            stroke={colors.stroke}
            strokeWidth={2.5}
            listening={false}
            perfectDrawEnabled={false}
          />
        </>
      );
      break;

    case "booth": {
      // Butaca en U: banco a la izquierda, al fondo y a la derecha, y la mesa
      // dentro, abierta por arriba (por donde se entra).
      const bench = Math.max(10, Math.min(width, height) * 0.2);
      const benchProps = {
        cornerRadius: 6,
        fill: colors.seat,
        stroke: colors.stroke,
        strokeWidth: 1.5,
        listening: false,
      };
      body = (
        <>
          <Rect x={0} y={0} width={bench} height={height} {...benchProps} />
          <Rect x={width - bench} y={0} width={bench} height={height} {...benchProps} />
          <Rect x={0} y={height - bench} width={width} height={bench} {...benchProps} />
          <Rect
            x={bench + 4}
            y={4}
            width={width - bench * 2 - 8}
            height={height - bench - 8}
            cornerRadius={8}
            fill={colors.fill}
            stroke={colors.stroke}
            strokeWidth={2.5}
            listening={false}
            perfectDrawEnabled={false}
          />
        </>
      );
      labelY = (height - bench) / 2;
      break;
    }

    case "zone":
      // Zona: relleno translúcido del color del tipo y borde marcado.
      body = (
        <Rect
          x={0}
          y={0}
          width={width}
          height={height}
          cornerRadius={16}
          fill={withAlpha(type.color, theme.dark ? 0.2 : 0.14)}
          stroke={type.color}
          strokeWidth={2.5}
          dash={[12, 6]}
          listening={false}
          perfectDrawEnabled={false}
        />
      );
      iconY = height / 2 - 16;
      labelY = height / 2 + 14;
      break;

    case "bar": {
      // Barra: mostrador alargado con el canto de servicio marcado arriba y
      // banquetas a lo largo del lado de los clientes. Las banquetas son
      // dibujo, no puestos: en la barra no se sienta a nadie de la lista.
      const stools = Math.max(1, Math.floor((width - 16) / 44));
      const gap = width / stools;
      body = (
        <>
          <Rect
            x={0}
            y={0}
            width={width}
            height={height}
            cornerRadius={10}
            fill={withAlpha(type.color, theme.dark ? 0.24 : 0.18)}
            stroke={type.color}
            strokeWidth={2.5}
            listening={false}
            perfectDrawEnabled={false}
          />
          <Rect
            x={4}
            y={4}
            width={width - 8}
            height={Math.max(6, height * 0.16)}
            cornerRadius={4}
            fill={withAlpha(type.color, 0.7)}
            listening={false}
          />
          {Array.from({ length: stools }, (_, i) => (
            <Circle
              key={`stool-${i}`}
              x={gap * (i + 0.5)}
              y={height - 11}
              radius={6}
              fill={withAlpha(type.color, 0.45)}
              stroke={type.color}
              strokeWidth={1.5}
              listening={false}
            />
          ))}
        </>
      );
      labelY = height * 0.45;
      break;
    }

    case "door": {
      // Puerta vista desde arriba: el hueco en la pared abajo, la hoja
      // abierta a la izquierda (bisagra en la esquina inferior izquierda) y
      // el arco que barre al abrirse, como en un plano de arquitectura.
      // El arco va como polilínea y no con `Arc`/`Wedge` de Konva: esos miden
      // el círculo entero, y el marco de selección salía cuatro veces mayor
      // que la puerta.
      const r = Math.min(width, height);
      const arc: number[] = [];
      for (let i = 0; i <= 16; i += 1) {
        const a = (Math.PI / 2) * (i / 16);
        arc.push(Math.sin(a) * r, height - Math.cos(a) * r);
      }
      body = (
        <>
          <Line
            points={[0, height, ...arc]}
            closed
            fill={withAlpha(type.color, theme.dark ? 0.16 : 0.1)}
            listening={false}
          />
          <Line
            points={arc}
            stroke={type.color}
            strokeWidth={2}
            dash={[6, 4]}
            lineCap="round"
            listening={false}
            perfectDrawEnabled={false}
          />
          <Line
            points={[0, height, width, height]}
            stroke={theme.line}
            strokeWidth={4}
            lineCap="round"
            listening={false}
          />
          <Rect
            x={-3}
            y={height - r}
            width={6}
            height={r}
            cornerRadius={2}
            fill={type.color}
            listening={false}
            perfectDrawEnabled={false}
          />
        </>
      );
      iconY = height / 2 - 6;
      labelY = height / 2 + 20;
      break;
    }

    case "wall":
      // Pared: bloque sólido del color de las paredes del local (el mismo que
      // el borde del plano), así se lee igual en Claro, Oscuro y Personalizado.
      body = (
        <Rect
          x={0}
          y={0}
          width={width}
          height={height}
          cornerRadius={2}
          fill={theme.line}
          stroke={theme.line}
          strokeWidth={1}
          listening={false}
          perfectDrawEnabled={false}
        />
      );
      break;

    default:
      // Baño, caja y cualquier tipo nuevo: área translúcida con su ícono.
      body = (
        <Rect
          x={0}
          y={0}
          width={width}
          height={height}
          cornerRadius={12}
          fill={withAlpha(type.color, theme.dark ? 0.22 : 0.16)}
          stroke={type.color}
          strokeWidth={2}
          listening={false}
          perfectDrawEnabled={false}
        />
      );
      iconY = height / 2 - 12;
      labelY = height / 2 + 16;
  }

  // Plano en vivo, mesas: cuerpo de color sólido (libre neutro, ocupada y
  // reservada con su color), el mesero en el borde y el texto dentro.
  const liveSeatable = live && style.seatable;
  const round = style.shape === "circle";
  // Sin sillas, la mesa ocupa su sitio: crece hacia donde estaban.
  const grow = liveSeatable ? (visibleSeats(element.capacity) > 0 ? LIVE_GROW_WITH_SEATS : LIVE_GROW_WITHOUT_SEATS) : 0;
  const liveTone =
    status === "libre"
      ? { fill: theme.panel, stroke: withAlpha(theme.panelText, theme.dark ? 0.4 : 0.32), text: theme.panelText }
      : { fill: colors.stroke, stroke: colors.stroke, text: colors.onStroke };
  if (liveSeatable) {
    // El borde del mesero, ~4 px en pantalla a cualquier zoom.
    const ring = waiter ? 4 / screenScale : 2 / screenScale;
    body = round ? (
      <Circle
        name="live-body"
        x={width / 2}
        y={height / 2}
        radius={radius + grow}
        fill={liveTone.fill}
        stroke={waiter ? waiter.color : liveTone.stroke}
        strokeWidth={ring}
        listening={false}
        perfectDrawEnabled={false}
      />
    ) : (
      <Rect
        name="live-body"
        x={-grow}
        y={-grow}
        width={width + grow * 2}
        height={height + grow * 2}
        cornerRadius={Math.min(16, Math.min(width, height) / 4)}
        fill={liveTone.fill}
        stroke={waiter ? waiter.color : liveTone.stroke}
        strokeWidth={ring}
        listening={false}
        perfectDrawEnabled={false}
      />
    );
  }

  // La píldora del nombre ocupa lo que hay sitio, con un tope en unidades del plano
  // para no invadir el hueco con la mesa de al lado. En las mesas con sillas
  // puede pasar un poco del ancho, que es justo donde no hay nada. Un nombre
  // largo se corta con "…" en vez de salirse.
  const anchoMaximo = Math.min(180 * MS, style.seatable ? width + 14 : width - 16);
  const labelWidth = Math.max(52 * MS, anchoMaximo);
  // Si el elemento es pequeño, ícono y nombre no caben uno encima del otro:
  // se queda solo el nombre.
  const showIcon = iconY !== null && height >= 64;
  if (!showIcon) labelY = height / 2;

  const occupantText =
    occupantName !== null
      ? minutes !== null
        ? `${occupantName} · ${minutes} min`
        : occupantName
      : null;

  // Marcador de las mesas: en la esquina, medio colgado del borde (entro la mitad
  // de su radio, para que al crecer no quede flotando fuera). Las zonas, baños y
  // cajas ya llevan su ícono en el centro.
  const markerOffset = MARKER_RADIUS * MS * 0.55;
  const marker = style.seatable
    ? style.shape === "circle"
      ? { x: radius - markerOffset, y: -radius + markerOffset }
      : { x: width / 2 - markerOffset, y: -height / 2 + markerOffset }
    : null;

  return (
    <Group
      ref={(node) => registerNode(element.id, node)}
      id={element.id}
      // `ocupada` además: así una prueba en el navegador encuentra las ocupadas.
      name={element.currentEntryId ? "table-element ocupada" : "table-element"}
      x={element.x + width / 2}
      y={element.y + height / 2}
      offsetX={width / 2}
      offsetY={height / 2}
      width={width}
      height={height}
      rotation={element.rotation}
      draggable={draggable}
      onMouseDown={(e) => {
        // `cancelBubble` para que la pulsación no llegue al Stage, que la usa
        // para deseleccionar.
        e.cancelBubble = true;
        onSelect(element.id);
      }}
      onTouchStart={(e) => {
        e.cancelBubble = true;
        onSelect(element.id);
      }}
      onDragStart={(e) => {
        e.cancelBubble = true;
        onSelect(element.id);
        onDragStart(element.id);
      }}
      onDragMove={(e) => {
        // Dentro de la zona, también con la mesa girada: se limita su centro
        // (`x`/`y` apuntan al centro por el `offset`) en coordenadas del
        // plano, así vale gire como gire la vista.
        if (!bounds) return;
        const node = e.target;
        const { hx, hy } = halfExtent({ width, height, rotation: element.rotation });
        const x = Math.min(Math.max(node.x(), hx), Math.max(hx, bounds.width - hx));
        const y = Math.min(Math.max(node.y(), hy), Math.max(hy, bounds.height - hy));
        if (x !== node.x() || y !== node.y()) node.position({ x, y });
      }}
      onDragEnd={(e) => {
        // Se devuelve la esquina, que es lo que se guarda.
        onDragEnd(element.id, Math.round(e.target.x() - width / 2), Math.round(e.target.y() - height / 2));
      }}
      onClick={tap}
      onTap={tap}
    >
      {/* Ondas del pulso en vivo. Ocultas (`visible={false}`, no solo
          transparentes) salvo durante la animación: si no, el Transformer
          las mide y el marco de una barra o una pared sale cuadrado. */}
      <Circle
        ref={waveRef}
        x={width / 2}
        y={height / 2}
        radius={baseRadius}
        stroke={colors.stroke}
        strokeWidth={4}
        opacity={0}
        visible={false}
        listening={false}
      />
      <Circle
        ref={echoRef}
        x={width / 2}
        y={height / 2}
        radius={baseRadius}
        stroke={colors.stroke}
        strokeWidth={4}
        opacity={0}
        visible={false}
        listening={false}
      />

      {/* Zona de toque. Todo lo demás es `listening={false}` para que Konva
          no calcule el hit de cada silla; sin esto el elemento no se podría
          seleccionar ni arrastrar. Cubre también las sillas. */}
      <Rect
        x={seats > 0 ? -18 : -grow}
        y={seats > 0 ? -18 : -grow}
        width={seats > 0 ? width + 36 : width + grow * 2}
        height={seats > 0 ? height + 36 : height + grow * 2}
        fill="#000000"
        opacity={0}
        perfectDrawEnabled={false}
      />

      {/* Zona de mesero: un halo del color del mesero detrás de la mesa. Va
          antes del cuerpo para no tapar el estado (libre, ocupada…). */}
      {waiter && !live ? (
        <Rect
          x={seats > 0 ? -14 : -6}
          y={seats > 0 ? -14 : -6}
          width={width + (seats > 0 ? 28 : 12)}
          height={height + (seats > 0 ? 28 : 12)}
          cornerRadius={style.shape === "circle" ? (Math.min(width, height) + 28) / 2 : 18}
          fill={withAlpha(waiter.color, theme.dark ? 0.28 : 0.22)}
          stroke={waiter.color}
          strokeWidth={3}
          listening={false}
          perfectDrawEnabled={false}
        />
      ) : null}

      {body}

      {/* Nombre, ícono, marcador y cliente van en un grupo que contrarresta el
          giro del elemento Y el de la vista: la mesa gira, el texto sigue
          derecho. */}
      {live ? (
        <Group x={width / 2} y={height / 2} rotation={-(element.rotation + viewRotation)} listening={false}>
          <LiveText
            element={element}
            grow={grow}
            seatable={style.seatable}
            showLabel={style.showLabel}
            round={round}
            scale={screenScale}
            theme={theme}
            color={liveSeatable ? liveTone.text : theme.panelText}
            occupantName={occupantName}
            partySize={partySize}
            minutes={minutes}
            waiter={liveSeatable ? waiter : null}
            viewRotation={viewRotation}
          />
        </Group>
      ) : (
      <Group
        x={width / 2}
        y={height / 2}
        rotation={-(element.rotation + viewRotation)}
        listening={false}
      >
        {showIcon && iconY !== null ? (
          <CanvasIcon node={icon} color={type.color} size={24} x={0} y={iconY - height / 2} />
        ) : null}

        {style.showLabel ? (
          <LabelPill text={element.label} width={labelWidth} y={labelY - height / 2} escala={MS} theme={theme} />
        ) : null}

        {marker ? (
          <Group x={marker.x} y={marker.y}>
            <Circle
              radius={MARKER_RADIUS * MS}
              fill={colors.stroke}
              stroke={theme.mapBg}
              strokeWidth={2}
              perfectDrawEnabled={false}
            />
            <CanvasIcon node={icon} color={colors.onStroke} size={MARKER_ICON * MS} x={0} y={0} />
          </Group>
        ) : null}

        {waiter ? (
          <Group y={-height / 2 - (seats > 0 ? 34 * MS : 17 * MS)}>
            <Rect
              x={-Math.max(labelWidth, WAITER_MIN_WIDTH * MS) / 2}
              y={(-WAITER_HEIGHT * MS) / 2}
              width={Math.max(labelWidth, WAITER_MIN_WIDTH * MS)}
              height={WAITER_HEIGHT * MS}
              cornerRadius={(WAITER_HEIGHT * MS) / 2}
              fill={waiter.color}
            />
            <Text
              x={-Math.max(labelWidth, WAITER_MIN_WIDTH * MS) / 2 + 6}
              y={-WAITER_FONT * MS * 0.5 + 1}
              width={Math.max(labelWidth, WAITER_MIN_WIDTH * MS) - 12}
              align="center"
              text={waiter.label}
              fontSize={WAITER_FONT * MS}
              fontStyle="bold"
              fontFamily={CANVAS_FONT}
              fill="#ffffff"
              wrap="none"
              ellipsis
            />
          </Group>
        ) : null}

        {occupantText ? (
          <Group y={height / 2 + (seats > 0 ? 40 * MS : 20 * MS)}>
            <Rect
              x={-Math.max(labelWidth, OCCUPANT_MIN_WIDTH * MS) / 2}
              y={(-OCCUPANT_HEIGHT * MS) / 2}
              width={Math.max(labelWidth, OCCUPANT_MIN_WIDTH * MS)}
              height={OCCUPANT_HEIGHT * MS}
              cornerRadius={(OCCUPANT_HEIGHT * MS) / 2}
              fill={theme.status.ocupada.stroke}
              perfectDrawEnabled={false}
            />
            <Text
              x={-Math.max(labelWidth, OCCUPANT_MIN_WIDTH * MS) / 2 + 8}
              y={-OCCUPANT_FONT * MS * 0.5 + 1}
              width={Math.max(labelWidth, OCCUPANT_MIN_WIDTH * MS) - 16}
              align="center"
              text={occupantText}
              fontSize={OCCUPANT_FONT * MS}
              fontStyle="bold"
              fontFamily={CANVAS_FONT}
              fill={theme.status.ocupada.onStroke}
              wrap="none"
              ellipsis
            />
          </Group>
        ) : null}
      </Group>
      )}

      {selected ? (
        <Rect
          x={-6}
          y={-6}
          width={width + 12}
          height={height + 12}
          stroke={theme.accent}
          strokeWidth={2}
          dash={[6, 4]}
          cornerRadius={style.shape === "circle" ? (Math.min(width, height) + 12) / 2 : style.shape === "wall" ? 4 : 16}
          listening={false}
        />
      ) : null}
    </Group>
  );
}

/**
 * Lo que va escrito dentro de una mesa del plano en vivo, derecho en pantalla
 * (el grupo que lo envuelve ya deshace el giro). Los textos llevan el
 * nombre `live-text` (la inicial del mesero, `live-badge`): `verify:browser`
 * comprueba que no se salgan de su mesa ni se
 * pisen con los de otra.
 */
function LiveText({
  element,
  grow,
  seatable,
  showLabel,
  round,
  scale,
  theme,
  color,
  occupantName,
  partySize,
  minutes,
  waiter,
  viewRotation,
}: {
  element: LayoutElement;
  grow: number;
  seatable: boolean;
  showLabel: boolean;
  round: boolean;
  scale: number;
  theme: Theme;
  color: string;
  occupantName: string | null;
  partySize: number | null;
  minutes: number | null;
  waiter: { color: string; label: string } | null;
  viewRotation: number;
}) {
  const box = visibleBox(element.width + grow * 2, element.height + grow * 2, element.rotation + viewRotation);
  if (!seatable) {
    // Caja, baño, zona, barra…: solo su nombre, pequeño, si cabe dentro.
    const font = LIVE_MIN_FONT / scale;
    const innerW = box.w * 0.86;
    if (!showLabel || innerW * scale < 36 || box.h * 0.86 * scale < LIVE_MIN_FONT + 2) return null;
    return (
      <Text
        name="live-text"
        x={-innerW / 2}
        y={-font / 2}
        width={innerW}
        align="center"
        text={element.label}
        fontSize={font}
        fontStyle="bold"
        fontFamily={CANVAS_FONT}
        fill={theme.panelText}
        opacity={0.75}
        wrap="none"
        ellipsis
      />
    );
  }

  // El cliente, de la versión más completa a la más corta: si «Ricardo G. · 4»
  // no cabe, «Ricardo · 4», y si no, solo el nombre.
  const first = occupantName?.trim().split(/\s+/)[0] ?? "";
  const people = partySize ? ` · ${partySize}` : "";
  const who = occupantName
    ? [...new Set([`${shortName(occupantName)}${people}`, `${shortName(first)}${people}`, shortName(occupantName), shortName(first)])]
    : null;
  const lines = liveTextLines(
    box,
    round,
    scale,
    { label: element.label, who, time: occupantName && minutes !== null ? formatDuration(minutes) : null },
    measureText,
  );

  // La inicial del mesero en una esquina, sobre su color. Solo si la mesa se
  // ve de un tamaño razonable; si no, basta el color del borde.
  const side = Math.min(box.w, box.h) * scale;
  let badge = null;
  if (waiter && side >= LIVE_MIN_SIDE_FOR_BADGE) {
    const r = 10 / scale;
    // Sobre el borde, a las 10 y media en las redondas y en la esquina en las
    // demás: lejos del texto, que va en el centro.
    const reach = (Math.min(box.w, box.h) / 2) * Math.SQRT1_2;
    const bx = round ? -reach : -box.w / 2 + r * 0.55;
    const by = round ? -reach : -box.h / 2 + r * 0.55;
    badge = (
      <Group x={bx} y={by}>
        <Circle radius={r} fill={waiter.color} stroke={theme.panel} strokeWidth={1.5 / scale} perfectDrawEnabled={false} />
        <Text
          name="live-badge"
          x={-r}
          y={-6 / scale}
          width={r * 2}
          align="center"
          text={initialOf(waiter.label)}
          fontSize={LIVE_MIN_FONT / scale}
          fontStyle="bold"
          fontFamily={CANVAS_FONT}
          fill={readableOn(waiter.color)}
          wrap="none"
        />
      </Group>
    );
  }

  return (
    <>
      {lines.map((l, i) => (
        <Text
          key={i}
          name="live-text"
          x={-l.width / 2}
          y={l.y}
          width={l.width}
          align="center"
          text={l.text}
          fontSize={l.font}
          fontStyle={l.bold ? "bold" : "normal"}
          fontFamily={CANVAS_FONT}
          fill={color}
          wrap="none"
          ellipsis
        />
      ))}
      {badge}
    </>
  );
}

// `memo` porque el canvas repinta en cada `dragMove`: sin esto, mover una mesa
// re-renderiza las otras 40 del mapa.
export const ElementNode = memo(ElementNodeBase);
