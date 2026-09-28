"use client";

// Un elemento colocado en el mapa.
//
// Se dibuja como un `Group` posicionado en (x, y) que contiene la forma del
// tipo: mesa redonda con sillas, butaca con bancos, zona de juegos, etc. El
// Group es lo único arrastrable, así que Konva solo mueve un elemento y nunca
// el resto de la escena.

import { memo } from "react";
import type { ReactNode } from "react";
import { Circle, Group, Rect, Text } from "react-konva";
import type Konva from "konva";

import {
  OCCUPIED_FILL,
  OCCUPIED_STROKE,
  SELECTED_STROKE,
  elementStyle,
  visibleSeats,
} from "@/lib/layout/element-style";
import type { ElementTypeInfo, LayoutElement } from "@/lib/layout/types";

const LABEL_FONT = 11;

type Props = {
  element: LayoutElement;
  type: ElementTypeInfo;
  selected: boolean;
  onSelect: (id: string) => void;
  /** Avisa al canvas de que un arrastre empezó, para que suelte el Stage. */
  onDragStart: () => void;
  /** Se llama en cada `dragMove` para mover el elemento en vivo. */
  onDragMove: (id: string, x: number, y: number) => void;
  onDragEnd: () => void;
  registerNode: (id: string, node: Konva.Group | null) => void;
};

function ElementNodeBase({
  element,
  type,
  selected,
  onSelect,
  onDragStart,
  onDragMove,
  onDragEnd,
  registerNode,
}: Props) {
  const style = elementStyle(type);
  const occupied = element.currentEntryId !== null;
  const { width, height } = element;

  const fill = occupied ? OCCUPIED_FILL : style.fill;
  const stroke = occupied ? OCCUPIED_STROKE : style.stroke;

  const radius = Math.min(width, height) / 2;
  const seats = style.seatable ? visibleSeats(element.capacity) : 0;

  // Asientos alrededor de la mesa. Se dibujan como rectángulos small girados
  // para que "miren" hacia fuera, que es lo que hace que se lea de un vistazo
  // que es una mesa con sillas y no un círculo suelto.
  const chairs = [];
  for (let i = 0; i < seats; i += 1) {
    const angle = (360 / seats) * i;
    const rad = (angle * Math.PI) / 180;
    chairs.push(
      <Rect
        key={`seat-${i}`}
        x={width / 2 + Math.cos(rad) * radius * 1.22 - 6}
        y={height / 2 + Math.sin(rad) * radius * 1.22 - 4}
        width={12}
        height={8}
        offsetX={6}
        offsetY={4}
        rotation={angle}
        fill={occupied ? OCCUPIED_STROKE : style.stroke}
        opacity={0.55}
        listening={false}
      />,
    );
  }

  let shape: ReactNode;
  switch (style.shape) {
    case "circle":
      shape = (
        <>
          {chairs}
          <Circle
            x={width / 2}
            y={height / 2}
            radius={radius}
            fill={fill}
            stroke={stroke}
            strokeWidth={2}
            opacity={0.9}
            listening={false}
          />
        </>
      );
      break;

    case "booth":
      // La mesa en medio y dos bancos largos arriba y abajo: así se distingue
      // de una mesa normal de un vistazo.
      shape = (
        <>
          <Rect
            x={width * 0.1}
            y={height * 0.12}
            width={width * 0.8}
            height={height * 0.2}
            cornerRadius={3}
            fill={occupied ? OCCUPIED_STROKE : style.stroke}
            opacity={0.45}
            listening={false}
          />
          <Rect
            x={width * 0.1}
            y={height * 0.68}
            width={width * 0.8}
            height={height * 0.2}
            cornerRadius={3}
            fill={occupied ? OCCUPIED_STROKE : style.stroke}
            opacity={0.45}
            listening={false}
          />
          <Rect
            x={width * 0.12}
            y={height * 0.36}
            width={width * 0.76}
            height={height * 0.28}
            cornerRadius={4}
            fill={fill}
            stroke={stroke}
            strokeWidth={2}
            listening={false}
          />
        </>
      );
      break;

    case "zone":
      shape = (
        <Rect
          x={0}
          y={0}
          width={width}
          height={height}
          cornerRadius={style.cornerRadius}
          fill={fill}
          stroke={stroke}
          strokeWidth={2}
          dash={[10, 6]}
          opacity={0.75}
          listening={false}
        />
      );
      break;

    default:
      shape = (
        <Rect
          x={0}
          y={0}
          width={width}
          height={height}
          cornerRadius={style.cornerRadius}
          fill={fill}
          stroke={stroke}
          strokeWidth={2}
          opacity={0.9}
          listening={false}
        />
      );
  }

  return (
    <Group
      ref={(node) => registerNode(element.id, node)}
      id={element.id}
      name="table-element"
      x={element.x}
      y={element.y}
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
      onTouchStart={() => onSelect(element.id)}
      onDragStart={(e) => {
        e.cancelBubble = true;
        onSelect(element.id);
        onDragStart();
      }}
      onDragMove={(e) => {
        // `x`/`y` ya vienen en coordenadas del lienzo: Konva descuenta la
        // posición y la escala del Stage, así que no hay que hacer nada aquí.
        onDragMove(element.id, e.target.x(), e.target.y());
      }}
      onDragEnd={onDragEnd}
    >
      {shape}

      <Text
        x={0}
        y={height / 2 - LABEL_FONT / 2}
        width={width}
        align="center"
        text={element.label}
        fontSize={LABEL_FONT}
        fill={style.textColor}
        listening={false}
      />

      {/* Marca de ocupada. Es la única pista visual del paso 6, y se pinta en
          gris/rojo para que sea obvious que el dato viene de la base de datos
          y no de un estado local del editor. */}
      {occupied ? (
        <Text
          x={0}
          y={2}
          width={width}
          align="center"
          text="OCUPADA"
          fontSize={9}
          fill="#ffffff"
          listening={false}
        />
      ) : null}

      {selected ? (
        <Rect
          x={-5}
          y={-5}
          width={width + 10}
          height={height + 10}
          stroke={SELECTED_STROKE}
          strokeWidth={2}
          dash={[5, 4]}
          cornerRadius={style.cornerRadius + 4}
          listening={false}
        />
      ) : null}
    </Group>
  );
}

// `memo` porque el canvas repinta en cada `dragMove`: sin esto, mover una mesa
// re-renderiza las otras 40 del mapa.
export const ElementNode = memo(ElementNodeBase);
