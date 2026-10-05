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
import { type Theme, withAlpha } from "@/lib/theme/theme";

import { CanvasIcon } from "./canvas-icon";
import { typeIcon } from "./icons";

export const CANVAS_FONT =
  "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

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
  /** Se llama en cada `dragMove` con la esquina superior izquierda. */
  onDragMove: (id: string, x: number, y: number) => void;
  onDragEnd: () => void;
  registerNode: (id: string, node: Konva.Group | null) => void;
};

/** Brillo suave alrededor de un trazo: lo que da el aire de "radar". */
function glow(color: string, theme: Theme, strength = 1) {
  return {
    shadowColor: color,
    shadowBlur: 10 * strength,
    shadowOpacity: (theme.dark ? 0.75 : 0.35) * strength,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    // Solo el trazo brilla; sin esto Konva calcula la sombra dos veces.
    shadowForStrokeEnabled: true,
  } as const;
}

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
  onDragMove,
  onDragEnd,
  registerNode,
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
  const seats = style.seatable ? visibleSeats(element.capacity) : 0;

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
            {...glow(colors.stroke, theme)}
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
            {...glow(colors.stroke, theme)}
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
          {...glow(type.color, theme, 0.8)}
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
            {...glow(type.color, theme, 0.8)}
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
            {...glow(type.color, theme, 0.6)}
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
            {...glow(type.color, theme, 0.8)}
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
          {...glow(theme.line, theme, 0.7)}
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
          {...glow(type.color, theme, 0.7)}
        />
      );
      iconY = height / 2 - 12;
      labelY = height / 2 + 16;
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
      name="table-element"
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
        // `x`/`y` vienen en coordenadas del lienzo y apuntan al centro (por el
        // `offset`); se devuelve la esquina, que es lo que se guarda.
        onDragMove(element.id, e.target.x() - width / 2, e.target.y() - height / 2);
      }}
      onDragEnd={onDragEnd}
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
        x={seats > 0 ? -18 : 0}
        y={seats > 0 ? -18 : 0}
        width={seats > 0 ? width + 36 : width}
        height={seats > 0 ? height + 36 : height}
        fill="#000000"
        opacity={0}
      />

      {/* Zona de mesero: un halo del color del mesero detrás de la mesa. Va
          antes del cuerpo para no tapar el estado (libre, ocupada…). */}
      {waiter ? (
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
          {...glow(waiter.color, theme, 0.7)}
        />
      ) : null}

      {body}

      {/* Nombre, ícono, marcador y cliente van en un grupo que contrarresta el
          giro del elemento Y el de la vista: la mesa gira, el texto sigue
          derecho. */}
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
              {...glow(colors.stroke, theme, 0.8)}
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
              {...glow(theme.status.ocupada.stroke, theme, 0.6)}
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

// `memo` porque el canvas repinta en cada `dragMove`: sin esto, mover una mesa
// re-renderiza las otras 40 del mapa.
export const ElementNode = memo(ElementNodeBase);
