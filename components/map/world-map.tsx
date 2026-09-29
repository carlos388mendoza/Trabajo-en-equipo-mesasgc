"use client";

// Mapa general: todos los restaurantes sobre un mapa radar propio.
//
// Es SVG y no Konva a propósito: son unas decenas de figuras que casi no se
// mueven, y en SVG los colores salen de las clases de Tailwind del tema
// (`fill-map-bg`, `stroke-alerta`...), así que el primer HTML ya viene con el
// tema bueno y no hay destello al hidratar.
//
// Cada marcador lleva:
//  - el color de su marca y, dentro, los clientes en espera;
//  - un anillo con el % de mesas ocupadas;
//  - debajo, la espera media actual;
//  - si la espera pasa de 20 min, un halo amarillo que pulsa y un triángulo;
//    si pasa de 40, un halo rojo más grueso y más rápido y un octógono. La
//    alerta se distingue por la forma, no solo por el color.
//
// Al tocar un marcador, el `viewBox` se acerca a él (zoom) y encima aparece
// el plano en vivo del restaurante; "Volver al mapa general" hace lo mismo al
// revés. Los datos en vivo llegan por la sala `overview` (solo contadores).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowLeft, Clock, OctagonAlert, Radio, TriangleAlert, Users, WifiOff } from "lucide-react";

import { LivePlan } from "@/components/map/live-plan";
import { useOverviewSocket } from "@/components/map/use-overview-socket";
import {
  WAIT_DANGER_MIN,
  WAIT_WARNING_MIN,
  type WaitLevel,
  averageWaitMinutes,
  waitLevel,
} from "@/lib/map/counters";
import type { BrandInfo, MapRestaurant } from "@/lib/map/queries";
import { CITIES, DISTRICTS, HIGHWAY, WORLD_SIZE, pointsAttr } from "@/lib/map/world";
import type { RestaurantCounters } from "@/lib/realtime/events";
import { readableOn } from "@/lib/theme/theme";

type ViewBox = [number, number, number, number];

// Encuadre del mapa entero: lo dibujado, sin el margen vacío del lienzo.
const FULL_VIEW: ViewBox = [40, 20, 940, 920];
/** Lo que se ve al final del zoom: un cuadrado de este lado alrededor del marcador. */
const ZOOM_SIDE = 90;
const ZOOM_MS = 700;
const FADE_MS = 300;
/** Color de un restaurante sin marca. */
const NO_BRAND_COLOR = "#94a3b8";

type Phase = "mapa" | "entrando" | "plano" | "saliendo";

const ALERT_ICON: Record<Exclude<WaitLevel, "normal">, LucideIcon> = {
  alerta: TriangleAlert,
  critica: OctagonAlert,
};

const LEVEL_LABEL: Record<WaitLevel, string> = {
  normal: "Espera normal",
  alerta: `Más de ${WAIT_WARNING_MIN} min`,
  critica: `Más de ${WAIT_DANGER_MIN} min`,
};

function easeInOut(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
}

function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function occupancy(c: RestaurantCounters | undefined): number {
  if (!c || c.tablesTotal === 0) return 0;
  return c.tablesOccupied / c.tablesTotal;
}

type Row = {
  restaurant: MapRestaurant;
  counters: RestaurantCounters | undefined;
  minutes: number;
  level: WaitLevel;
  color: string;
};

type Props = {
  restaurants: MapRestaurant[];
  brands: BrandInfo[];
  initialCounters: RestaurantCounters[];
};

export function WorldMap({ restaurants, brands, initialCounters }: Props) {
  const { counters, status } = useOverviewSocket(initialCounters);
  const [now, setNow] = useState(() => Date.now());
  const [brandFilter, setBrandFilter] = useState<string[]>([]);
  const [city, setCity] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("mapa");
  const [viewBox, setViewBox] = useState<ViewBox>(FULL_VIEW);
  const frame = useRef<number | null>(null);
  const viewRef = useRef<ViewBox>(FULL_VIEW);

  // La espera media avanza sola: basta con mover el reloj.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => () => {
    if (frame.current !== null) window.cancelAnimationFrame(frame.current);
  }, []);

  const cities = useMemo(
    () => [...new Set(restaurants.map((r) => r.city).filter((c): c is string => Boolean(c)))].sort(),
    [restaurants],
  );

  const rows: Row[] = useMemo(() => {
    return restaurants
      .filter((r) => brandFilter.length === 0 || (r.brand && brandFilter.includes(r.brand.id)))
      .filter((r) => !city || r.city === city)
      .map((restaurant) => {
        const c = counters[restaurant.id];
        const minutes = c ? averageWaitMinutes(c, now) : 0;
        return {
          restaurant,
          counters: c,
          minutes,
          level: waitLevel(minutes),
          color: restaurant.brand?.accentColor ?? NO_BRAND_COLOR,
        };
      })
      .sort((a, b) => b.minutes - a.minutes || (b.counters?.waiting ?? 0) - (a.counters?.waiting ?? 0));
  }, [restaurants, brandFilter, city, counters, now]);

  /** Anima el `viewBox` hasta `to` y luego llama a `done`. */
  const animateTo = useCallback((to: ViewBox, done: () => void) => {
    if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    const from = viewRef.current;
    const duration = prefersReducedMotion() ? 0 : ZOOM_MS;
    const start = performance.now();
    const step = (time: number) => {
      const t = duration === 0 ? 1 : Math.min(1, (time - start) / duration);
      const k = easeInOut(t);
      const next = from.map((v, i) => v + (to[i] - v) * k) as ViewBox;
      viewRef.current = next;
      setViewBox(next);
      if (t < 1) frame.current = window.requestAnimationFrame(step);
      else {
        frame.current = null;
        done();
      }
    };
    frame.current = window.requestAnimationFrame(step);
  }, []);

  const open = useCallback(
    (restaurant: MapRestaurant) => {
      setSelectedId(restaurant.id);
      // Sin posición en el mapa, o con otro plano ya abierto: sin zoom.
      if (restaurant.mapX === null || restaurant.mapY === null || phase === "plano") {
        setPhase("plano");
        return;
      }
      setPhase("entrando");
      const half = ZOOM_SIDE / 2;
      animateTo([restaurant.mapX - half, restaurant.mapY - half, ZOOM_SIDE, ZOOM_SIDE], () => setPhase("plano"));
    },
    [animateTo, phase],
  );

  const close = useCallback(() => {
    setPhase("saliendo");
    window.setTimeout(
      () => {
        animateTo(FULL_VIEW, () => {
          setPhase("mapa");
          setSelectedId(null);
        });
      },
      prefersReducedMotion() ? 0 : FADE_MS,
    );
  }, [animateTo]);

  useEffect(() => {
    if (phase !== "plano") return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [phase, close]);

  const selected = selectedId ? restaurants.find((r) => r.id === selectedId) ?? null : null;
  const selectedRow = selected ? rows.find((r) => r.restaurant.id === selected.id) : undefined;
  const planVisible = phase === "plano";

  return (
    <div className="flex flex-col gap-3">
      {/* Filtros y estado de la conexión */}
      <div className="flex flex-wrap items-center gap-2">
        <div role="group" aria-label="Filtrar por marca" className="flex flex-wrap gap-1.5">
          {brands.map((b) => {
            const active = brandFilter.includes(b.id);
            return (
              <button
                key={b.id}
                type="button"
                aria-pressed={active}
                onClick={() =>
                  setBrandFilter((prev) => (active ? prev.filter((id) => id !== b.id) : [...prev, b.id]))
                }
                className={`flex h-10 items-center gap-2 rounded-full px-3.5 text-sm font-medium ring-1 transition ${
                  active
                    ? "bg-panel text-panel-text ring-2 ring-accent"
                    : "bg-panel text-panel-muted ring-app-border hover:text-panel-text"
                }`}
              >
                <span aria-hidden className="h-3 w-3 rounded-full" style={{ backgroundColor: b.accentColor }} />
                {b.name}
              </button>
            );
          })}
        </div>
        <label className="flex h-10 items-center gap-2 rounded-full bg-panel px-3.5 text-sm text-panel-muted ring-1 ring-app-border">
          Ciudad
          <select
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="bg-transparent font-medium text-panel-text outline-none"
          >
            <option value="">Todas</option>
            {cities.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        {brandFilter.length > 0 || city ? (
          <button
            type="button"
            onClick={() => {
              setBrandFilter([]);
              setCity("");
            }}
            className="h-10 rounded-full px-3 text-sm font-medium text-accent hover:underline"
          >
            Quitar filtros
          </button>
        ) : null}
        <span
          className={`ml-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold ring-1 ring-app-border ${
            status === "en-vivo" ? "bg-panel text-estado-libre" : "bg-panel text-panel-muted"
          }`}
        >
          {status === "en-vivo" ? <Radio aria-hidden size={14} /> : <WifiOff aria-hidden size={14} />}
          {status === "en-vivo" ? "En vivo" : status === "conectando" ? "Conectando…" : "Sin conexión: se actualiza cada 30 s"}
        </span>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* Mapa */}
        <div className="relative h-[62vh] min-h-[26rem] overflow-hidden rounded-2xl bg-map-bg ring-1 ring-app-border lg:h-[calc(100vh-12rem)]">
          <svg
            viewBox={viewBox.join(" ")}
            preserveAspectRatio="xMidYMid meet"
            className="h-full w-full touch-manipulation select-none"
            role="group"
            aria-label="Mapa general de restaurantes"
          >
            <defs>
              <pattern id="map-grid" width="25" height="25" patternUnits="userSpaceOnUse">
                <path d="M 25 0 L 0 0 0 25" fill="none" className="stroke-map-grid" strokeWidth="1" />
              </pattern>
              <linearGradient id="map-sweep" x1="0" y1="0" x2="1" y2="0">
                <stop offset="0" stopOpacity="0" className="[stop-color:rgb(var(--c-line))]" />
                <stop offset="1" stopOpacity="0.1" className="[stop-color:rgb(var(--c-line))]" />
              </linearGradient>
            </defs>

            <rect x={-WORLD_SIZE} y={-WORLD_SIZE} width={WORLD_SIZE * 3} height={WORLD_SIZE * 3} fill="url(#map-grid)" />

            {/* Anillos y cruz del radar */}
            <g className="stroke-map-line/15" fill="none" strokeWidth="1.5" strokeDasharray="4 8">
              {[160, 320, 480, 640].map((r) => (
                <circle key={r} cx={500} cy={500} r={r} />
              ))}
              <line x1={500} y1={-200} x2={500} y2={1200} />
              <line x1={-200} y1={500} x2={1200} y2={500} />
            </g>
            <path d="M 500 500 L 1200 500 A 700 700 0 0 0 1106 150 Z" fill="url(#map-sweep)" className="map-sweep" />

            {/* Distritos */}
            {DISTRICTS.map((d) => (
              <g key={d.id}>
                <polygon
                  points={pointsAttr(d.points)}
                  className="fill-map-line/[0.06] stroke-map-line/50"
                  strokeWidth="2"
                  strokeLinejoin="round"
                />
                <text x={d.label[0]} y={d.label[1]} className="fill-map-line/70" fontSize="20" fontWeight="600" letterSpacing="1">
                  {d.name}
                </text>
              </g>
            ))}
            {CITIES.map((c) => (
              <text key={c.name} x={c.label[0]} y={c.label[1]} className="fill-map-line" fontSize="34" fontWeight="800" letterSpacing="1">
                {c.name}
              </text>
            ))}
            <path d={HIGHWAY.path} fill="none" className="stroke-map-line/40" strokeWidth="4" strokeDasharray="10 8" strokeLinecap="round" />
            <text x={HIGHWAY.labelAt[0]} y={HIGHWAY.labelAt[1]} className="fill-map-line/70" fontSize="18" fontWeight="700">
              {HIGHWAY.label}
            </text>

            {/* Marcadores */}
            {rows.map((row) =>
              row.restaurant.mapX === null || row.restaurant.mapY === null ? null : (
                <Marker key={row.restaurant.id} row={row} onOpen={() => open(row.restaurant)} disabled={phase !== "mapa"} />
              ),
            )}
          </svg>

          <Legend brands={brands} />

          {/* Plano en vivo, encima del mapa */}
          {selected ? (
            <div
              className={`absolute inset-0 z-10 bg-app-bg p-2 transition duration-300 ease-out ${
                planVisible ? "scale-100 opacity-100" : "pointer-events-none scale-95 opacity-0"
              }`}
              aria-hidden={!planVisible}
            >
              <LivePlan
                key={selected.id}
                restaurantId={selected.id}
                refreshSignal={counters[selected.id]}
                toolbar={
                  <>
                    <button
                      type="button"
                      onClick={close}
                      className="flex h-11 items-center gap-2 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-text shadow-sm active:scale-[0.98]"
                    >
                      <ArrowLeft aria-hidden size={18} strokeWidth={2.25} />
                      Volver al mapa general
                    </button>
                    <PlanSummary restaurant={selected} row={selectedRow} counters={counters[selected.id]} now={now} />
                  </>
                }
              />
            </div>
          ) : null}
        </div>

        {/* Lista lateral, por espera */}
        <aside aria-label="Restaurantes por espera" className="flex min-h-0 flex-col gap-2 lg:h-[calc(100vh-12rem)]">
          <h2 className="px-1 text-sm font-semibold text-app-muted">
            {rows.length} {rows.length === 1 ? "restaurante" : "restaurantes"}, por espera
          </h2>
          <ul className="flex min-h-0 flex-col gap-2 overflow-y-auto pb-1">
            {rows.map((row) => (
              <li key={row.restaurant.id}>
                <ListRow row={row} active={row.restaurant.id === selectedId} onOpen={() => open(row.restaurant)} />
              </li>
            ))}
            {rows.length === 0 ? (
              <li className="rounded-2xl bg-panel p-4 text-sm text-panel-muted ring-1 ring-app-border">
                Ningún restaurante coincide con los filtros.
              </li>
            ) : null}
          </ul>
        </aside>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Marcador
// ---------------------------------------------------------------------------

const RING_R = 30;
const RING_C = 2 * Math.PI * RING_R;

function Marker({ row, onOpen, disabled }: { row: Row; onOpen: () => void; disabled: boolean }) {
  const { restaurant, counters, minutes, level, color } = row;
  const waiting = counters?.waiting ?? 0;
  const pct = occupancy(counters);
  const Icon = level === "normal" ? null : ALERT_ICON[level];
  const label = `${restaurant.name}: ${waiting} en espera, espera media ${minutes} min, ${Math.round(pct * 100)} % de mesas ocupadas. ${LEVEL_LABEL[level]}.`;

  return (
    <g
      transform={`translate(${restaurant.mapX} ${restaurant.mapY})`}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      onClick={disabled ? undefined : onOpen}
      onKeyDown={(e) => {
        if (!disabled && (e.key === "Enter" || e.key === " ")) {
          e.preventDefault();
          onOpen();
        }
      }}
      className="group cursor-pointer outline-none"
    >
      <title>{label}</title>
      {/* Área de toque generosa (dedo en tablet). */}
      <circle r={54} fill="transparent" />
      {/* Foco con teclado */}
      <circle r={RING_R + 10} fill="none" className="stroke-accent opacity-0 group-focus-visible:opacity-100" strokeWidth={3} />

      {level === "alerta" ? (
        <circle r={RING_R + 9} fill="none" className="map-pulse stroke-alerta" strokeWidth={4} />
      ) : null}
      {level === "critica" ? (
        <>
          <circle r={RING_R + 8} fill="none" className="stroke-critica" strokeWidth={3} />
          <circle r={RING_R + 12} fill="none" className="map-pulse map-pulse-fast stroke-critica" strokeWidth={8} />
        </>
      ) : null}

      {/* Anillo de ocupación: pista + parte ocupada */}
      <circle r={RING_R} fill="none" className="stroke-map-line/20" strokeWidth={6} />
      <circle
        r={RING_R}
        fill="none"
        className="stroke-map-line transition-[stroke-dasharray] duration-700"
        strokeWidth={6}
        strokeLinecap="round"
        strokeDasharray={`${pct * RING_C} ${RING_C}`}
        transform="rotate(-90)"
      />
      <circle r={22} fill={color} className="stroke-map-bg transition-transform group-hover:scale-110" strokeWidth={2.5} />
      <text y={8} textAnchor="middle" fontSize={22} fontWeight={800} fill={readableOn(color)}>
        {waiting}
      </text>

      {Icon ? (
        <g transform={`translate(${RING_R - 2} ${-RING_R + 2})`}>
          <circle r={13} className={level === "critica" ? "fill-critica" : "fill-alerta"} />
          <Icon x={-8.5} y={-8.5} width={17} height={17} strokeWidth={2.5} className="text-map-bg" aria-hidden />
        </g>
      ) : null}

      <text
        y={RING_R + 28}
        textAnchor="middle"
        fontSize={21}
        fontWeight={700}
        className="fill-app-text stroke-map-bg"
        strokeWidth={5}
        paintOrder="stroke"
      >
        {restaurant.name}
      </text>
      <text
        y={RING_R + 50}
        textAnchor="middle"
        fontSize={18}
        fontWeight={600}
        className={`${level === "critica" ? "fill-critica" : level === "alerta" ? "fill-alerta" : "fill-app-muted"} stroke-map-bg`}
        strokeWidth={5}
        paintOrder="stroke"
      >
        {minutes} min · {Math.round(pct * 100)} %
      </text>
    </g>
  );
}

// ---------------------------------------------------------------------------
// Lista, leyenda y resumen del plano
// ---------------------------------------------------------------------------

function LevelBadge({ level }: { level: WaitLevel }) {
  if (level === "normal") return null;
  const Icon = ALERT_ICON[level];
  return (
    <span
      className={`flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
        level === "critica" ? "bg-critica/15 text-critica" : "bg-alerta/15 text-alerta"
      }`}
    >
      <Icon aria-hidden size={12} strokeWidth={2.5} />
      {LEVEL_LABEL[level]}
    </span>
  );
}

function ListRow({ row, active, onOpen }: { row: Row; active: boolean; onOpen: () => void }) {
  const { restaurant, counters, minutes, level, color } = row;
  const pct = Math.round(occupancy(counters) * 100);
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex w-full items-center gap-3 rounded-2xl bg-panel p-3 text-left text-panel-text ring-1 transition hover:ring-accent/60 active:scale-[0.99] ${
        active ? "ring-2 ring-accent" : "ring-app-border"
      }`}
    >
      <span aria-hidden className="h-9 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{restaurant.name}</span>
        <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-panel-muted">
          <span>{restaurant.city ?? "Sin ciudad"}</span>
          <span className="flex items-center gap-1">
            <Users aria-hidden size={12} /> {counters?.waiting ?? 0}
          </span>
          <span className="flex items-center gap-1">
            <Clock aria-hidden size={12} /> {minutes} min
          </span>
          <span>{pct} % ocupado</span>
        </span>
      </span>
      <LevelBadge level={level} />
    </button>
  );
}

function Legend({ brands }: { brands: BrandInfo[] }) {
  return (
    <div className="pointer-events-none absolute bottom-3 left-3 hidden max-w-[16rem] flex-col gap-2 rounded-2xl bg-panel/85 p-3 text-xs text-panel-text shadow-lg ring-1 ring-app-border backdrop-blur-md sm:flex">
      <p className="font-semibold">Leyenda</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        {brands.map((b) => (
          <span key={b.id} className="flex items-center gap-1.5">
            <span aria-hidden className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: b.accentColor }} />
            {b.name}
          </span>
        ))}
      </div>
      <ul className="space-y-1 text-panel-muted">
        <li className="flex items-center gap-2">
          <svg aria-hidden width="16" height="16" viewBox="-10 -10 20 20">
            <circle r="7" fill="none" className="stroke-map-line/25" strokeWidth="3" />
            <circle r="7" fill="none" className="stroke-map-line" strokeWidth="3" strokeDasharray="30 44" transform="rotate(-90)" />
          </svg>
          Anillo: % de mesas ocupadas
        </li>
        <li className="flex items-center gap-2">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-accent text-[9px] font-bold text-accent-text">3</span>
          Número: clientes en espera
        </li>
        <li className="flex items-center gap-2 text-alerta">
          <TriangleAlert aria-hidden size={16} strokeWidth={2.5} />
          Halo que pulsa: más de {WAIT_WARNING_MIN} min
        </li>
        <li className="flex items-center gap-2 text-critica">
          <OctagonAlert aria-hidden size={16} strokeWidth={2.5} />
          Halo grueso y rápido: más de {WAIT_DANGER_MIN} min
        </li>
      </ul>
    </div>
  );
}

function PlanSummary({
  restaurant,
  row,
  counters,
  now,
}: {
  restaurant: MapRestaurant;
  row: Row | undefined;
  counters: RestaurantCounters | undefined;
  now: number;
}) {
  const minutes = counters ? averageWaitMinutes(counters, now) : 0;
  const level = waitLevel(minutes);
  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl bg-panel px-3 py-1.5 text-sm text-panel-text ring-1 ring-app-border">
      <span aria-hidden className="h-3 w-3 rounded-full" style={{ backgroundColor: row?.color ?? restaurant.brand?.accentColor ?? NO_BRAND_COLOR }} />
      <span className="font-semibold">{restaurant.name}</span>
      <span className="text-panel-muted">
        {counters?.tablesOccupied ?? 0}/{counters?.tablesTotal ?? 0} mesas · {counters?.waiting ?? 0} en espera · {minutes} min
      </span>
      <LevelBadge level={level} />
    </div>
  );
}
