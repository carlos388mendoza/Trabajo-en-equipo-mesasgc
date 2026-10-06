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
//
// Zonas de meseros: cada mesa sale teñida del color de su mesero en la
// configuración activa, con su nombre encima. Con `meseros:gestionar` se
// cambia la activa con un toque y se editan las zonas aquí mismo (pintando
// mesas sobre este plano, que no deja mover nada).
//
// Modo inmersivo (solo con `immersive`, es decir, en /restaurante/[id]/mapa):
// con la tablet en horizontal el plano ocupa la pantalla entera, sin la
// cabecera de la app ni el menú. Lo decide CSS (`inmersivo:`, ver
// `lib/layout/immersive.ts`), así que en celular y en computadora no cambia
// nada y al girar la tablet a vertical vuelve solo a la vista normal. La
// misma barra de siempre pasa a flotar encima del plano, en pequeño y
// semitransparente (no se pinta otra: así no hay dos «Agregar mesero»). La
// lista de espera se abre en un panel lateral con el modo sencillo dentro
// (un iframe del propio sitio): el mismo tiempo real, la misma cola sin
// conexión, los mismos permisos y la misma forma de sentar y liberar.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { EyeOff, ListOrdered, Maximize2, Minimize2, X } from "lucide-react";

import {
  WaiterActions,
  WaiterEditorPanel,
  WaiterLegend,
  WaiterMessage,
  WaiterSelector,
  useWaiterZones,
} from "@/components/waiters/waiter-zones";
import { isSeatableElement } from "@/lib/db/enums";

import { loadLivePlan } from "@/app/mapa/actions";
import type { CanvasHandle } from "@/components/editor/konva-canvas";
import { KonvaCanvas } from "@/components/editor/lazy-konva-canvas";
import { TABLET_LANDSCAPE_QUERY } from "@/lib/layout/immersive";
import type { LivePlan as LivePlanData } from "@/lib/map/queries";

const NOOP = () => {};

/** Lo que tapan los controles flotantes de arriba al encuadrar las mesas. */
const FLOATING_BAR_HEIGHT = 64;

function subscribeTabletLandscape(onChange: () => void) {
  const media = window.matchMedia(TABLET_LANDSCAPE_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** ¿Tablet en horizontal? La misma media query que el CSS. En el servidor, no. */
function useTabletLandscape(): boolean {
  return useSyncExternalStore(
    subscribeTabletLandscape,
    () => window.matchMedia(TABLET_LANDSCAPE_QUERY).matches,
    () => false,
  );
}

export type LivePlanProps = {
  restaurantId: string;
  /** El plano que ya trae la página, para no pintar un "Cargando" al abrir. */
  initialPlan?: LivePlanData | null;
  /** Cada vez que cambia, se vuelve a pedir el plano. */
  refreshSignal: unknown;
  /** Botones y datos que van a la izquierda de la barra (volver, contadores). */
  toolbar?: ReactNode;
  /** `meseros:gestionar`: puede activar y editar las zonas de meseros. */
  canManageWaiters?: boolean;
  /** Abrir directamente la edición de la configuración activa (?meseros=editar). */
  startEditingWaiters?: boolean;
  /**
   * Activa el modo inmersivo de la tablet en horizontal. Solo lo pasa la
   * página del plano de un restaurante; el zoom de /mapa no lo usa.
   */
  immersive?: {
    /** El nombre del restaurante, en pequeño arriba a la izquierda. */
    restaurantName: string;
    /**
     * La página del modo sencillo, para el panel de la lista de espera. Sin
     * ella (quien no tiene `rapido:ver`, como analítica) no hay botón.
     */
    waitlistHref?: string;
  };
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

const NO_CONFIGS: never[] = [];

export function LivePlan({
  restaurantId,
  initialPlan = null,
  refreshSignal,
  toolbar,
  canManageWaiters = false,
  startEditingWaiters = false,
  immersive,
}: LivePlanProps) {
  // Modo inmersivo. `immersiveMode` es lo que pide el usuario: "auto" (a
  // pantalla completa cuando la tablet está en horizontal, lo normal) o
  // "normal" (tocó «Vista normal»). Quien lo aplica es el CSS; aquí solo
  // hace falta saberlo para encuadrar y dejar sitio a los controles.
  const tabletLandscape = useTabletLandscape();
  const [immersiveMode, setImmersiveMode] = useState<"auto" | "normal">("auto");
  // Al girar la tablet a vertical se olvida «Vista normal»: la próxima vez
  // que se ponga en horizontal vuelve a pantalla completa.
  const [wasLandscape, setWasLandscape] = useState(tabletLandscape);
  if (wasLandscape !== tabletLandscape) {
    setWasLandscape(tabletLandscape);
    if (!tabletLandscape) setImmersiveMode("auto");
  }
  const immersiveOn = Boolean(immersive) && immersiveMode === "auto";
  const immersiveActive = immersiveOn && tabletLandscape;
  // El panel de la lista de espera. El iframe se crea la primera vez que se
  // abre y luego se queda (cerrado, fuera de la pantalla): así no se recarga
  // cada vez y su cola sin conexión sigue trabajando.
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [waitlistMounted, setWaitlistMounted] = useState(false);
  const openWaitlist = () => {
    setWaitlistMounted(true);
    setWaitlistOpen(true);
  };

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
  const zones = useMemo(() => plan?.zones ?? [], [plan?.zones]);
  // Al entrar se ve el plano POR DEFECTO del restaurante; si no tiene, la
  // primera zona con algo dentro.
  const zone =
    zones.find((z) => z.id === zoneId) ??
    zones.find((z) => z.id === plan?.defaultZoneId) ??
    zones.find((z) => z.elements.length > 0) ??
    zones[0];

  // Las mesas que se reparten entre meseros: solo las sentables, de todas
  // las zonas, con la zona por defecto primero.
  const { seatableTables, layoutOrder } = useMemo(() => {
    const list = [];
    for (const z of zones) {
      for (const e of z.elements) {
        const type = typesById.get(e.elementTypeId);
        if (type && isSeatableElement(type.key)) list.push({ id: e.id, layoutId: z.id, x: e.x, y: e.y });
      }
    }
    const order = zones.map((z) => z.id).sort((a, b) => Number(b === plan?.defaultZoneId) - Number(a === plan?.defaultZoneId));
    return { seatableTables: list, layoutOrder: order };
  }, [zones, typesById, plan?.defaultZoneId]);

  const waiters = useWaiterZones({
    restaurantId,
    configs: plan?.waiterConfigs ?? NO_CONFIGS,
    canManage: canManageWaiters,
    tables: seatableTables,
    layoutOrder,
  });
  const [autoEdit, setAutoEdit] = useState(startEditingWaiters);
  if (autoEdit && waiters.active && !waiters.editing && canManageWaiters) {
    setAutoEdit(false);
    waiters.edit(waiters.active.id);
  }

  // Los controles de la barra, en modo inmersivo: flotan encima del plano,
  // pequeños y semitransparentes. Las clases van en la barra (`[&>*]`), no en
  // cada control, para que valgan también para los que pinta otro componente.
  const floatingBar =
    "inmersivo:pointer-events-none inmersivo:absolute inmersivo:inset-x-0 inmersivo:top-0 inmersivo:z-20 inmersivo:flex-nowrap inmersivo:gap-1.5 inmersivo:p-2 " +
    "inmersivo:[&>*]:pointer-events-auto inmersivo:[&>*]:shrink-0 inmersivo:[&>*]:whitespace-nowrap inmersivo:[&>*]:bg-panel/80 inmersivo:[&>*]:shadow-md";
  const roundButton =
    "flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-medium text-panel-text ring-1 ring-app-border hover:bg-app-border/60";

  return (
    <div
      data-inmersivo={immersiveOn ? "" : undefined}
      className={
        "flex h-full min-h-0 flex-col gap-2 " +
        // A pantalla completa: fijo sobre todo, del alto que se ve de verdad
        // (`dvh`: cambia cuando Opera enseña o esconde su barra) y fuera de las
        // zonas que tapan la cámara o los bordes redondeados (`safe-area`).
        "inmersivo-raiz:fixed inmersivo-raiz:inset-0 inmersivo-raiz:z-30 inmersivo-raiz:h-[100dvh] inmersivo-raiz:w-full inmersivo-raiz:gap-0 inmersivo-raiz:overflow-hidden inmersivo-raiz:bg-map-bg " +
        "inmersivo-raiz:pb-[env(safe-area-inset-bottom)] inmersivo-raiz:pl-[env(safe-area-inset-left)] inmersivo-raiz:pr-[env(safe-area-inset-right)] inmersivo-raiz:pt-[env(safe-area-inset-top)]"
      }
    >
      <div className={`flex flex-wrap items-center gap-2 ${floatingBar}`}>
        {immersive ? (
          <span className="hidden max-w-[14rem] truncate rounded-full px-3 py-1.5 text-xs font-semibold text-panel-text ring-1 ring-app-border inmersivo:block inmersivo:!shrink">
            {immersive.restaurantName}
          </span>
        ) : null}
        {toolbar}
        {zones.length > 1 ? (
          <div role="tablist" aria-label="Zonas" className="flex flex-wrap gap-1 rounded-xl bg-panel p-1 ring-1 ring-app-border inmersivo:flex-nowrap">
            {zones.map((z) => (
              <button
                key={z.id}
                type="button"
                role="tab"
                aria-selected={z.id === zone?.id}
                onClick={() => setZoneId(z.id)}
                className={`h-10 rounded-lg px-3 text-sm font-medium inmersivo:px-2.5 inmersivo:text-xs ${
                  z.id === zone?.id ? "bg-accent text-accent-text" : "text-panel-muted hover:bg-app-border/60"
                }`}
              >
                {z.name}
              </button>
            ))}
          </div>
        ) : null}
        {/* A la derecha en modo inmersivo; en la vista normal, donde siempre
            (`contents`: el envoltorio no existe para el diseño). */}
        <div className="contents inmersivo:!ml-auto inmersivo:!flex inmersivo:items-center inmersivo:gap-1.5 inmersivo:!bg-transparent inmersivo:!shadow-none inmersivo:[&>*]:bg-panel/80 inmersivo:[&>*]:shadow-md">
          <WaiterSelector state={waiters} />
          {immersive?.waitlistHref ? (
            <button
              type="button"
              onClick={() => (waitlistOpen ? setWaitlistOpen(false) : openWaitlist())}
              aria-expanded={waitlistOpen}
              aria-label="Lista de espera"
              title="Lista de espera: agregar, avisar, sentar y liberar"
              aria-controls="panel-lista-espera"
              className={`${roundButton} hidden inmersivo:flex`}
            >
              <ListOrdered aria-hidden size={18} strokeWidth={2} />
              Lista
            </button>
          ) : null}
          {immersive ? (
            <button
              type="button"
              onClick={() => setImmersiveMode("normal")}
              aria-label="Volver a la vista normal"
              title="Volver a la vista normal"
              className={`${roundButton} hidden px-0 inmersivo:flex`}
            >
              <Minimize2 aria-hidden size={18} strokeWidth={2} />
            </button>
          ) : null}
        </div>
        {/* En la tablet en horizontal, desde la vista normal: volver a grande. */}
        {immersive && !immersiveOn ? (
          <button
            type="button"
            onClick={() => setImmersiveMode("auto")}
            className={`${roundButton} hidden bg-panel tableta-horizontal:flex`}
          >
            <Maximize2 aria-hidden size={18} strokeWidth={2} />
            Plano en grande
          </button>
        ) : null}
        <span className="contents inmersivo:hidden">
          <WaiterActions state={waiters} />
        </span>
        {plan && !plan.showNames ? (
          <span className="flex items-center gap-1.5 rounded-full bg-panel px-3 py-1.5 text-xs font-medium text-panel-muted ring-1 ring-app-border inmersivo:hidden">
            <EyeOff aria-hidden size={14} strokeWidth={2} />
            Solo estados y ocupación: sin nombres de clientes
          </span>
        ) : null}
      </div>

      <div className="inmersivo:hidden">
        <WaiterLegend state={waiters} tableCount={seatableTables.length} />
      </div>
      {/* Avisos: en modo inmersivo, abajo en el centro, encima del plano. */}
      <div className="contents inmersivo:pointer-events-none inmersivo:absolute inmersivo:inset-x-0 inmersivo:bottom-3 inmersivo:z-20 inmersivo:flex inmersivo:flex-col inmersivo:items-center inmersivo:gap-2 inmersivo:px-3 inmersivo:[&>*]:pointer-events-auto">
        <WaiterMessage state={waiters} />
        {error ? (
          <p role="alert" className="rounded-xl bg-panel px-3 py-2 text-sm text-critica ring-1 ring-app-border">
            {error}
          </p>
        ) : null}
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col gap-2 sm:block">
        {waiters.editing ? (
          <div className="max-h-[40vh] shrink-0 sm:absolute sm:bottom-3 sm:left-3 sm:top-3 sm:z-10 sm:max-h-none inmersivo:top-16 inmersivo:z-20">
            <WaiterEditorPanel state={waiters} />
          </div>
        ) : null}
      <div className="relative min-h-[24rem] flex-1 overflow-hidden rounded-2xl ring-1 ring-app-border sm:h-full sm:min-h-0 inmersivo:h-full inmersivo:min-h-0 inmersivo:rounded-none inmersivo:ring-0">
        {zone ? (
          <KonvaCanvas
            key={zone.id}
            readOnly
            layoutId={zone.id}
            width={zone.width}
            height={zone.height}
            // El giro guardado de la zona: se ve como en el editor.
            viewRotation={zone.rotation}
            // A pantalla completa los controles flotan encima: se encuadra por
            // debajo de ellos, y se vuelve a encuadrar cada vez que cambia el
            // tamaño (pantalla completa de Opera, su barra, girar la tablet).
            topInset={immersiveActive ? FLOATING_BAR_HEIGHT : 0}
            refitOnResize={immersiveActive}
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
            waiterMarks={waiters.marks}
            onElementTap={waiters.editing ? waiters.tap : undefined}
            onMarquee={waiters.editing && waiters.group ? waiters.marquee : undefined}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-app-bg p-6 text-center text-sm text-app-muted">
            {plan ? "Este restaurante todavía no tiene plano." : "Cargando plano…"}
          </div>
        )}
      </div>
      </div>

      {/* La lista de espera: el modo sencillo en un panel a la derecha. Solo
          en modo inmersivo; en la vista normal se usa su pestaña de siempre. */}
      {immersive?.waitlistHref && waitlistMounted ? (
        <aside
          id="panel-lista-espera"
          aria-label="Lista de espera"
          inert={!waitlistOpen}
          className={`absolute bottom-0 right-0 top-0 z-30 hidden w-[min(26rem,46vw)] flex-col border-l border-app-border bg-panel shadow-2xl transition-transform duration-200 inmersivo:flex ${
            waitlistOpen ? "translate-x-0" : "translate-x-full"
          }`}
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-app-border px-3 py-1.5">
            <h2 className="flex-1 text-sm font-semibold text-panel-text">Lista de espera</h2>
            <button
              type="button"
              onClick={() => setWaitlistOpen(false)}
              aria-label="Cerrar la lista de espera"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-panel-text hover:bg-app-border/60"
            >
              <X aria-hidden size={20} strokeWidth={2} />
            </button>
          </div>
          <iframe src={immersive.waitlistHref} title="Lista de espera (modo sencillo)" className="min-h-0 w-full flex-1 border-0 bg-app-bg" />
        </aside>
      ) : null}
    </div>
  );
}
