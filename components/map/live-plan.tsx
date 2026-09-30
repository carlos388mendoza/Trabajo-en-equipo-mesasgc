"use client";

// Plano en vivo de un restaurante: el mismo lienzo radar del editor, en solo
// lectura (se mira, se panea y se hace zoom; nada se mueve).
//
// No aplica los avisos del socket uno a uno: cuando `refreshSignal` cambia
// (llegó un aviso, o pasó el respaldo de 30 s), vuelve a pedir el plano a la
// server action, que decide en el servidor si van los nombres. Así el plano
// de analitica nunca recibe datos de clientes, ni siquiera por un evento.
//
// Las mesas que cambiaron entre dos lecturas hacen la misma onda que en el
// editor.

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { EyeOff } from "lucide-react";

import { loadLivePlan } from "@/app/mapa/actions";
import type { CanvasHandle } from "@/components/editor/konva-canvas";
import { KonvaCanvas } from "@/components/editor/lazy-konva-canvas";
import type { LivePlan as LivePlanData } from "@/lib/map/queries";

const NOOP = () => {};

type Props = {
  restaurantId: string;
  /** El plano que ya trae la página, para no pintar un "Cargando" al abrir. */
  initialPlan?: LivePlanData | null;
  /** Cada vez que cambia, se vuelve a pedir el plano. */
  refreshSignal: unknown;
  /** Botones y datos que van a la izquierda de la barra (volver, contadores). */
  toolbar?: ReactNode;
};

/** Qué mesas cambiaron entre dos lecturas del plano. */
function changedTables(before: LivePlanData | null, after: LivePlanData): string[] {
  if (!before) return [];
  const old = new Map<string, string>();
  for (const zone of before.zones) {
    for (const e of zone.elements) old.set(e.id, `${e.status}|${e.currentEntryId ?? ""}`);
  }
  const out: string[] = [];
  for (const zone of after.zones) {
    for (const e of zone.elements) {
      const prev = old.get(e.id);
      if (prev !== undefined && prev !== `${e.status}|${e.currentEntryId ?? ""}`) out.push(e.id);
    }
  }
  return out;
}

export function LivePlan({ restaurantId, initialPlan = null, refreshSignal, toolbar }: Props) {
  const [plan, setPlan] = useState<LivePlanData | null>(initialPlan);
  const [error, setError] = useState<string | null>(null);
  const [zoneId, setZoneId] = useState<string | null>(null);
  const [pulses, setPulses] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());
  const controllerRef = useRef<CanvasHandle | null>(null);
  const planRef = useRef(plan);
  const firstSignal = useRef(true);

  useEffect(() => {
    planRef.current = plan;
  });

  // Carga: al montar (si la página no trajo el plano) y en cada señal.
  useEffect(() => {
    if (firstSignal.current) {
      firstSignal.current = false;
      if (planRef.current) return;
    }
    let cancelled = false;
    loadLivePlan({ restaurantId })
      .then((res) => {
        if (cancelled) return;
        if (!res.ok) {
          setError(res.error);
          return;
        }
        setError(null);
        const changed = changedTables(planRef.current, res.plan);
        if (changed.length > 0) {
          setPulses((prev) => {
            const next = { ...prev };
            for (const id of changed) next[id] = (next[id] ?? 0) + 1;
            return next;
          });
        }
        setPlan(res.plan);
      })
      .catch(() => {
        if (!cancelled) setError("No se pudo cargar el plano. Se reintentará solo.");
      });
    return () => {
      cancelled = true;
    };
  }, [restaurantId, refreshSignal]);

  // El contador de minutos de las mesas ocupadas.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const typesById = useMemo(() => new Map((plan?.types ?? []).map((t) => [t.id, t])), [plan?.types]);
  const zones = plan?.zones ?? [];
  const zone = zones.find((z) => z.id === zoneId) ?? zones.find((z) => z.elements.length > 0) ?? zones[0];

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        {toolbar}
        {zones.length > 1 ? (
          <div role="tablist" aria-label="Zonas" className="flex flex-wrap gap-1 rounded-xl bg-panel p-1 ring-1 ring-app-border">
            {zones.map((z) => (
              <button
                key={z.id}
                type="button"
                role="tab"
                aria-selected={z.id === zone?.id}
                onClick={() => setZoneId(z.id)}
                className={`h-10 rounded-lg px-3 text-sm font-medium ${
                  z.id === zone?.id ? "bg-accent text-accent-text" : "text-panel-muted hover:bg-app-border/60"
                }`}
              >
                {z.name}
              </button>
            ))}
          </div>
        ) : null}
        {plan && !plan.showNames ? (
          <span className="flex items-center gap-1.5 rounded-full bg-panel px-3 py-1.5 text-xs font-medium text-panel-muted ring-1 ring-app-border">
            <EyeOff aria-hidden size={14} strokeWidth={2} />
            Solo estados y ocupación: sin nombres de clientes
          </span>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="rounded-xl bg-panel px-3 py-2 text-sm text-critica ring-1 ring-app-border">
          {error}
        </p>
      ) : null}

      <div className="relative min-h-0 flex-1 overflow-hidden rounded-2xl ring-1 ring-app-border">
        {zone ? (
          <KonvaCanvas
            key={zone.id}
            readOnly
            layoutId={zone.id}
            width={zone.width}
            height={zone.height}
            // El giro guardado de la zona: se ve como en el editor.
            viewRotation={zone.rotation}
            elements={zone.elements}
            pulses={pulses}
            now={now}
            typesById={typesById}
            selectedId={null}
            onSelect={NOOP}
            onEditStart={NOOP}
            onMove={NOOP}
            onResize={NOOP}
            onChange={NOOP}
            onZoomChange={NOOP}
            controllerRef={controllerRef}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-app-bg p-6 text-center text-sm text-app-muted">
            {plan ? "Este restaurante todavía no tiene plano." : "Cargando plano…"}
          </div>
        )}
      </div>
    </div>
  );
}
