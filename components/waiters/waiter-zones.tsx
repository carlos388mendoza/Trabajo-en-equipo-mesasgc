"use client";

// Zonas de meseros en el modo completo (plano en vivo y editor).
//
//  - `WaiterSelector`: «Meseros activos: [−] 3 [+]». Los botones cambian la
//    cantidad de meseros: activan la configuración con ese número y, si
//    todavía no existe, la crean con las mesas ya repartidas. El cambio
//    llega a todas las tablets del restaurante por el socket
//    (`waiters:changed`). Quien solo puede mirar (analítica) ve el selector,
//    pero no lo puede usar.
//  - `useWaiterZones`: el estado del reparto. Fuera de la edición, las marcas
//    del plano son las de la configuración ACTIVA; editando, las del borrador.
//  - `WaiterEditorPanel`: nombre y color de cada mesero, «pincel» para pintar
//    mesas con un toque, selección en grupo (rectángulo) y reparto automático.
//
// Ocultar los botones a quien no puede no protege nada: cada server action
// vuelve a comprobar `meseros:gestionar` (ver `app/restaurante/[id]/meseros/
// actions.ts`).

import { useMemo, useState, useTransition } from "react";
import { Eraser, Minus, Paintbrush, Plus, Save, SquareDashedMousePointer, Trash2, Users, Wand2, X } from "lucide-react";

import {
  activateWaiterConfigAction,
  createWaiterConfigAction,
  deleteWaiterConfigAction,
  saveWaiterConfigAction,
} from "@/app/restaurante/[id]/meseros/actions";
import type { CanvasWaiterMark } from "@/components/editor/konva-canvas";
import { MAX_WAITERS, autoBalance, type BalanceTable } from "@/lib/waiters/balance";
import type { WaiterConfig } from "@/lib/waiters/configs";

type DraftZone = { id: string; position: number; waiterName: string; color: string };
type Draft = {
  configId: string;
  version: number;
  name: string;
  zones: DraftZone[];
  /** Mesa → zona. */
  assign: Record<string, string>;
};

/** Pincel: la zona con la que se pinta, o `null` para quitar el mesero. */
type Brush = string | null;

function draftFrom(config: WaiterConfig): Draft {
  const assign: Record<string, string> = {};
  for (const zone of config.zones) for (const tableId of zone.tableIds) assign[tableId] = zone.id;
  return {
    configId: config.id,
    version: config.version,
    name: config.name,
    zones: config.zones.map(({ id, position, waiterName, color }) => ({ id, position, waiterName, color })),
    assign,
  };
}

function marksOf(zones: DraftZone[], assign: Record<string, string>): Record<string, CanvasWaiterMark> {
  const byId = new Map(zones.map((z) => [z.id, z]));
  const out: Record<string, CanvasWaiterMark> = {};
  for (const [tableId, zoneId] of Object.entries(assign)) {
    const zone = byId.get(zoneId);
    if (zone) out[tableId] = { color: zone.color, label: zone.waiterName };
  }
  return out;
}

export type WaiterZonesState = ReturnType<typeof useWaiterZones>;

export function useWaiterZones({
  restaurantId,
  configs: serverConfigs,
  canManage,
  tables,
  layoutOrder,
}: {
  restaurantId: string;
  configs: WaiterConfig[];
  canManage: boolean;
  /** Solo las mesas sentables: las demás no se reparten. */
  tables: BalanceTable[];
  layoutOrder: string[];
}) {
  // Lo último que respondió una action manda hasta que llega el plano nuevo
  // (patrón de «estado derivado de una prop»: se compara en el render).
  const [configs, setConfigs] = useState(serverConfigs);
  const [seen, setSeen] = useState(serverConfigs);
  if (seen !== serverConfigs) {
    setSeen(serverConfigs);
    setConfigs(serverConfigs);
  }
  const [draft, setDraft] = useState<Draft | null>(null);
  const [brush, setBrush] = useState<Brush>(null);
  const [group, setGroup] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const active = configs.find((c) => c.isActive) ?? null;
  const seatable = useMemo(() => new Set(tables.map((t) => t.id)), [tables]);

  const marks = useMemo(() => {
    if (draft) return marksOf(draft.zones, draft.assign);
    if (!active) return {};
    return marksOf(active.zones, draftFrom(active).assign);
  }, [draft, active]);

  function run(task: () => Promise<{ ok: true; configs: WaiterConfig[] } | { ok: false; error: string }>, done?: (configs: WaiterConfig[]) => void, okText?: string) {
    setMessage(null);
    startTransition(async () => {
      const result = await task();
      if (!result.ok) {
        setMessage({ ok: false, text: result.error });
        return;
      }
      setConfigs(result.configs);
      done?.(result.configs);
      if (okText) setMessage({ ok: true, text: okText });
    });
  }

  /** `toggle`: un toque sobre una mesa que ya es de ese mesero se la quita. */
  function paint(ids: string[], toggle: boolean) {
    if (!draft) return;
    const valid = ids.filter((id) => seatable.has(id));
    if (valid.length === 0) return;
    setDraft((d) => {
      if (!d) return d;
      const assign = { ...d.assign };
      // Un toque sobre una mesa que ya es de ese mesero se la quita: así se
      // corrige un toque de más sin cambiar de pincel. El rectángulo, en
      // cambio, siempre asigna (aunque solo atrape una mesa).
      const single = toggle && valid.length === 1 && brush !== null && assign[valid[0]] === brush;
      for (const id of valid) {
        if (brush === null || single) delete assign[id];
        else assign[id] = brush;
      }
      return { ...d, assign };
    });
  }

  return {
    configs,
    active,
    marks,
    draft,
    brush,
    group,
    pending,
    message,
    canManage,
    editing: draft !== null,
    setBrush,
    setGroup,
    clearMessage: () => setMessage(null),
    /** Toque sobre un elemento del plano. */
    tap: (id: string) => paint([id], true),
    /** Rectángulo de la selección en grupo. */
    marquee: (ids: string[]) => paint(ids, false),
    activate: (configId: string) =>
      run(
        () => activateWaiterConfigAction({ restaurantId, configId }),
        undefined,
        `Ahora: ${configs.find((c) => c.id === configId)?.name ?? "configuración"}.`,
      ),
    /**
     * Los botones [−] y [+]: pasan a estar activa la configuración con ese
     * número de meseros y, si todavía no existe, la crean con las mesas ya
     * repartidas (`autoBalance`, la misma lógica de siempre) y la activan.
     *
     * Crear y activar son dos server actions distintas y CADA UNA avisa por
     * el socket, así que las demás tablets se enteran igual que con el
     * selector de antes. Si no llega a crearse (por ejemplo, porque ya hay 12
     * configuraciones), el error queda en `message` y no se cambia nada.
     */
    setWaiterCount: (target: number) => {
      if (!canManage || pending || draft !== null) return;
      const next = Math.max(1, Math.min(MAX_WAITERS, Math.round(target)));
      const plural = next === 1 ? "mesero" : "meseros";
      const existing = configs.find((c) => c.waiterCount === next);
      if (existing) {
        if (existing.id === active?.id) return;
        run(
          () => activateWaiterConfigAction({ restaurantId, configId: existing.id }),
          undefined,
          `Ahora con ${next} ${plural}.`,
        );
        return;
      }
      run(
        async () => {
          const created = await createWaiterConfigAction({ restaurantId, waiterCount: next });
          if (!created.ok) return created;
          return activateWaiterConfigAction({ restaurantId, configId: created.configId });
        },
        undefined,
        `Se creó la configuración de ${next} ${plural} con las mesas ya repartidas, y está activa.`,
      );
    },
    create: (waiterCount: number) =>
      run(
        async () => {
          const res = await createWaiterConfigAction({ restaurantId, waiterCount });
          if (res.ok) {
            const created = res.configs.find((c) => c.id === res.configId);
            if (created) {
              setDraft(draftFrom(created));
              setBrush(created.zones[0]?.id ?? null);
            }
          }
          return res;
        },
        undefined,
        "Configuración creada con las mesas ya repartidas. Ajusta nombres y colores y guarda.",
      ),
    edit: (configId: string) => {
      const config = configs.find((c) => c.id === configId);
      if (!config) return;
      setMessage(null);
      setDraft(draftFrom(config));
      setBrush(config.zones[0]?.id ?? null);
    },
    cancel: () => {
      setDraft(null);
      setGroup(false);
      setMessage(null);
    },
    setName: (name: string) => setDraft((d) => (d ? { ...d, name } : d)),
    setZone: (zoneId: string, patch: Partial<Pick<DraftZone, "waiterName" | "color">>) =>
      setDraft((d) => (d ? { ...d, zones: d.zones.map((z) => (z.id === zoneId ? { ...z, ...patch } : z)) } : d)),
    autoBalance: () =>
      setDraft((d) => {
        if (!d) return d;
        const result = autoBalance(tables, d.zones.length, layoutOrder);
        const assign: Record<string, string> = {};
        for (const [tableId, index] of result) assign[tableId] = d.zones[index].id;
        return { ...d, assign };
      }),
    save: () => {
      if (!draft) return;
      const invalid = draft.zones.find((z) => z.waiterName.trim() === "");
      if (invalid || draft.name.trim() === "") {
        setMessage({ ok: false, text: "Cada mesero necesita un nombre, y la configuración también." });
        return;
      }
      run(
        () =>
          saveWaiterConfigAction({
            restaurantId,
            configId: draft.configId,
            version: draft.version,
            name: draft.name,
            zones: draft.zones.map(({ id, waiterName, color }) => ({ id, waiterName, color })),
            assignments: Object.entries(draft.assign).map(([tableId, zoneId]) => ({ tableId, zoneId })),
          }),
        () => {
          setDraft(null);
          setGroup(false);
        },
        "Zonas de meseros guardadas.",
      );
    },
    remove: () => {
      if (!draft) return;
      run(
        () => deleteWaiterConfigAction({ restaurantId, configId: draft.configId }),
        () => {
          setDraft(null);
          setGroup(false);
        },
        "Configuración borrada.",
      );
    },
  };
}

/**
 * «Meseros activos: [−] 3 [+]».
 *
 * El contador manda de verdad: activa la configuración con ese número de
 * meseros y, si no existe, la crea con las mesas repartidas y la activa (ver
 * `setWaiterCount`). Analítica lo ve, pero no lo puede cambiar.
 *
 * Los botones miden 44×44 px (`h-11 w-11`) para que sirvan con el dedo, se
 * desactivan en los extremos (1 y `MAX_WAITERS`) y llevan `aria-label`
 * propio; el valor está en un `aria-live` para que un lector de pantalla lo
 * anuncie al cambiar.
 */
export function WaiterSelector({ state }: { state: WaiterZonesState }) {
  const { configs, active, canManage, pending, editing } = state;
  if (configs.length === 0 && !canManage) return null;
  const frozen = !canManage || pending || editing;
  const count = active?.waiterCount ?? configs[0]?.waiterCount ?? 1;
  const plural = count === 1 ? "mesero" : "meseros";
  return (
    <div className="flex flex-wrap items-center gap-1 rounded-xl bg-panel p-1 text-panel-text ring-1 ring-app-border">
      <span className="flex items-center gap-1.5 px-2 text-sm font-medium text-panel-muted">
        <Users aria-hidden size={16} strokeWidth={2} />
        Meseros activos:
      </span>
      {configs.length === 0 ? <span className="px-1 text-sm text-panel-muted">sin configuración</span> : null}
      <div
        role="group"
        aria-label="Cantidad de meseros activos"
        title={active ? `Configuración activa: ${active.name}` : "Todavía no hay configuración activa"}
        className="flex items-center gap-1"
      >
        <button
          type="button"
          aria-label="Quitar mesero"
          title={count <= 1 ? "Siempre queda al menos un mesero" : "Quitar un mesero"}
          disabled={frozen || count <= 1}
          onClick={() => state.setWaiterCount(count - 1)}
          className="flex h-11 w-11 items-center justify-center rounded-lg text-panel-text transition hover:bg-app-border/60 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <Minus aria-hidden size={18} strokeWidth={2.5} />
        </button>
        <span aria-live="polite" className="min-w-[4.5rem] text-center text-sm font-semibold tabular-nums text-panel-text">
          {count} {plural}
        </span>
        <button
          type="button"
          aria-label="Agregar mesero"
          title={count >= MAX_WAITERS ? `El máximo es ${MAX_WAITERS} meseros` : "Agregar un mesero"}
          disabled={frozen || count >= MAX_WAITERS}
          onClick={() => state.setWaiterCount(count + 1)}
          className="flex h-11 w-11 items-center justify-center rounded-lg text-panel-text transition hover:bg-app-border/60 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <Plus aria-hidden size={18} strokeWidth={2.5} />
        </button>
      </div>
    </div>
  );
}

/** Quién atiende qué, de la configuración que se ve (la activa, o la que se edita). */
export function WaiterLegend({ state, tableCount }: { state: WaiterZonesState; tableCount: number }) {
  const zones = state.draft?.zones ?? state.active?.zones ?? [];
  if (zones.length === 0) return null;
  const counts = new Map<string, number>();
  for (const mark of Object.values(state.marks)) counts.set(mark.label + mark.color, (counts.get(mark.label + mark.color) ?? 0) + 1);
  const assigned = Object.keys(state.marks).length;
  return (
    <ul aria-label="Meseros y sus mesas" className="flex flex-wrap items-center gap-1.5 text-xs font-medium">
      {zones.map((z) => (
        <li key={z.id} className="flex items-center gap-1.5 rounded-full bg-panel px-2.5 py-1 text-panel-text ring-1 ring-app-border">
          <span aria-hidden className="h-3 w-3 rounded-full" style={{ backgroundColor: z.color }} />
          {z.waiterName}
          <span className="tabular-nums text-panel-muted">· {counts.get(z.waiterName + z.color) ?? 0} mesas</span>
        </li>
      ))}
      {assigned < tableCount ? (
        <li className="rounded-full px-2.5 py-1 text-panel-muted">{tableCount - assigned} sin mesero</li>
      ) : null}
    </ul>
  );
}

/** Botones de gestión junto al selector: nueva configuración y editar. */
export function WaiterActions({ state }: { state: WaiterZonesState }) {
  const [count, setCount] = useState(3);
  if (!state.canManage || state.editing) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {state.active ? (
        <button
          type="button"
          onClick={() => state.edit(state.active!.id)}
          disabled={state.pending}
          className="flex h-11 items-center gap-1.5 rounded-xl bg-panel px-3 text-sm font-medium text-panel-text ring-1 ring-app-border hover:bg-app-border/60"
        >
          <Paintbrush aria-hidden size={16} strokeWidth={2} />
          Editar zonas
        </button>
      ) : null}
      <div
        role="group"
        aria-label="Cantidad de meseros de la nueva configuración"
        className="flex items-center gap-1 rounded-xl bg-panel p-1 ring-1 ring-app-border"
      >
        <button
          type="button"
          aria-label="Quitar mesero de la nueva configuración"
          title={count <= 1 ? "Siempre queda al menos un mesero" : "Quitar un mesero"}
          disabled={count <= 1}
          onClick={() => setCount((value) => Math.max(1, value - 1))}
          className="flex h-11 w-11 items-center justify-center rounded-lg text-panel-text transition hover:bg-app-border/60 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <Minus aria-hidden size={18} strokeWidth={2.5} />
        </button>
        <span aria-live="polite" className="min-w-10 text-center text-sm font-semibold tabular-nums text-panel-text">
          {count}
        </span>
        <button
          type="button"
          aria-label="Agregar mesero de la nueva configuración"
          title={count >= MAX_WAITERS ? `El máximo es ${MAX_WAITERS} meseros` : "Agregar un mesero"}
          disabled={count >= MAX_WAITERS}
          onClick={() => setCount((value) => Math.min(MAX_WAITERS, value + 1))}
          className="flex h-11 w-11 items-center justify-center rounded-lg text-panel-text transition hover:bg-app-border/60 disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
        >
          <Plus aria-hidden size={18} strokeWidth={2.5} />
        </button>
        <button
          type="button"
          onClick={() => state.create(count)}
          disabled={state.pending}
          title="Crea la configuración con las mesas ya repartidas, sin activarla todavía"
          className="flex h-11 items-center rounded-lg px-3 text-sm font-medium text-panel-text hover:bg-app-border/60 disabled:cursor-default disabled:opacity-60"
        >
          Nueva con {count} {count === 1 ? "mesero" : "meseros"}
        </button>
      </div>
    </div>
  );
}

/** El panel de edición: pinceles, nombres, colores y guardar. */
export function WaiterEditorPanel({ state }: { state: WaiterZonesState }) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const { draft } = state;
  if (!draft) return null;
  return (
    <section
      aria-label="Editar zonas de meseros"
      className="flex max-h-full w-full flex-col gap-3 overflow-y-auto rounded-2xl bg-panel/95 p-3 text-panel-text shadow-xl ring-1 ring-app-border backdrop-blur-md sm:w-80"
    >
      <div className="flex items-center gap-2">
        <label className="min-w-0 flex-1">
          <span className="text-xs text-panel-muted">Nombre de la configuración</span>
          <input
            value={draft.name}
            maxLength={40}
            onChange={(e) => state.setName(e.target.value)}
            className="mt-0.5 h-10 w-full rounded-xl border border-app-border bg-panel px-3 text-sm"
          />
        </label>
      </div>

      <p className="text-xs text-panel-muted">
        Elige un mesero y toca sus mesas en el plano (tocar otra vez se la quita). Con «Selección en grupo»
        arrastra un rectángulo sobre varias mesas.
      </p>

      <div role="radiogroup" aria-label="Pincel" className="flex flex-col gap-1.5">
        {draft.zones.map((z) => (
          <div
            key={z.id}
            className={`flex items-center gap-2 rounded-xl p-1.5 ring-1 ${state.brush === z.id ? "bg-accent/10 ring-accent" : "ring-app-border"}`}
          >
            <button
              type="button"
              role="radio"
              aria-checked={state.brush === z.id}
              aria-label={`Pintar con ${z.waiterName}`}
              onClick={() => state.setBrush(z.id)}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg"
              style={{ backgroundColor: z.color }}
            >
              {state.brush === z.id ? <Paintbrush aria-hidden size={18} color="#ffffff" strokeWidth={2.5} /> : null}
            </button>
            <input
              aria-label={`Nombre del mesero ${z.position}`}
              value={z.waiterName}
              maxLength={30}
              onChange={(e) => state.setZone(z.id, { waiterName: e.target.value })}
              className="h-10 min-w-0 flex-1 rounded-lg border border-app-border bg-panel px-2 text-sm"
            />
            <input
              type="color"
              aria-label={`Color de ${z.waiterName}`}
              value={z.color}
              onChange={(e) => state.setZone(z.id, { color: e.target.value })}
              className="h-10 w-10 shrink-0 cursor-pointer rounded-lg border border-app-border bg-panel p-1"
            />
          </div>
        ))}
        <button
          type="button"
          role="radio"
          aria-checked={state.brush === null}
          onClick={() => state.setBrush(null)}
          className={`flex h-10 items-center gap-2 rounded-xl px-3 text-sm ring-1 ${state.brush === null ? "bg-accent/10 ring-accent" : "ring-app-border"}`}
        >
          <Eraser aria-hidden size={16} strokeWidth={2} />
          Quitar mesero
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          aria-pressed={state.group}
          onClick={() => state.setGroup(!state.group)}
          className={`flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-medium ring-1 ${state.group ? "bg-accent text-accent-text ring-accent" : "ring-app-border hover:bg-app-border/60"}`}
        >
          <SquareDashedMousePointer aria-hidden size={16} strokeWidth={2} />
          Selección en grupo
        </button>
        <button
          type="button"
          onClick={state.autoBalance}
          className="flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-medium ring-1 ring-app-border hover:bg-app-border/60"
        >
          <Wand2 aria-hidden size={16} strokeWidth={2} />
          Repartir automáticamente
        </button>
      </div>

      <div className="flex flex-wrap gap-1.5 border-t border-app-border pt-3">
        <button
          type="button"
          onClick={state.save}
          disabled={state.pending}
          className="flex h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent px-3 text-sm font-semibold text-accent-text disabled:opacity-60"
        >
          <Save aria-hidden size={16} strokeWidth={2} />
          {state.pending ? "Guardando…" : "Guardar"}
        </button>
        <button
          type="button"
          onClick={state.cancel}
          disabled={state.pending}
          className="flex h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-medium ring-1 ring-app-border hover:bg-app-border/60"
        >
          <X aria-hidden size={16} strokeWidth={2} />
          Cancelar
        </button>
        {confirmDelete ? (
          <div role="alertdialog" aria-label="Borrar configuración" className="flex w-full flex-wrap items-center gap-1.5 rounded-xl bg-estado-ocupada/10 p-2 text-sm">
            <span className="flex-1">¿Borrar «{draft.name}»?</span>
            <button type="button" onClick={state.remove} className="h-10 rounded-lg bg-estado-ocupada px-3 font-semibold text-white">
              Aceptar
            </button>
            <button type="button" onClick={() => setConfirmDelete(false)} className="h-10 rounded-lg px-3 ring-1 ring-app-border">
              Cancelar
            </button>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setConfirmDelete(true)}
            disabled={state.pending}
            className="flex h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-estado-ocupada ring-1 ring-estado-ocupada/40 hover:bg-estado-ocupada/10"
          >
            <Trash2 aria-hidden size={16} strokeWidth={2} />
            Borrar
          </button>
        )}
      </div>
    </section>
  );
}

/** Aviso del resultado de la última acción de meseros. */
export function WaiterMessage({ state }: { state: WaiterZonesState }) {
  if (!state.message) return null;
  return (
    <p
      role={state.message.ok ? "status" : "alert"}
      className={`rounded-xl px-3 py-2 text-sm ring-1 ring-app-border ${state.message.ok ? "bg-panel text-estado-libre" : "bg-panel text-critica"}`}
    >
      {state.message.text}
    </p>
  );
}
