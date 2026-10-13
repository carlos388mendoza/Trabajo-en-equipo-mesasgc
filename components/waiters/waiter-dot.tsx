"use client";

// El mesero, en pantalla: un círculo de su color, y nada más.
//
// Cada mesero se reconoce solo por su color (ver `lib/waiters/palette.ts`).
// Para quien no ve los colores: el círculo lleva el nombre del color oculto
// para lectores de pantalla («Mesero rojo»), un `title` para el mouse y, al
// mantenerlo presionado en la tablet, un globo con el nombre del color.

import { useEffect, useRef, useState } from "react";

import { waiterColorName, waiterLabel } from "@/lib/waiters/palette";

type Props = {
  /** null: el cliente no tiene mesero (o ya no se sabe su color). */
  color: string | null;
  /** Diámetro en px. */
  size?: number;
  /** Elegido (un filtro activo): un anillo fino de su color alrededor. */
  selected?: boolean;
  className?: string;
};

export function WaiterDot({ color, size = 14, selected = false, className = "" }: Props) {
  const [tip, setTip] = useState(false);
  const holdTimer = useRef<number | null>(null);
  const hideTimer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (holdTimer.current) window.clearTimeout(holdTimer.current);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    },
    [],
  );
  const label = color ? waiterLabel(color) : "Sin mesero";
  const name = color ? waiterColorName(color) : "Sin mesero";
  const start = () => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => {
      setTip(true);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
      hideTimer.current = window.setTimeout(() => setTip(false), 1800);
    }, 450);
  };
  const stop = () => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
  };
  return (
    <span
      title={name}
      onPointerDown={start}
      onPointerUp={stop}
      onPointerLeave={stop}
      onPointerCancel={stop}
      className={`relative inline-block shrink-0 rounded-full ${color ? "" : "border-2 border-dashed border-panel-muted"} ${className}`}
      style={{
        width: size,
        height: size,
        backgroundColor: color ?? "transparent",
        // El anillo: un hueco del color del panel y luego el color del mesero.
        boxShadow: selected && color ? `0 0 0 2px rgb(var(--c-panel)), 0 0 0 4px ${color}` : undefined,
      }}
    >
      <span className="sr-only">{label}</span>
      {tip ? (
        <span
          role="tooltip"
          className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 -translate-x-1/2 whitespace-nowrap rounded-lg bg-panel px-2 py-1 text-xs font-semibold text-panel-text shadow-lg ring-1 ring-app-border"
        >
          {name}
        </span>
      ) : null}
    </span>
  );
}
