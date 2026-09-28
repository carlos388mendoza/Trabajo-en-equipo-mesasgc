"use client";

// Un elemento colocado en el mapa.
//
// Se dibuja como un `Group` con su propio dibujo por tipo: mesa redonda con
// sillas, mesa con butaca en U, zona de juegos con patrón, baño y caja con su
// ícono. El Group es lo único arrastrable, así que Konva solo mueve un
// elemento y nunca el resto de la escena.
//
// El Group se posiciona por su CENTRO (`offset` = mitad del tamaño) para que
// girar un elemento lo gire sobre sí mismo y no sobre su esquina. En la base
// de datos `x`/`y` siguen siendo la esquina superior izquierda sin girar: la
// conversión se hace aquí y en el Transformer del canvas.

import { memo, useEffect, useRef } from "react";
import type { ReactNode } from "react";
import { Circle, Group, Rect, Text } from "react-konva";
import type Konva from "konva";

import {
  SELECTED_STROKE,
  STATUS_COLORS,
  elementStyle,
  shade,
  visibleSeats,
  visualStatus,
} from "@/lib/layout/element-style";
import type { ElementTypeInfo, LayoutElement } from "@/lib/layout/types";

import { CanvasIcon } from "./canvas-icon";
import { typeIcon } from "./icons";

export const CANVAS_FONT =
  "ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

const LABEL_FONT = 12;
const LABEL_HEIGHT = 20;
const INK = "#111827";

// Sombra ligera, solo en el cuerpo del elemento: en Konva las sombras son
// caras, y en las sillas no aportan nada.
const SHADOW = {
  shadowColor: "#0f172a",
  shadowBlur: 6,
  shadowOffsetY: 2,
  shadowOpacity: 0.14,
  shadowForStrokeEnabled: false,
} as const;

type Props = {
  element: LayoutElement;
  type: ElementTypeInfo;
  selected: boolean;
  /** Nombre del cliente sentado; null si la mesa está libre. */
  occupantName: string | null;
  /** Minutos que lleva sentado; null si no se sabe. */
  minutes: number | null;
  /**
   * Cambia cada vez que la mesa cambia por un evento en vivo. Cada cambio
   * dispara el pulso; el valor en sí no importa.
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

// Patrón de rayas para la zona de juegos. Un canvas pequeño por color, creado
// la primera vez que se necesita (este archivo solo corre en el navegador).
const patterns = new Map<string, HTMLCanvasElement>();

function stripePattern(color: string): HTMLCanvasElement {
  let canvas = patterns.get(color);
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.width = 16;
    canvas.height = 16;
    const ctx = canvas.getContext("2d");
    if (ctx) {
      ctx.fillStyle = shade(color, 115);
      ctx.fillRect(0, 0, 16, 16);
      ctx.strokeStyle = shade(color, 70);
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.moveTo(-4, 20);
      ctx.lineTo(20, -4);
      ctx.moveTo(-4, 4);
      ctx.lineTo(4, -4);
      ctx.moveTo(12, 20);
      ctx.lineTo(20, 12);
      ctx.stroke();
    }
    patterns.set(color, canvas);
  }
  return canvas;
}

/** Etiqueta blanca con el nombre: se lee sobre cualquier color. */
function LabelPill({ text, width, y }: { text: string; width: number; y: number }) {
  return (
    <Group y={y} listening={false}>
      <Rect
        x={-width / 2}
        y={-LABEL_HEIGHT / 2}
        width={width}
        height={LABEL_HEIGHT}
        cornerRadius={LABEL_HEIGHT / 2}
        fill="#ffffff"
        opacity={0.95}
        stroke="#e5e7eb"
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
        fill={INK}
        wrap="none"
        ellipsis
      />
    </Group>
  );
}

function ElementNodeBase({
  element,
  type,
  selected,
  occupantName,
  minutes,
  pulse,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  registerNode,
}: Props) {
  const groupRef = useRef<Konva.Group | null>(null);
  const haloRef = useRef<Konva.Rect | null>(null);

  const style = elementStyle(type);
  const { width, height } = element;
  const status = visualStatus(element);
  const colors = STATUS_COLORS[status];
  const icon = typeIcon(type.key).node;

  // Pulso corto cuando la mesa cambia por un evento en vivo: crece un poco,
  // vuelve, y un halo del color del nuevo estado se desvanece. Se salta el
  // primer render (pulse = 0): solo avisa de cambios, no de lo que ya estaba.
  const firstPulse = useRef(pulse);
  useEffect(() => {
    if (pulse === firstPulse.current) return;
    const group = groupRef.current;
    const halo = haloRef.current;
    if (!group) return;
    group.to({
      scaleX: 1.08,
      scaleY: 1.08,
      duration: 0.14,
      onFinish: () => group.to({ scaleX: 1, scaleY: 1, duration: 0.22 }),
    });
    if (halo) {
      halo.opacity(0.6);
      halo.to({ opacity: 0, duration: 0.7 });
    }
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
            strokeWidth={2}
            listening={false}
            {...SHADOW}
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
            strokeWidth={2}
            listening={false}
            {...SHADOW}
          />
        </>
      );
      labelY = (height - bench) / 2;
      break;
    }

    case "zone":
      body = (
        <Rect
          x={0}
          y={0}
          width={width}
          height={height}
          cornerRadius={16}
          fillPatternImage={stripePattern(type.color) as unknown as HTMLImageElement}
          stroke={type.color}
          strokeWidth={2}
          dash={[10, 6]}
          listening={false}
        />
      );
      iconY = height / 2 - 16;
      labelY = height / 2 + 14;
      break;

    default:
      // Baño, caja y cualquier tipo nuevo: tarjeta con su ícono.
      body = (
        <Rect
          x={0}
          y={0}
          width={width}
          height={height}
          cornerRadius={12}
          fill={shade(type.color, 115)}
          stroke={type.color}
          strokeWidth={2}
          listening={false}
          {...SHADOW}
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

  return (
    <Group
      ref={(node) => {
        groupRef.current = node;
        registerNode(element.id, node);
      }}
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
      {/* Halo del pulso en vivo. Invisible salvo durante la animación. */}
      <Rect
        ref={haloRef}
        x={-10}
        y={-10}
        width={width + 20}
        height={height + 20}
        cornerRadius={style.shape === "circle" ? (Math.min(width, height) + 20) / 2 : 18}
        fill={colors.stroke}
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

      {/* Nombre, ícono y cliente van en un grupo que contrarresta el giro del
          elemento: la mesa gira, el texto sigue derecho. */}
      <Group x={width / 2} y={height / 2} rotation={-element.rotation} listening={false}>
        {showIcon && iconY !== null ? (
          <CanvasIcon
            node={icon}
            color={type.color}
            size={24}
            x={0}
            y={iconY - height / 2}
          />
        ) : null}

        <LabelPill text={element.label} width={labelWidth} y={labelY - height / 2} />

        {occupantText ? (
          <Group y={height / 2 + (seats > 0 ? 34 : 16)}>
            <Rect
              x={-Math.max(labelWidth, 120) / 2}
              y={-11}
              width={Math.max(labelWidth, 120)}
              height={22}
              cornerRadius={11}
              fill={STATUS_COLORS.ocupada.stroke}
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
              fill="#ffffff"
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
          stroke={SELECTED_STROKE}
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
