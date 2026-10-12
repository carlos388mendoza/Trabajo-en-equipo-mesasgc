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
//
// Menos ruido (octubre de 2026): las mesas llevan dentro solo lo esencial
// (ver `components/editor/live-marks.ts`); al tocar una se abre su ficha con
// todo el detalle y las acciones (`table-sheet.tsx`). La barra queda en una
// línea compacta (lista de espera, zonas, meseros y «Más»), la leyenda es
// pequeña y plegable, y no hay minimapa.

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { ReactNode } from "react";
import { DoorOpen, EyeOff, Info, ListOrdered, Maximize2, Minimize2, MoreHorizontal, X } from "lucide-react";

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
import { TableSheet, type TableSheetActions } from "@/components/map/table-sheet";
import type { CanvasHandle } from "@/components/editor/konva-canvas";
import { KonvaCanvas } from "@/components/editor/lazy-konva-canvas";
import { TABLET_LANDSCAPE_QUERY } from "@/lib/layout/immersive";
import type { Ack, BatchSummary } from "@/lib/realtime/events";
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
  /**
   * Lo que se puede hacer desde la ficha de una mesa y desde «Más». Cada
   * acción llega solo con su permiso (sentar y liberar, `mesas:asignar`;
   * eliminar, `rapido:modificar`); sin ninguna, el plano es para mirar.
   */
  tableActions?: TableSheetActions & {
    releaseAll?: () => Promise<Ack<BatchSummary>>;
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
  tableActions,
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
  // El panel de la lista de espera, en TODAS las vistas (computadora, tablet y
  // celular, de pie o acostados). El iframe se crea la primera vez que se
  // abre y luego se queda (cerrado, fuera de la pantalla): así no se recarga
  // cada vez y su cola sin conexión sigue trabajando.
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [waitlistMounted, setWaitlistMounted] = useState(false);
  const closeWaitlistRef = useRef<HTMLButtonElement | null>(null);
  const openWaitlist = () => {
    setWaitlistMounted(true);
    setWaitlistOpen(true);
  };
  // Esc lo cierra: en esta página y también con el foco dentro del panel (el
  // iframe es del propio sitio), salvo que dentro haya abierta una ventana del
  // modo sencillo, que se cierra primero con su propio Esc.
  useEffect(() => {
    if (!waitlistOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setWaitlistOpen(false);
    };
    window.addEventListener("keydown", onKey);
    closeWaitlistRef.current?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [waitlistOpen]);
  const listenInsideWaitlist = (frame: HTMLIFrameElement) => {
    const doc = frame.contentDocument;
    if (!doc) return;
    doc.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && !doc.querySelector("[role=dialog]")) setWaitlistOpen(false);
    });
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
    "inmersivo:[&>*]:pointer-events-auto inmersivo:[&>*]:shrink-0 inmersivo:[&>*]:whitespace-nowrap";
  const roundButton =
    "flex h-11 min-w-11 shrink-0 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-medium text-panel-text ring-1 ring-app-border hover:bg-app-border/60";
  const menuItem =
    "flex min-h-11 w-full items-center gap-2 rounded-xl px-3 text-left text-sm font-medium text-panel-text hover:bg-app-border/60";

  // La mesa tocada abre su ficha; los avisos (liberada, sentado, eliminado)
  // se quedan abajo hasta cerrarlos.
  const [tappedId, setTappedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tableBusy, setTableBusy] = useState(false);
  const [releaseAllOpen, setReleaseAllOpen] = useState(false);
  const [releaseAllText, setReleaseAllText] = useState("");
  const tapped = tappedId ? zone?.elements.find((e) => e.id === tappedId) ?? null : null;
  const occupiedCount = zones.reduce((n, z) => n + z.elements.filter((e) => e.currentEntryId).length, 0);
  const canReleaseAll = Boolean(tableActions?.releaseAll) && occupiedCount > 0;
  const releaseAll = async () => {
    if (!tableActions?.releaseAll || releaseAllText.trim() !== "LIBERAR") return;
    setTableBusy(true);
    const result = await tableActions.releaseAll();
    setTableBusy(false);
    setReleaseAllOpen(false);
    setReleaseAllText("");
    setNotice(
      result.ok
        ? `Se liberaron ${result.released} ${result.released === 1 ? "mesa" : "mesas"}. Se puede deshacer con «Deshacer» en el modo sencillo.`
        : result.error,
    );
  };

  // «Más»: las acciones que se usan poco, en un menú. Se cierra al tocar fuera.
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!moreOpen) return;
    const onDown = (event: PointerEvent) => {
      if (moreRef.current && !moreRef.current.contains(event.target as Node)) setMoreOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMoreOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [moreOpen]);

  // Leyenda plegable (cerrada al empezar: los colores se aprenden enseguida).
  const [legendOpen, setLegendOpen] = useState(false);

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
      {/* Una barra compacta: lista de espera, en vivo, zonas, meseros y «Más».
          En el celular los meseros también pasan a «Más». */}
      <div className={`flex flex-wrap items-center gap-2 ${floatingBar}`}>
        {immersive ? (
          <span className="hidden max-w-[12rem] truncate rounded-full bg-panel/85 px-3 py-1.5 text-xs font-semibold text-panel-text ring-1 ring-app-border inmersivo:block inmersivo:!shrink">
            {immersive.restaurantName}
          </span>
        ) : null}
        {immersive?.waitlistHref ? (
          // Siempre visible y el primero de la barra: es lo que más se usa.
          // Con la tablet acostada y poco ancho dice solo «Lista» (el número
          // sigue), para que quepa con lo demás en una línea.
          <button
            type="button"
            onClick={() => (waitlistOpen ? setWaitlistOpen(false) : openWaitlist())}
            aria-expanded={waitlistOpen}
            aria-label={`Lista de espera: ${plan?.waiting ?? 0} esperando`}
            title="Lista de espera: agregar, avisar, sentar y liberar"
            aria-controls="panel-lista-espera"
            className="flex h-11 min-w-11 shrink-0 items-center justify-center gap-2 rounded-xl bg-accent px-3.5 text-sm font-semibold text-accent-text shadow-sm transition hover:bg-accent/85"
          >
            <ListOrdered aria-hidden size={18} strokeWidth={2} />
            <span>
              Lista<span className="max-[1099px]:inmersivo:hidden"> de espera</span>
            </span>
            <span aria-hidden className="min-w-6 rounded-full bg-accent-text/20 px-1.5 text-center tabular-nums">
              {plan?.waiting ?? 0}
            </span>
          </button>
        ) : null}
        {toolbar}
        {zones.length > 1 ? (
          <div
            role="tablist"
            aria-label="Zonas"
            className="flex max-w-full flex-nowrap gap-1 overflow-x-auto rounded-xl bg-panel p-1 ring-1 ring-app-border [scrollbar-width:none] inmersivo:bg-panel/85"
          >
            {zones.map((z) => (
              <button
                key={z.id}
                type="button"
                role="tab"
                aria-selected={z.id === zone?.id}
                onClick={() => setZoneId(z.id)}
                className={`h-9 shrink-0 whitespace-nowrap rounded-lg px-3 text-sm font-medium inmersivo:px-2.5 inmersivo:text-xs ${
                  z.id === zone?.id ? "bg-accent text-accent-text" : "text-panel-muted hover:bg-app-border/60"
                }`}
              >
                {z.name}
              </button>
            ))}
          </div>
        ) : null}
        <div className="hidden sm:block inmersivo:[&>div]:bg-panel/85">
          <WaiterSelector state={waiters} />
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
        <div ref={moreRef} className="relative ml-auto">
          <button
            type="button"
            onClick={() => setMoreOpen((open) => !open)}
            aria-expanded={moreOpen}
            aria-controls="plano-mas"
            className={`${roundButton} bg-panel inmersivo:bg-panel/85`}
          >
            <MoreHorizontal aria-hidden size={18} strokeWidth={2} />
            Más
          </button>
          {/* Siempre en el HTML (oculto si está cerrado): así el contenido
              también lo ve quien lo busca sin abrir el menú (y las pruebas). */}
          <div
            id="plano-mas"
            hidden={!moreOpen}
            className={`absolute right-0 top-full z-40 mt-2 w-[min(24rem,calc(100vw-1.5rem))] flex-col gap-2 rounded-2xl bg-panel p-3 text-panel-text shadow-xl ring-1 ring-app-border ${moreOpen ? "flex" : "hidden"}`}
          >
            <div className="sm:hidden">
              <WaiterSelector state={waiters} />
            </div>
            {canManageWaiters && !waiters.editing ? (
              <div className="[&>div]:flex-col [&>div]:items-stretch">
                <WaiterActions state={waiters} />
              </div>
            ) : null}
            {canReleaseAll ? (
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  setReleaseAllOpen(true);
                }}
                className={menuItem}
                title="Dejar todas las mesas libres (para empezar el día limpio)"
              >
                <DoorOpen aria-hidden size={18} strokeWidth={2} />
                Liberar todas las mesas
              </button>
            ) : null}
            {immersive && immersiveActive ? (
              <button type="button" onClick={() => { setMoreOpen(false); setImmersiveMode("normal"); }} className={menuItem}>
                <Minimize2 aria-hidden size={18} strokeWidth={2} />
                Volver a la vista normal
              </button>
            ) : null}
            {plan && !plan.showNames ? (
              <p className="flex items-center gap-1.5 px-3 text-xs text-panel-muted">
                <EyeOff aria-hidden size={14} strokeWidth={2} />
                Solo estados y ocupación: sin nombres de clientes
              </p>
            ) : null}
            <p className="px-3 text-xs text-panel-muted">Toca una mesa para ver su ficha.</p>
          </div>
        </div>
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
            onElementTap={
              waiters.editing
                ? waiters.tap
                : (id) => {
                    // Solo las mesas tienen ficha (no la caja ni los baños).
                    const element = zone.elements.find((e) => e.id === id);
                    const type = element ? typesById.get(element.elementTypeId) : undefined;
                    if (!type || !isSeatableElement(type.key)) return;
                    setNotice(null);
                    setTappedId(id);
                  }
            }
            onMarquee={waiters.editing && waiters.group ? waiters.marquee : undefined}
          />
        ) : (
          <div className="flex h-full items-center justify-center bg-app-bg p-6 text-center text-sm text-app-muted">
            {plan ? "Este restaurante todavía no tiene plano." : "Cargando plano…"}
          </div>
        )}

        {/* Leyenda pequeña y plegable: estados y meseros. */}
        {zone ? (
          <div className="pointer-events-none absolute bottom-3 right-3 z-10 flex flex-col items-end gap-2">
            {legendOpen ? (
              <div id="plano-leyenda" className="pointer-events-auto w-max max-w-[min(18rem,calc(100vw-2rem))] rounded-2xl bg-panel/95 p-3 text-xs font-medium text-panel-text shadow-lg ring-1 ring-app-border">
                <ul aria-label="Estados de las mesas" className="flex flex-wrap gap-x-3 gap-y-1.5">
                  <li className="flex items-center gap-1.5"><span aria-hidden className="h-3.5 w-3.5 rounded-full bg-panel ring-2 ring-panel-muted/50" />Libre</li>
                  <li className="flex items-center gap-1.5"><span aria-hidden className="h-3.5 w-3.5 rounded-full bg-estado-ocupada" />Ocupada</li>
                  <li className="flex items-center gap-1.5"><span aria-hidden className="h-3.5 w-3.5 rounded-full bg-estado-reservada" />Reservada</li>
                </ul>
                <p className="mt-2 text-panel-muted">El borde y la inicial son del mesero:</p>
                <div className="mt-1.5">
                  <WaiterLegend state={waiters} tableCount={seatableTables.length} />
                </div>
              </div>
            ) : null}
            <button
              type="button"
              onClick={() => setLegendOpen((open) => !open)}
              aria-expanded={legendOpen}
              aria-controls="plano-leyenda"
              className="pointer-events-auto flex h-11 items-center gap-1.5 rounded-full bg-panel/95 px-3.5 text-xs font-semibold text-panel-text shadow-md ring-1 ring-app-border"
            >
              <Info aria-hidden size={15} />
              {legendOpen ? "Ocultar leyenda" : "Leyenda"}
            </button>
          </div>
        ) : null}
      </div>
      </div>

      {/* Ficha de la mesa tocada. */}
      {tapped && plan ? (
        <TableSheet
          key={tapped.id}
          element={tapped}
          waiter={waiters.marks[tapped.id] ?? null}
          showNames={plan.showNames}
          now={now}
          actions={tableActions ?? {}}
          onClose={() => setTappedId(null)}
          onNotice={setNotice}
        />
      ) : null}

      {/* Avisos de lo que se hizo desde la ficha o «Más». */}
      {notice && !tapped ? (
        <div
          role="status"
          className="fixed inset-x-3 bottom-[max(0.75rem,env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md items-center gap-3 rounded-2xl bg-panel p-4 text-sm text-panel-text shadow-2xl ring-1 ring-app-border"
        >
          <p className="min-w-0 flex-1">{notice}</p>
          <button type="button" onClick={() => setNotice(null)} aria-label="Cerrar el aviso" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl hover:bg-app-border/60">
            <X aria-hidden size={18} />
          </button>
        </div>
      ) : null}

      {/* «Liberar todas las mesas»: hay que escribir LIBERAR. */}
      {releaseAllOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setReleaseAllOpen(false)}>
          <div
            role="dialog"
            aria-labelledby="liberar-todas-titulo"
            className="w-full max-w-md rounded-2xl bg-panel p-5 text-panel-text shadow-xl ring-1 ring-app-border"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="liberar-todas-titulo" className="text-lg font-semibold">¿Liberar todas las mesas?</h2>
            <p className="mt-2 text-sm text-panel-muted">
              Se liberarán las {occupiedCount} mesas ocupadas de este restaurante (todas las zonas). Los clientes siguen en el
              historial y cuentan en las estadísticas. Para confirmar, escribe <strong className="text-panel-text">LIBERAR</strong>.
            </p>
            <input
              value={releaseAllText}
              onChange={(e) => setReleaseAllText(e.target.value)}
              aria-label="Escribe LIBERAR para confirmar"
              autoComplete="off"
              className="mt-4 h-11 w-full rounded-xl border border-app-border bg-app-bg px-3 text-panel-text"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={() => setReleaseAllOpen(false)} className="h-11 rounded-xl px-4 text-sm font-medium hover:bg-app-border/60">
                Cancelar
              </button>
              <button
                type="button"
                disabled={tableBusy || releaseAllText.trim() !== "LIBERAR"}
                onClick={() => void releaseAll()}
                className="h-11 rounded-xl bg-estado-ocupada px-4 text-sm font-semibold text-app-bg disabled:opacity-50"
              >
                {tableBusy ? "Liberando…" : "Liberar todas"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* La lista de espera: el modo sencillo en un panel que se pone encima
          de todo (`fixed`): a la derecha en pantallas anchas y a pantalla
          completa en el celular. Se cierra con la X o con Esc. */}
      {immersive?.waitlistHref && waitlistMounted ? (
        <aside
          id="panel-lista-espera"
          aria-label="Lista de espera"
          inert={!waitlistOpen}
          className={`fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-app-border bg-panel pb-[env(safe-area-inset-bottom)] pt-[env(safe-area-inset-top)] shadow-2xl transition-transform duration-200 sm:w-[min(26rem,92vw)] ${
            waitlistOpen ? "translate-x-0" : "pointer-events-none translate-x-full"
          }`}
        >
          <div className="flex shrink-0 items-center gap-2 border-b border-app-border px-3 py-1.5">
            <h2 className="flex-1 text-sm font-semibold text-panel-text">Lista de espera</h2>
            <button
              ref={closeWaitlistRef}
              type="button"
              onClick={() => setWaitlistOpen(false)}
              aria-label="Cerrar la lista de espera"
              title="Cerrar (Esc)"
              className="flex h-11 w-11 items-center justify-center rounded-xl text-panel-text hover:bg-app-border/60"
            >
              <X aria-hidden size={20} strokeWidth={2} />
            </button>
          </div>
          <iframe
            src={immersive.waitlistHref}
            title="Lista de espera (modo sencillo)"
            onLoad={(event) => listenInsideWaitlist(event.currentTarget)}
            className="min-h-0 w-full flex-1 border-0 bg-app-bg"
          />
        </aside>
      ) : null}
    </div>
  );
}
