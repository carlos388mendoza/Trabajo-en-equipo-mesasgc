"use client";

// Mapa general: todos los restaurantes sobre Honduras entero, en estilo radar.
//
// Es SVG y no Konva a propósito: son unas decenas de figuras que casi no se
// mueven, y en SVG los colores salen de las clases de Tailwind del tema
// (`fill-map-bg`, `stroke-alerta`...), así que el primer HTML ya viene con el
// tema bueno y no hay destello al hidratar.
//
// El dibujo (silueta, 18 departamentos, vecinos y ciudades) sale de
// `lib/map/world.ts`, en las unidades de `lib/map/projection.ts`. El
// `viewBox` es la cámara: la rueda y el pellizco lo acercan sobre el punto
// que se señala, arrastrar lo mueve, y los botones lo animan a todo el país o
// a una ciudad. Los rótulos y los marcadores se escalan con la cámara para
// verse siempre del mismo tamaño en pantalla, y las líneas no engordan
// (`vector-effect: non-scaling-stroke`).
//
// Cada marcador lleva:
//  - el color de su marca y, dentro, los clientes en espera;
//  - un anillo con el % de mesas ocupadas;
//  - debajo, la espera media actual;
//  - si la espera pasa de 20 min, un halo amarillo que pulsa y un triángulo;
//    si pasa de 40, un halo rojo más grueso y más rápido y un octógono. La
//    alerta se distingue por la forma, no solo por el color.
// Los que quedan encima unos de otros (los de una misma ciudad vista desde
// lejos) se juntan en un grupo con la suma y la peor alerta; tocarlo acerca.
//
// Al tocar un marcador, la cámara se acerca a él y encima aparece el plano en
// vivo del restaurante; "Volver al mapa general" vuelve a donde estaba. Los
// datos en vivo llegan por la sala `overview` (solo contadores).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeft,
  Clock,
  LocateFixed,
  Minus,
  OctagonAlert,
  Plus,
  Radio,
  Scan,
  TriangleAlert,
  Users,
  WifiOff,
} from "lucide-react";

import { LivePlan } from "@/components/map/live-plan";
import { useOverviewSocket } from "@/components/map/use-overview-socket";
import {
  WAIT_DANGER_MIN,
  WAIT_WARNING_MIN,
  type WaitLevel,
  averageWaitMinutes,
  waitLevel,
} from "@/lib/map/counters";
import { project } from "@/lib/map/projection";
import type { BrandInfo, MapRestaurant } from "@/lib/map/queries";
import {
  CITIES,
  DEPARTMENTS,
  FULL_VIEW,
  HONDURAS_PATH,
  MAP_HEIGHT,
  MAP_WIDTH,
  NEIGHBORS,
  type ViewBox,
  ZOOM_CITIES,
  cityView,
  clampView,
  viewAround,
  viewAroundPoints,
} from "@/lib/map/world";
import type { RestaurantCounters } from "@/lib/realtime/events";
import { readableOn } from "@/lib/theme/theme";

/** Al abrir un restaurante, la cámara llega a un encuadre de este ancho. */
const ZOOM_KM = 1.2;
const ZOOM_MS = 700;
const FADE_MS = 300;
/** Cada paso de los botones + y − acerca o aleja este factor. */
const BUTTON_ZOOM = 1.6;
/** Tamaño de un marcador a escala 1: por debajo de esta distancia se agrupan. */
const CLUSTER_DISTANCE = 64;
/** Color de un restaurante sin marca. */
const NO_BRAND_COLOR = "#94a3b8";

/** Rótulos del mar: ayudan a situarse. */
const WATERS = [
  { name: "Mar Caribe", ...project({ lat: 16.95, lng: -85.2 }) },
  { name: "Golfo de Honduras", ...project({ lat: 16.35, lng: -88.35 }) },
  { name: "Golfo de Fonseca", ...project({ lat: 13.15, lng: -87.95 }) },
  { name: "Océano Pacífico", ...project({ lat: 12.85, lng: -88.95 }) },
];

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

const LEVEL_ORDER: Record<WaitLevel, number> = { normal: 0, alerta: 1, critica: 2 };

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

type Placed = Row & { x: number; y: number };

type Cluster = { x: number; y: number; members: Placed[] };

/**
 * Junta los marcadores que se pisarían en pantalla. Voraz y en orden de
 * espera: el más urgente fija el centro del grupo, así que la alerta queda
 * donde está el problema.
 */
function clusterRows(rows: Placed[], distance: number): Cluster[] {
  const clusters: Cluster[] = [];
  for (const row of rows) {
    const near = clusters.find((c) => Math.hypot(c.x - row.x, c.y - row.y) < distance);
    if (near) near.members.push(row);
    else clusters.push({ x: row.x, y: row.y, members: [row] });
  }
  return clusters;
}

/**
 * Cómo cae el `viewBox` dentro del SVG con `preserveAspectRatio="xMidYMid
 * meet"`: la escala (píxeles por unidad) y dónde empieza, centrado. Se
 * calcula a mano en vez de con `getScreenCTM()`, que puede devolver null (o
 * una matriz vieja) mientras la pestaña no se ha pintado.
 */
function fitOf(el: Element, [, , w, h]: ViewBox) {
  const rect = el.getBoundingClientRect();
  const scale = Math.min(rect.width / w, rect.height / h) || 1;
  return { scale, left: rect.left + (rect.width - w * scale) / 2, top: rect.top + (rect.height - h * scale) / 2 };
}

function screenToMap(el: Element, view: ViewBox, clientX: number, clientY: number) {
  const { scale, left, top } = fitOf(el, view);
  return { x: view[0] + (clientX - left) / scale, y: view[1] + (clientY - top) / scale };
}

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
  /** Dónde estaba la cámara antes de abrir un restaurante, para volver ahí. */
  const beforeOpen = useRef<ViewBox>(FULL_VIEW);
  const svgRef = useRef<SVGSVGElement>(null);
  const phaseRef = useRef<Phase>("mapa");
  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

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

  /** Escala de rótulos y marcadores: 1 con todo el país a la vista. */
  const scale = viewBox[2] / FULL_VIEW[2];

  const clusters = useMemo(() => {
    const placed = rows.flatMap((row) =>
      row.restaurant.mapX === null || row.restaurant.mapY === null
        ? []
        : [{ ...row, x: row.restaurant.mapX, y: row.restaurant.mapY }],
    );
    return clusterRows(placed, CLUSTER_DISTANCE * scale);
  }, [rows, scale]);

  /** Mueve la cámara sin animar (rueda, arrastre, pellizco). */
  const setView = useCallback((next: ViewBox) => {
    if (frame.current !== null) {
      window.cancelAnimationFrame(frame.current);
      frame.current = null;
    }
    const clamped = clampView(next);
    viewRef.current = clamped;
    setViewBox(clamped);
  }, []);

  /** Anima el `viewBox` hasta `to` y luego llama a `done`. */
  const animateTo = useCallback((to: ViewBox, done: () => void = () => {}) => {
    if (frame.current !== null) window.cancelAnimationFrame(frame.current);
    const from = viewRef.current;
    const target = clampView(to);
    const duration = prefersReducedMotion() ? 0 : ZOOM_MS;
    const start = performance.now();
    const step = (time: number) => {
      const t = duration === 0 ? 1 : Math.min(1, (time - start) / duration);
      const k = easeInOut(t);
      const next = from.map((v, i) => v + (target[i] - v) * k) as ViewBox;
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

  /** Acerca (factor < 1) o aleja (> 1) dejando quieto el punto (px, py) del mapa. */
  const zoomAt = useCallback(
    (factor: number, px: number, py: number, from: ViewBox = viewRef.current) => {
      const [x, y, w, h] = from;
      const target = clampView([x, y, w * factor, h * factor]);
      const k = target[2] / w;
      setView([px - (px - x) * k, py - (py - y) * k, w * k, h * k]);
    },
    [setView],
  );

  /** Coordenadas de pantalla → unidades del mapa, con la cámara actual. */
  const toMap = useCallback((clientX: number, clientY: number) => {
    const svg = svgRef.current;
    return svg ? screenToMap(svg, viewRef.current, clientX, clientY) : { x: 0, y: 0 };
  }, []);

  // Rueda: con `passive: false` para que la página no se desplace a la vez.
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const onWheel = (e: WheelEvent) => {
      if (phaseRef.current !== "mapa") return;
      e.preventDefault();
      const p = toMap(e.clientX, e.clientY);
      zoomAt(Math.exp(e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)), p.x, p.y);
    };
    svg.addEventListener("wheel", onWheel, { passive: false });
    return () => svg.removeEventListener("wheel", onWheel);
  }, [toMap, zoomAt]);

  // Arrastre con un dedo o el ratón, pellizco con dos dedos.
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const gesture = useRef<
    | { kind: "pan"; startX: number; startY: number; view: ViewBox; unitsPerPx: number }
    | { kind: "pinch"; distance: number; mid: { x: number; y: number }; view: ViewBox }
    | null
  >(null);
  /** Si el gesto movió la cámara, el clic que viene después no abre nada. */
  const moved = useRef(false);

  const startGesture = useCallback(() => {
    const list = [...pointers.current.values()];
    const svg = svgRef.current;
    if (list.length === 1) {
      gesture.current = {
        kind: "pan",
        startX: list[0].x,
        startY: list[0].y,
        view: viewRef.current,
        unitsPerPx: svg ? 1 / fitOf(svg, viewRef.current).scale : 1,
      };
    } else if (list.length === 2) {
      const [a, b] = list;
      gesture.current = {
        kind: "pinch",
        distance: Math.hypot(a.x - b.x, a.y - b.y) || 1,
        mid: toMap((a.x + b.x) / 2, (a.y + b.y) / 2),
        view: viewRef.current,
      };
    } else {
      gesture.current = null;
    }
  }, [toMap]);

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (phase !== "mapa" || (e.pointerType === "mouse" && e.button !== 0)) return;
    if (pointers.current.size === 0) moved.current = false;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    startGesture();
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const g = gesture.current;
    if (!g) return;
    if (g.kind === "pan") {
      const dx = e.clientX - g.startX;
      const dy = e.clientY - g.startY;
      if (!moved.current && Math.hypot(dx, dy) < 5) return;
      if (!moved.current) {
        moved.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }
      const [x, y, w, h] = g.view;
      setView([x - dx * g.unitsPerPx, y - dy * g.unitsPerPx, w, h]);
    } else {
      const [a, b] = [...pointers.current.values()];
      moved.current = true;
      zoomAt(g.distance / (Math.hypot(a.x - b.x, a.y - b.y) || 1), g.mid.x, g.mid.y, g.view);
    }
  };

  const onPointerEnd = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.delete(e.pointerId)) return;
    // Al soltar un dedo del pellizco, el otro sigue arrastrando desde donde está.
    startGesture();
    // El clic de este mismo gesto llega antes que cualquier temporizador: así
    // se descarta ese clic, pero el Enter de después sobre un marcador vale.
    if (pointers.current.size === 0) window.setTimeout(() => (moved.current = false), 0);
  };

  /** Los clics de marcadores y grupos pasan por aquí: tras un arrastre no cuentan. */
  const unlessDragged = useCallback((action: () => void) => {
    if (!moved.current) action();
  }, []);

  const open = useCallback(
    (restaurant: MapRestaurant) => {
      setSelectedId(restaurant.id);
      // Sin posición en el mapa, o con otro plano ya abierto: sin zoom.
      if (restaurant.mapX === null || restaurant.mapY === null || phase === "plano") {
        setPhase("plano");
        return;
      }
      beforeOpen.current = viewRef.current;
      setPhase("entrando");
      animateTo(viewAround(restaurant.mapX, restaurant.mapY, ZOOM_KM), () => setPhase("plano"));
    },
    [animateTo, phase],
  );

  const close = useCallback(() => {
    setPhase("saliendo");
    window.setTimeout(
      () => {
        animateTo(beforeOpen.current, () => {
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

  const zoomButton = (factor: number) => {
    const [x, y, w, h] = viewRef.current;
    const target = clampView([x, y, w * factor, h * factor]);
    const cx = x + w / 2;
    const cy = y + h / 2;
    animateTo([cx - target[2] / 2, cy - target[3] / 2, target[2], target[3]]);
  };

  const selected = selectedId ? restaurants.find((r) => r.id === selectedId) ?? null : null;
  const selectedRow = selected ? rows.find((r) => r.restaurant.id === selected.id) : undefined;
  const planVisible = phase === "plano";
  const zoomedIn = viewBox[2] < FULL_VIEW[2] * 0.85;
  const sweepCenter = { x: MAP_WIDTH / 2, y: MAP_HEIGHT / 2 };

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

      {/* Mapa: todo el ancho disponible */}
      <div className="relative h-[68vh] min-h-[24rem] overflow-hidden rounded-2xl bg-map-bg ring-1 ring-app-border sm:min-h-[28rem] lg:h-[calc(100vh-13rem)]">
        <svg
          ref={svgRef}
          viewBox={viewBox.join(" ")}
          preserveAspectRatio="xMidYMid meet"
          className={`h-full w-full touch-none select-none ${phase === "mapa" ? "cursor-grab active:cursor-grabbing" : ""}`}
          role="group"
          aria-label="Mapa de Honduras con los restaurantes. Rueda o pellizco para acercar, arrastrar para moverse."
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerEnd}
          onPointerCancel={onPointerEnd}
        >
          <defs>
            <pattern id="map-grid" width="25" height="25" patternUnits="userSpaceOnUse">
              <path d="M 25 0 L 0 0 0 25" fill="none" className="stroke-map-grid" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            </pattern>
            <linearGradient id="map-sweep" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopOpacity="0" className="[stop-color:rgb(var(--c-line))]" />
              <stop offset="1" stopOpacity="0.1" className="[stop-color:rgb(var(--c-line))]" />
            </linearGradient>
          </defs>

          {/* Mar con cuadrícula */}
          <rect x={-MAP_WIDTH} y={-MAP_HEIGHT} width={MAP_WIDTH * 3} height={MAP_HEIGHT * 3} fill="url(#map-grid)" />

          {/* Anillos y cruz del radar */}
          <g className="stroke-map-line/15" fill="none" strokeWidth="1.5" strokeDasharray="4 8" vectorEffect="non-scaling-stroke">
            {[150, 300, 450, 600].map((r) => (
              <circle key={r} cx={sweepCenter.x} cy={sweepCenter.y} r={r} vectorEffect="non-scaling-stroke" />
            ))}
            <line x1={sweepCenter.x} y1={-400} x2={sweepCenter.x} y2={MAP_HEIGHT + 400} vectorEffect="non-scaling-stroke" />
            <line x1={-400} y1={sweepCenter.y} x2={MAP_WIDTH + 400} y2={sweepCenter.y} vectorEffect="non-scaling-stroke" />
          </g>
          <path
            d={`M ${sweepCenter.x} ${sweepCenter.y} L ${sweepCenter.x + 700} ${sweepCenter.y} A 700 700 0 0 0 ${sweepCenter.x + 606} ${sweepCenter.y - 350} Z`}
            fill="url(#map-sweep)"
            className="map-sweep"
            style={{ transformOrigin: `${sweepCenter.x}px ${sweepCenter.y}px` }}
          />

          {/* Países vecinos */}
          {NEIGHBORS.map((n) => (
            <g key={n.id}>
              <path d={n.path} className="fill-map-line/[0.04] stroke-map-line/30" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
              <text
                x={n.label[0]}
                y={n.label[1]}
                textAnchor="middle"
                className="fill-map-line/45"
                fontSize={15 * scale}
                fontWeight={700}
                letterSpacing={3 * scale}
              >
                {n.name.toUpperCase()}
              </text>
            </g>
          ))}

          {/* Honduras: tierra, departamentos y frontera */}
          <path d={HONDURAS_PATH} className="fill-map-line/[0.09]" />
          {DEPARTMENTS.map((d) => (
            <path key={d.id} d={d.path} fill="none" className="stroke-map-line/40" strokeWidth={1} vectorEffect="non-scaling-stroke" strokeLinejoin="round">
              <title>{d.name}</title>
            </path>
          ))}
          <path d={HONDURAS_PATH} fill="none" className="stroke-map-line/90" strokeWidth={2} vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          {DEPARTMENTS.map((d) => (
            <text
              key={`${d.id}-rotulo`}
              x={d.label[0]}
              y={d.label[1]}
              textAnchor="middle"
              className="pointer-events-none fill-map-line/60"
              fontSize={10 * scale}
              fontWeight={600}
              letterSpacing={1.2 * scale}
            >
              {d.name.toUpperCase()}
            </text>
          ))}

          {WATERS.map((w) => (
            <text key={w.name} x={w.x} y={w.y} textAnchor="middle" className="pointer-events-none fill-map-line/40 italic" fontSize={13 * scale} letterSpacing={2 * scale}>
              {w.name}
            </text>
          ))}

          {/* Ciudades principales */}
          {CITIES.map((c) => {
            const r = (c.rank === 1 ? 5 : c.rank === 2 ? 4 : 3) * scale;
            const size = (c.rank === 1 ? 16 : c.rank === 2 ? 13.5 : 11.5) * scale;
            const gap = r + 4 * scale;
            const at =
              c.labelSide === "right"
                ? { x: c.x + gap, y: c.y + size / 3, anchor: "start" as const }
                : c.labelSide === "left"
                  ? { x: c.x - gap, y: c.y + size / 3, anchor: "end" as const }
                  : c.labelSide === "above"
                    ? { x: c.x, y: c.y - gap, anchor: "middle" as const }
                    : { x: c.x, y: c.y + gap + size * 0.8, anchor: "middle" as const };
            return (
              <g key={c.name} className="pointer-events-none">
                {c.rank === 1 ? <circle cx={c.x} cy={c.y} r={r * 1.9} fill="none" className="stroke-map-line" strokeWidth={1.5} vectorEffect="non-scaling-stroke" /> : null}
                <circle cx={c.x} cy={c.y} r={r} className="fill-map-line stroke-map-bg" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
                <text
                  x={at.x}
                  y={at.y}
                  textAnchor={at.anchor}
                  className="fill-map-line stroke-map-bg"
                  strokeWidth={4 * scale}
                  paintOrder="stroke"
                  fontSize={size}
                  fontWeight={c.rank === 3 ? 600 : 800}
                  letterSpacing={0.5 * scale}
                >
                  {c.name}
                </text>
              </g>
            );
          })}

          {/* Marcadores: sueltos o agrupados si se pisan */}
          {clusters.map((c) =>
            c.members.length === 1 ? (
              <Marker
                key={c.members[0].restaurant.id}
                row={c.members[0]}
                scale={scale}
                onOpen={() => unlessDragged(() => open(c.members[0].restaurant))}
                disabled={phase !== "mapa"}
              />
            ) : (
              <ClusterMarker
                key={c.members.map((m) => m.restaurant.id).join("+")}
                cluster={c}
                scale={scale}
                disabled={phase !== "mapa"}
                onOpen={() => unlessDragged(() => animateTo(viewAroundPoints(c.members, 3)))}
              />
            ),
          )}
        </svg>

        {/* Controles de la cámara */}
        <div className="absolute right-3 top-3 flex flex-col items-end gap-2">
          <div className="flex flex-wrap justify-end gap-1.5">
            <MapButton icon={Scan} label="Ver todo Honduras" short="Honduras" onClick={() => animateTo(FULL_VIEW)} disabled={phase !== "mapa"} />
            {ZOOM_CITIES.map((name) => (
              <MapButton
                key={name}
                icon={LocateFixed}
                label={name}
                short={CITY_SHORT[name]}
                onClick={() => animateTo(cityView(name))}
                disabled={phase !== "mapa"}
              />
            ))}
          </div>
          <div className="flex flex-col overflow-hidden rounded-xl bg-panel/90 shadow-lg ring-1 ring-app-border backdrop-blur-md">
            <button
              type="button"
              aria-label="Acercar"
              onClick={() => zoomButton(1 / BUTTON_ZOOM)}
              disabled={phase !== "mapa"}
              className="flex h-11 w-11 items-center justify-center text-panel-text hover:bg-app-border/40 disabled:opacity-40"
            >
              <Plus aria-hidden size={20} />
            </button>
            <span aria-hidden className="h-px bg-app-border" />
            <button
              type="button"
              aria-label="Alejar"
              onClick={() => zoomButton(BUTTON_ZOOM)}
              disabled={phase !== "mapa"}
              className="flex h-11 w-11 items-center justify-center text-panel-text hover:bg-app-border/40 disabled:opacity-40"
            >
              <Minus aria-hidden size={20} />
            </button>
          </div>
        </div>

        {zoomedIn && phase === "mapa" ? (
          <Minimap view={viewBox} onJump={(x, y) => {
            const [, , w, h] = viewRef.current;
            animateTo([x - w / 2, y - h / 2, w, h]);
          }} />
        ) : null}

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

      {/* Lista, por espera, debajo del mapa */}
      <section aria-label="Restaurantes por espera" className="flex flex-col gap-2">
        <h2 className="px-1 text-sm font-semibold text-app-muted">
          {rows.length} {rows.length === 1 ? "restaurante" : "restaurantes"}, por espera
        </h2>
        <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
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
      </section>
    </div>
  );
}

/** Rótulo corto de los botones de ciudad en pantallas pequeñas. */
const CITY_SHORT: Record<(typeof ZOOM_CITIES)[number], string> = { Tegucigalpa: "TGU", "San Pedro Sula": "SPS" };

function MapButton({
  icon: Icon,
  label,
  short,
  onClick,
  disabled,
}: {
  icon: LucideIcon;
  label: string;
  /** En celular, para que los botones no tapen el mapa. */
  short: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-10 items-center gap-1.5 rounded-full bg-panel/90 px-3 text-xs font-semibold text-panel-text shadow-lg ring-1 ring-app-border backdrop-blur-md hover:ring-accent/60 disabled:opacity-40 sm:text-sm"
    >
      <Icon aria-hidden size={16} />
      <span className="sm:hidden">{short}</span>
      <span className="hidden sm:inline">{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Minimapa: dónde está la cámara dentro del país
// ---------------------------------------------------------------------------

function Minimap({ view, onJump }: { view: ViewBox; onJump: (x: number, y: number) => void }) {
  const [x, y, w, h] = view;
  return (
    <svg
      viewBox={FULL_VIEW.join(" ")}
      className="absolute bottom-3 right-3 hidden w-44 cursor-pointer rounded-xl bg-map-bg/90 shadow-lg ring-1 ring-app-border backdrop-blur-md sm:block"
      role="img"
      aria-label="Minimapa: toca para mover la vista"
      onClick={(e) => {
        const p = screenToMap(e.currentTarget, FULL_VIEW, e.clientX, e.clientY);
        onJump(p.x, p.y);
      }}
    >
      <path d={HONDURAS_PATH} className="fill-map-line/20 stroke-map-line/70" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        className="fill-accent/20 stroke-accent"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Marcador
// ---------------------------------------------------------------------------

const RING_R = 30;
const RING_C = 2 * Math.PI * RING_R;

function Marker({ row, scale, onOpen, disabled }: { row: Placed; scale: number; onOpen: () => void; disabled: boolean }) {
  const { restaurant, counters, minutes, level, color } = row;
  const waiting = counters?.waiting ?? 0;
  const pct = occupancy(counters);
  const Icon = level === "normal" ? null : ALERT_ICON[level];
  const label = `${restaurant.name}: ${waiting} en espera, espera media ${minutes} min, ${Math.round(pct * 100)} % de mesas ocupadas. ${LEVEL_LABEL[level]}.`;

  return (
    <g
      // A escala 1 con todo el país a la vista: al acercar, se encoge en
      // unidades del mapa para verse igual de grande en pantalla.
      transform={`translate(${row.x} ${row.y}) scale(${scale * 0.75})`}
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
// Grupo: varios restaurantes que se pisarían en pantalla
// ---------------------------------------------------------------------------

function ClusterMarker({ cluster, scale, onOpen, disabled }: { cluster: Cluster; scale: number; onOpen: () => void; disabled: boolean }) {
  const { members } = cluster;
  const waiting = members.reduce((total, m) => total + (m.counters?.waiting ?? 0), 0);
  const tables = members.reduce((total, m) => total + (m.counters?.tablesTotal ?? 0), 0);
  const occupied = members.reduce((total, m) => total + (m.counters?.tablesOccupied ?? 0), 0);
  const pct = tables ? occupied / tables : 0;
  const worst = members.reduce((a, b) => (LEVEL_ORDER[b.level] > LEVEL_ORDER[a.level] ? b : a));
  const level = worst.level;
  const maxMinutes = Math.max(...members.map((m) => m.minutes));
  const cities = [...new Set(members.map((m) => m.restaurant.city).filter(Boolean))];
  const title = cities.length === 1 ? cities[0] : `${members.length} restaurantes`;
  const Icon = level === "normal" ? null : ALERT_ICON[level];
  const R = 36;
  const C = 2 * Math.PI * R;
  const label = `${title}: ${members.length} restaurantes, ${waiting} en espera, espera máxima ${maxMinutes} min, ${Math.round(pct * 100)} % de mesas ocupadas. ${LEVEL_LABEL[level]}. Toca para acercar.`;

  return (
    <g
      transform={`translate(${cluster.x} ${cluster.y}) scale(${scale * 0.75})`}
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
      <circle r={60} fill="transparent" />
      <circle r={R + 10} fill="none" className="stroke-accent opacity-0 group-focus-visible:opacity-100" strokeWidth={3} />
      {level === "alerta" ? <circle r={R + 9} fill="none" className="map-pulse stroke-alerta" strokeWidth={4} /> : null}
      {level === "critica" ? (
        <>
          <circle r={R + 8} fill="none" className="stroke-critica" strokeWidth={3} />
          <circle r={R + 12} fill="none" className="map-pulse map-pulse-fast stroke-critica" strokeWidth={8} />
        </>
      ) : null}
      <circle r={R} fill="none" className="stroke-map-line/20" strokeWidth={6} />
      <circle r={R} fill="none" className="stroke-map-line" strokeWidth={6} strokeLinecap="round" strokeDasharray={`${pct * C} ${C}`} transform="rotate(-90)" />
      {/* Un gajo por restaurante, con el color de su marca */}
      {members.map((m, i) => {
        const a0 = (i / members.length) * 2 * Math.PI - Math.PI / 2;
        const a1 = ((i + 1) / members.length) * 2 * Math.PI - Math.PI / 2;
        const r = 28;
        const large = a1 - a0 > Math.PI ? 1 : 0;
        return (
          <path
            key={m.restaurant.id}
            d={`M 0 0 L ${r * Math.cos(a0)} ${r * Math.sin(a0)} A ${r} ${r} 0 ${large} 1 ${r * Math.cos(a1)} ${r * Math.sin(a1)} Z`}
            fill={m.color}
            className="stroke-map-bg"
            strokeWidth={2}
          />
        );
      })}
      <circle r={17} className="fill-map-bg" />
      <text y={8} textAnchor="middle" fontSize={22} fontWeight={800} className="fill-app-text">
        {waiting}
      </text>
      {Icon ? (
        <g transform={`translate(${R - 2} ${-R + 2})`}>
          <circle r={13} className={level === "critica" ? "fill-critica" : "fill-alerta"} />
          <Icon x={-8.5} y={-8.5} width={17} height={17} strokeWidth={2.5} className="text-map-bg" aria-hidden />
        </g>
      ) : null}
      <text y={R + 30} textAnchor="middle" fontSize={21} fontWeight={800} className="fill-app-text stroke-map-bg" strokeWidth={5} paintOrder="stroke">
        {title} · {members.length}
      </text>
      <text
        y={R + 52}
        textAnchor="middle"
        fontSize={18}
        fontWeight={600}
        className={`${level === "critica" ? "fill-critica" : level === "alerta" ? "fill-alerta" : "fill-app-muted"} stroke-map-bg`}
        strokeWidth={5}
        paintOrder="stroke"
      >
        hasta {maxMinutes} min · {Math.round(pct * 100)} %
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
