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
import { Circle, Group, Rect, Text } from "react-konva";
import Konva from "konva";

import { elementStyle, visibleSeats, visualStatus } from "@/lib/layout/element-style";
import type { ElementTypeInfo, LayoutElement } from "@/lib/layout/types";
import { type Theme, withAlpha } from "@/lib/theme/theme";

import { CanvasIcon } from "./canvas-icon";
import { typeIcon } from "./icons";

export const CANVAS_FONT =
  "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

const LABEL_FONT = 12;
const LABEL_HEIGHT = 20;
const MARKER_RADIUS = 11;

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
  theme,
}: {
  text: string;
  width: number;
  y: number;
  theme: Theme;
}) {
  return (
    <Group y={y} listening={false}>
      <Rect
        x={-width / 2}
        y={-LABEL_HEIGHT / 2}
        width={width}
        height={LABEL_HEIGHT}
        cornerRadius={LABEL_HEIGHT / 2}
        fill={withAlpha(theme.panel, 0.92)}
        stroke={theme.border}
        strokeWidth={1}
      />
      <Text
        x={-width / 2}
        y={-LABEL_FONT / 2 + 1}
        width={width}
        align="center"
        text={text}
        fontSize={LABEL_FONT}
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
  onDragStart,
  onDragMove,
  onDragEnd,
  registerNode,
}: Props) {
  const waveRef = useRef<Konva.Circle | null>(null);
  const echoRef = useRef<Konva.Circle | null>(null);

  const style = elementStyle(type);
  const { width, height } = element;
  const status = visualStatus(element);
  const colors = theme.status[status];
  const icon = typeIcon(type.key).node;
  const baseRadius = Math.max(width, height) / 2 + 6;

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
          ring.to({
            radius: baseRadius * 2.2,
            strokeWidth: 1,
            opacity: 0,
            duration: 0.9,
            easing: Konva.Easings.EaseOut,
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

  // La etiqueta cabe DENTRO del elemento, para no tapar las sillas de los
  // lados. Un nombre largo se corta con "…" en vez de salirse.
  const labelWidth = Math.max(44, Math.min(width - (style.seatable ? 12 : 16), 132));
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

  // Marcador de las mesas: arriba a la derecha, sobre el borde. Las zonas,
  // baños y cajas ya llevan su ícono en el centro.
  const marker = style.seatable
    ? style.shape === "circle"
      ? { x: radius * 0.72, y: -radius * 0.72 }
      : { x: width / 2 - 6, y: -height / 2 + 6 }
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
      draggable
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
    >
      {/* Ondas del pulso en vivo. Invisibles salvo durante la animación. */}
      <Circle
        ref={waveRef}
        x={width / 2}
        y={height / 2}
        radius={baseRadius}
        stroke={colors.stroke}
        strokeWidth={4}
        opacity={0}
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

        <LabelPill text={element.label} width={labelWidth} y={labelY - height / 2} theme={theme} />

        {marker ? (
          <Group x={marker.x} y={marker.y}>
            <Circle
              radius={MARKER_RADIUS}
              fill={colors.stroke}
              stroke={theme.mapBg}
              strokeWidth={2}
              {...glow(colors.stroke, theme, 0.8)}
            />
            <CanvasIcon node={icon} color={colors.onStroke} size={13} x={0} y={0} />
          </Group>
        ) : null}

        {occupantText ? (
          <Group y={height / 2 + (seats > 0 ? 34 : 16)}>
            <Rect
              x={-Math.max(labelWidth, 120) / 2}
              y={-11}
              width={Math.max(labelWidth, 120)}
              height={22}
              cornerRadius={11}
              fill={theme.status.ocupada.stroke}
              {...glow(theme.status.ocupada.stroke, theme, 0.6)}
            />
            <Text
              x={-Math.max(labelWidth, 120) / 2 + 8}
              y={-6}
              width={Math.max(labelWidth, 120) - 16}
              align="center"
              text={occupantText}
              fontSize={11}
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
          cornerRadius={style.shape === "circle" ? (Math.min(width, height) + 12) / 2 : 16}
          listening={false}
        />
      ) : null}
    </Group>
  );
}

// `memo` porque el canvas repinta en cada `dragMove`: sin esto, mover una mesa
// re-renderiza las otras 40 del mapa.
export const ElementNode = memo(ElementNodeBase);
