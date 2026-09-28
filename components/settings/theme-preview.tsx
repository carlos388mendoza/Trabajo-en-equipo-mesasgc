"use client";

// Vista previa del mapa para la página de Ajustes.
//
// Un plano pequeño en SVG con lo mismo que el editor: rejilla, paredes con
// brillo, una zona translúcida, mesas en los tres estados con su marcador, un
// panel flotante con un botón de acento y la leyenda. Se dibuja con el objeto
// `Theme` que se le pasa, así que cambia en vivo al mover un selector de color,
// antes incluso de que se aplique al resto de la app.

import { useId } from "react";

import { STATUS_LABELS, STATUS_ORDER } from "@/lib/layout/element-style";
import { type StatusKey, type Theme, withAlpha } from "@/lib/theme/theme";

const W = 360;
const H = 220;

// El color de la zona NO es del tema: en el editor sale de `element_types`
// (el tipo "Área de juegos" del seed). Aquí se usa ese mismo como ejemplo.
const ZONE_COLOR = "#f59e0b";

const TABLES: { x: number; y: number; status: StatusKey; label: string }[] = [
  { x: 92, y: 96, status: "ocupada", label: "Mesa 1" },
  { x: 162, y: 96, status: "libre", label: "Mesa 2" },
  { x: 92, y: 160, status: "libre", label: "Mesa 3" },
  { x: 162, y: 160, status: "reservada", label: "Mesa 4" },
];

export function ThemePreview({ theme }: { theme: Theme }) {
  // Ids únicos para los filtros: puede haber más de una vista previa.
  const id = useId().replace(/:/g, "");
  const glowId = `glow-${id}`;

  const grid: React.ReactNode[] = [];
  for (let x = 30; x < W - 20; x += 15) {
    grid.push(
      <line
        key={`v${x}`}
        x1={x}
        y1={52}
        x2={x}
        y2={H - 20}
        stroke={(x - 30) % 60 === 0 ? theme.gridMajor : theme.grid}
        strokeWidth={1}
      />,
    );
  }
  for (let y = 52; y < H - 20; y += 15) {
    grid.push(
      <line
        key={`h${y}`}
        x1={20}
        y1={y}
        x2={W - 20}
        y2={y}
        stroke={(y - 52) % 60 === 0 ? theme.gridMajor : theme.grid}
        strokeWidth={1}
      />,
    );
  }

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      role="img"
      aria-label={`Vista previa del mapa con el tema ${theme.name}`}
      className="h-auto w-full rounded-2xl"
    >
      <defs>
        <filter id={glowId} x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation={theme.dark ? 3 : 2} result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <rect x={0} y={0} width={W} height={H} fill={theme.appBg} />
      {/* Plano */}
      <rect x={20} y={44} width={W - 40} height={H - 64} rx={10} fill={theme.mapBg} />
      {grid}
      <rect
        x={20}
        y={44}
        width={W - 40}
        height={H - 64}
        rx={10}
        fill="none"
        stroke={theme.line}
        strokeWidth={2.5}
        filter={`url(#${glowId})`}
      />

      {/* Zona translúcida */}
      <rect
        x={222}
        y={122}
        width={92}
        height={62}
        rx={10}
        fill={withAlpha(ZONE_COLOR, theme.dark ? 0.2 : 0.14)}
        stroke={ZONE_COLOR}
        strokeWidth={2}
        strokeDasharray="8 5"
        filter={`url(#${glowId})`}
      />

      {/* Mesas */}
      {TABLES.map((t) => {
        const c = theme.status[t.status];
        return (
          <g key={t.label}>
            <circle
              cx={t.x}
              cy={t.y}
              r={22}
              fill={c.fill}
              stroke={c.stroke}
              strokeWidth={2.5}
              filter={`url(#${glowId})`}
            />
            <rect
              x={t.x - 20}
              y={t.y - 7}
              width={40}
              height={14}
              rx={7}
              fill={withAlpha(theme.panel, 0.92)}
              stroke={theme.border}
            />
            <text
              x={t.x}
              y={t.y + 3.5}
              textAnchor="middle"
              fontSize={9}
              fontWeight={700}
              fill={theme.panelText}
            >
              {t.label}
            </text>
            <circle cx={t.x + 16} cy={t.y - 16} r={6} fill={c.stroke} stroke={theme.mapBg} strokeWidth={1.5} />
          </g>
        );
      })}
      {/* Selección, con el color de acento */}
      <circle cx={162} cy={96} r={28} fill="none" stroke={theme.accent} strokeWidth={2} strokeDasharray="5 4" />

      {/* Panel flotante con botón de acento */}
      <rect x={28} y={10} width={200} height={26} rx={9} fill={withAlpha(theme.panel, 0.85)} stroke={theme.border} />
      <rect x={34} y={15} width={52} height={16} rx={6} fill={theme.accent} />
      <text x={60} y={26.5} textAnchor="middle" fontSize={9} fontWeight={700} fill={theme.accentText}>
        Guardar
      </text>
      <text x={96} y={26.5} fontSize={9} fill={theme.panelText}>
        Deshacer · Girar · Zoom
      </text>

      {/* Leyenda */}
      <rect x={W - 104} y={10} width={84} height={26} rx={9} fill={withAlpha(theme.panel, 0.85)} stroke={theme.border} />
      {STATUS_ORDER.map((s, i) => (
        <g key={s}>
          <circle cx={W - 94 + i * 26} cy={23} r={4.5} fill={theme.status[s].fill} stroke={theme.status[s].stroke} strokeWidth={2}>
            <title>{STATUS_LABELS[s]}</title>
          </circle>
        </g>
      ))}
    </svg>
  );
}
