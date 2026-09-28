"use client";

// El editor de mesas: paleta + canvas + barra de herramientas.
//
// Este es el ÚNICO punto donde se decide cómo se carga Konva. Konva usa
// `document` y el contexto 2D del canvas en el momento de importarse, así que
// importarlo en el servidor peta. Next 15+ además prohíbe `ssr: false` dentro
// de un Server Component, y la page lo es; por eso el `dynamic` vive aquí, en
// un Client Component, y no en `editor/page.tsx`.
//
// Dos detalles que parecen arbitrarios y no lo son:
//
//  - La zona activa viaja en la URL (`?zona=`), no en el estado. Así el
//    botón "atrás" del navegador funciona y recargar no pierde el sitio. La
//    page monta este componente con `key={layout.id}`, así que cambiar de zona
//    lo remonta y el estado local empieza limpio, sin efectos ni cascadas.
//  - El handle del canvas se pasa por prop en vez de por `ref`, para no
//    depender de que `next/dynamic` reenvíe los refs.
//
// Pensado para tablet: todos los botones miden al menos 44 px y llevan ícono y
// texto, porque en una pantalla táctil no hay "hover" que explique un ícono.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  CircleAlert,
  CircleCheck,
  Copy,
  Radio,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Save,
  Scan,
  Trash2,
  Undo2,
  WifiOff,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import type { CanvasHandle } from "./konva-canvas";
import { DND_MIME, ElementPalette } from "./element-palette";
import { CopyLayoutDialog } from "./copy-layout-dialog";
import { ICON_STROKE } from "./icons";
import { useRestaurantSocket } from "@/components/realtime/use-restaurant-socket";
import type { TableStatus } from "@/lib/db/enums";
import { nextLabel } from "@/lib/layout/element-style";
import type { ElementTypeInfo, LayoutElement, LayoutSummary } from "@/lib/layout/types";
// La action vive en la ruta (convención de Next para "use server"), y el
// editor la importa por el alias en vez de por una ruta relativa que
// saltaría de `components/` a `app/`.
import {
  getTableOccupantInfo,
  saveLayoutStructure,
  type RestaurantOption,
} from "@/app/restaurante/[id]/editor/actions";

// `ssr: false` es imprescindible: ver la cabecera del archivo.
const KonvaCanvas = dynamic(
  () => import("./konva-canvas").then((mod) => mod.KonvaCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-slate-100 text-sm text-neutral-500">
        Cargando mapa…
      </div>
    ),
  },
);

/** Pasos de giro: el plano entero va de 90 en 90; un elemento, de 45 en 45. */
const VIEW_STEP = 90;
const ELEMENT_STEP = 45;
/** Cuántos pasos de "Deshacer" se recuerdan. */
const HISTORY_LIMIT = 50;

type Props = {
  restaurantId: string;
  layoutId: string;
  layoutName: string;
  width: number;
  height: number;
  version: number;
  elements: LayoutElement[];
  types: ElementTypeInfo[];
  layouts: LayoutSummary[];
  /** A quién se le puede copiar la estructura. Lo carga la page. */
  copyTargets: RestaurantOption[];
};

type Feedback =
  | { kind: "idle" }
  | { kind: "saved"; text: string }
  | { kind: "error"; text: string };

/** Ángulo en [0, 360): la columna admite ±360, pero así no crece sin fin. */
function normalizeAngle(angle: number): number {
  return ((angle % 360) + 360) % 360;
}

/**
 * Lo que el editor edita de un elemento, sin la ocupación. Sirve para saber si
 * "Deshacer" ha vuelto exactamente a lo guardado.
 */
function structureKey(elements: LayoutElement[]): string {
  return JSON.stringify(
    elements.map((e) => [
      e.id,
      e.elementTypeId,
      e.label,
      e.x,
      e.y,
      e.width,
      e.height,
      e.rotation,
      e.capacity,
    ]),
  );
}

export function EditorClient({
  restaurantId,
  layoutId,
  layoutName,
  width,
  height,
  version,
  elements: initialElements,
  types,
  layouts,
  copyTargets,
}: Props) {
  const router = useRouter();
  const controllerRef = useRef<CanvasHandle | null>(null);

  const [elements, setElements] = useState<LayoutElement[]>(initialElements);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [zoom, setZoom] = useState(100);
  const [feedback, setFeedback] = useState<Feedback>({ kind: "idle" });
  const [copyOpen, setCopyOpen] = useState(false);
  // Giro de la VISTA del plano, en pasos de 90°. `table_layouts` no tiene
  // dónde guardarlo, así que es solo de esta pantalla (ver README).
  const [viewRotation, setViewRotation] = useState(0);
  // Versión de la zona que tiene este editor, y la última que otro
  // dispositivo anunció. Si la de fuera es mayor, lo de la pantalla es viejo.
  const [savedVersion, setSavedVersion] = useState(version);
  const [remoteVersion, setRemoteVersion] = useState(version);
  const [structureChanged, setStructureChanged] = useState(false);

  // --- Deshacer ------------------------------------------------------------
  //
  // Una pila de fotos de `elements` tomadas JUSTO ANTES de cada cambio. Es
  // solo del editor: no toca el guardado, y deshacer deja "cambios sin
  // guardar" como cualquier otra edición.
  const [history, setHistory] = useState<LayoutElement[][]>([]);
  // Los handlers leen la foto del último render; un ref evita recrearlos en
  // cada cambio de `elements`.
  const elementsRef = useRef(elements);
  useEffect(() => {
    elementsRef.current = elements;
  }, [elements]);
  // Escribir un nombre letra a letra no son 12 pasos de deshacer: las
  // ediciones seguidas del mismo campo cuentan como una.
  const lastEditKeyRef = useRef<string | null>(null);
  // Lo que hay guardado en la base de datos, para saber si deshacer volvió ahí.
  const savedKeyRef = useRef(structureKey(initialElements));

  const recordEdit = useCallback((coalesceKey: string | null = null) => {
    if (coalesceKey !== null && coalesceKey === lastEditKeyRef.current) return;
    lastEditKeyRef.current = coalesceKey;
    const snapshot = elementsRef.current;
    setHistory((prev) => [...prev.slice(-(HISTORY_LIMIT - 1)), snapshot]);
  }, []);

  const typesById = useMemo(
    () => new Map(types.map((t) => [t.id, t])),
    [types],
  );

  const selected = selectedId
    ? elements.find((e) => e.id === selectedId) ?? null
    : null;

  const markDirty = useCallback(() => {
    setDirty(true);
    setFeedback({ kind: "idle" });
  }, []);

  const patchElement = useCallback(
    (id: string, patch: Partial<LayoutElement>) => {
      setElements((prev) =>
        prev.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      );
    },
    [],
  );

  const undo = useCallback(() => {
    if (history.length === 0) return;
    const snapshot = history[history.length - 1];
    setHistory(history.slice(0, -1));
    lastEditKeyRef.current = null;

    // La ocupación no se deshace: es lo que pasa en el local AHORA, no una
    // edición de este usuario. Se conserva la de pantalla.
    const live = new Map(elementsRef.current.map((e) => [e.id, e]));
    const restored = snapshot.map((e) => {
      const now = live.get(e.id);
      return now
        ? {
            ...e,
            status: now.status,
            currentEntryId: now.currentEntryId,
            occupantName: now.occupantName,
            seatedAt: now.seatedAt,
          }
        : e;
    });
    setElements(restored);
    setSelectedId((current) =>
      current && restored.some((e) => e.id === current) ? current : null,
    );
    setDirty(structureKey(restored) !== savedKeyRef.current);
    setFeedback({ kind: "idle" });
  }, [history]);

  // Un contador por mesa: cada evento en vivo lo sube y la mesa hace su pulso.
  const [pulses, setPulses] = useState<Record<string, number>>({});
  const pulse = useCallback((tableId: string) => {
    setPulses((prev) => ({ ...prev, [tableId]: (prev[tableId] ?? 0) + 1 }));
  }, []);

  // Un solo reloj para todos los contadores de minutos del mapa. Cada 30 s
  // basta: el contador muestra minutos enteros.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  // Tiempo real. La ocupación se aplica directamente: `status` y
  // `currentEntryId` no los edita el editor ni los manda al guardar, así que
  // actualizarlos no crea cambios sin guardar.
  //
  // La estructura NO se recarga sola: pisaría lo que el usuario esté moviendo
  // en ese momento. Se avisa y él decide.
  const realtime = useRestaurantSocket(restaurantId, {
    "table:assigned": ({ table, entryId }) => {
      if (table.layoutId !== layoutId) return;
      // La hora del aviso sirve de hora provisional hasta que llegue la real.
      patchElement(table.tableId, {
        status: table.status,
        currentEntryId: table.currentEntryId,
        occupantName: null,
        seatedAt: Date.now(),
      });
      pulse(table.tableId);
      // El aviso trae el id del cliente, no su nombre: se pide aparte, solo
      // lectura. Si mientras tanto la mesa cambió otra vez, se descarta.
      void getTableOccupantInfo({ restaurantId, tableId: table.tableId }).then((info) => {
        if (!info || info.entryId !== entryId) return;
        setElements((prev) =>
          prev.map((e) =>
            e.id === table.tableId && e.currentEntryId === info.entryId
              ? { ...e, occupantName: info.occupantName, seatedAt: info.seatedAt ?? e.seatedAt }
              : e,
          ),
        );
      });
    },
    "table:released": ({ table }) => {
      if (table.layoutId !== layoutId) return;
      patchElement(table.tableId, {
        status: table.status,
        currentEntryId: table.currentEntryId,
        occupantName: null,
        seatedAt: null,
      });
      pulse(table.tableId);
    },
    "layout:updated": (update) => {
      if (update.layoutId !== layoutId) return;
      setRemoteVersion((v) => Math.max(v, update.version));
    },
    "structure:changed": () => setStructureChanged(true),
  });

  // El aviso de nuestro propio guardado puede llegar antes que la respuesta
  // de la action; mientras se guarda no se enseña, y al terminar
  // `savedVersion` ya lo iguala.
  const staleFromElsewhere =
    !saving && (structureChanged || remoteVersion > savedVersion);

  const addElement = useCallback(
    (type: ElementTypeInfo, centerX: number, centerY: number) => {
      const id = crypto.randomUUID();
      // Los ids los genera el cliente. La server action solo rechaza los que
      // ya viven en OTRA zona, así que un id nuevo es un elemento nuevo.
      const labelsOfType = elements
        .filter((e) => e.elementTypeId === type.id)
        .map((e) => e.label);

      const element: LayoutElement = {
        id,
        elementTypeId: type.id,
        label: nextLabel(type.key, labelsOfType),
        // Se centra en el punto de soltado en vez de ponerlo por la esquina.
        x: Math.round(centerX - type.width / 2),
        y: Math.round(centerY - type.height / 2),
        width: type.width,
        height: type.height,
        rotation: 0,
        capacity: type.defaultCapacity,
        // Una mesa nueva nace libre; la ocupación la cambia el paso 6.
        status: "libre" satisfies TableStatus,
        currentEntryId: null,
        occupantName: null,
        seatedAt: null,
      };

      recordEdit();
      setElements((prev) => [...prev, element]);
      setSelectedId(id);
      markDirty();
    },
    [elements, markDirty, recordEdit],
  );

  /** Añade un elemento en el centro de lo que se ve ahora mismo. */
  const addAtCenter = useCallback(
    (type: ElementTypeInfo) => {
      // Si el canvas todavía no está montado se cae al centro del lienzo.
      const center = controllerRef.current?.viewportCenter() ?? {
        x: width / 2,
        y: height / 2,
      };
      addElement(type, center.x, center.y);
    },
    [addElement, height, width],
  );

  const removeElement = useCallback(
    (id: string) => {
      recordEdit();
      setElements((prev) => prev.filter((e) => e.id !== id));
      setSelectedId((current) => (current === id ? null : current));
      markDirty();
    },
    [markDirty, recordEdit],
  );

  /** Gira el elemento elegido sobre su centro. Sí se guarda (`rotation`). */
  const rotateSelected = useCallback(
    (delta: number) => {
      if (!selected) return;
      recordEdit();
      patchElement(selected.id, { rotation: normalizeAngle(selected.rotation + delta) });
      markDirty();
    },
    [markDirty, patchElement, recordEdit, selected],
  );

  // Teclado: Supr y Retro borran lo seleccionado; Ctrl+Z (Cmd+Z) deshace. Se
  // ignora cuando el foco está en un campo de texto, o el usuario no podría
  // escribir una "b" ni deshacer lo que escribe en un nombre.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === "z") {
        e.preventDefault();
        undo();
        return;
      }
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (!selectedId) return;
      e.preventDefault();
      removeElement(selectedId);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [removeElement, selectedId, undo]);

  const handleDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      // Sin preventDefault en dragOver, el navegador no dispara el drop.
      e.preventDefault();
      const typeId = e.dataTransfer.getData(DND_MIME);
      if (!typeId) return;

      const type = typesById.get(typeId);
      if (!type) return;

      const point = controllerRef.current?.screenToStage(e.clientX, e.clientY);
      if (!point) return;

      addElement(type, point.x, point.y);
    },
    [addElement, typesById],
  );

  const handleSave = useCallback(async () => {
    setSaving(true);
    setFeedback({ kind: "idle" });

    // Se manda solo lo que la action acepta. `status` y `currentEntryId` se
    // dejan fuera a propósito: son del paso 6 y el servidor no debe tocarlos.
    const result = await saveLayoutStructure({
      layoutId,
      restaurantId,
      width,
      height,
      elements: elements.map((e) => ({
        id: e.id,
        elementTypeId: e.elementTypeId,
        label: e.label,
        x: e.x,
        y: e.y,
        width: e.width,
        height: e.height,
        rotation: e.rotation,
        capacity: e.capacity,
      })),
    });

    setSaving(false);

    if (result.ok) {
      setDirty(false);
      setSavedVersion(result.version);
      savedKeyRef.current = structureKey(elements);
      setFeedback({
        kind: "saved",
        text:
          `Guardado: ${result.saved} elemento(s)` +
          (result.removed > 0 ? `, ${result.removed} borrado(s)` : "") +
          `. Versión ${result.version}.`,
      });
    } else {
      setFeedback({ kind: "error", text: result.error });
    }
  }, [elements, height, layoutId, restaurantId, width]);

  return (
    // `h-[70vh]` en vez de `h-full`: el alto tiene que estar DEFINIDO en algún
    // sitio de la cadena, y `h-full` no lo estaba. `main` y `body` tienen alto
    // automático, así que `height: 100%` se resolvía contra "lo que ocupa el
    // contenido", y como el contenido era el propio lienzo, medía cero. Con
    // esta altura, la paleta y el mapa tienen contra qué dimensionarse y el
    // `ResizeObserver` de Konva recibe algo real.
    <div className="flex h-[70vh] min-h-[520px] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white shadow-sm">
      {/* Barra de herramientas */}
      <div className="flex flex-wrap items-center gap-x-1 gap-y-2 border-b border-neutral-200 bg-white px-3 py-2">
        <label className="mr-2 flex flex-col text-[11px] font-medium text-neutral-500">
          Zona
          <select
            value={layoutId}
            onChange={(e) => {
              const next = e.target.value;
              if (next === layoutId) return;
              router.push(
                `/restaurante/${restaurantId}/editor?zona=${encodeURIComponent(next)}`,
              );
            }}
            className="mt-0.5 h-11 rounded-xl border border-neutral-300 bg-white px-3 text-sm font-normal text-neutral-800"
          >
            {layouts.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>

        <ToolButton
          icon={Save}
          label={saving ? "Guardando…" : dirty ? "Guardar" : "Guardado"}
          onClick={handleSave}
          disabled={saving || !dirty}
          title={dirty ? "Guardar los cambios" : "No hay cambios que guardar"}
          primary
        />
        <ToolButton
          icon={Undo2}
          label="Deshacer"
          onClick={undo}
          disabled={history.length === 0}
          title="Deshacer el último cambio (Ctrl+Z)"
        />

        <Divider />

        <ToolButton
          icon={RotateCcw}
          label="Girar ↺"
          onClick={() => setViewRotation((r) => normalizeAngle(r - VIEW_STEP))}
          title="Girar el plano 90° a la izquierda (solo la vista, no se guarda)"
        />
        <ToolButton
          icon={RotateCw}
          label="Girar ↻"
          onClick={() => setViewRotation((r) => normalizeAngle(r + VIEW_STEP))}
          title="Girar el plano 90° a la derecha (solo la vista, no se guarda)"
        />
        <ToolButton
          icon={Copy}
          label="Copiar plano"
          onClick={() => setCopyOpen(true)}
          disabled={dirty}
          title={
            dirty
              ? "Guarda los cambios antes de copiar, para no copiar una versión vieja"
              : "Copiar zonas y mesas a otro restaurante"
          }
        />

        <Divider />

        <ToolButton
          icon={ZoomOut}
          label="Alejar"
          onClick={() => controllerRef.current?.zoomOut()}
        />
        <span className="w-12 text-center text-sm tabular-nums text-neutral-600">
          {zoom}%
        </span>
        <ToolButton
          icon={ZoomIn}
          label="Acercar"
          onClick={() => controllerRef.current?.zoomIn()}
        />
        <ToolButton
          icon={Scan}
          label="Ajustar"
          onClick={() => controllerRef.current?.resetView()}
          title="Encuadrar la zona entera en la pantalla"
        />

        <LiveIndicator status={realtime.status} error={realtime.joinError} />
      </div>

      {/* Otro dispositivo cambió la estructura que se ve aquí */}
      {staleFromElsewhere ? (
        <Notice tone="info" icon={RefreshCw}>
          <span className="flex-1">
            {structureChanged
              ? "La estructura de este restaurante se reemplazó desde otro dispositivo."
              : "Otro dispositivo guardó cambios en esta zona."}{" "}
            {dirty
              ? "Si recargas perderás lo que no has guardado; si guardas, sobrescribirás sus cambios."
              : "Recarga para verlos."}
          </span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="h-10 rounded-lg border border-sky-300 bg-white px-3 font-medium hover:bg-sky-100"
          >
            Recargar
          </button>
        </Notice>
      ) : null}

      {/* Aviso de cambios sin guardar / resultado del guardado */}
      {feedback.kind === "error" ? (
        <Notice tone="error" icon={CircleAlert}>
          {feedback.text}
        </Notice>
      ) : feedback.kind === "saved" ? (
        <Notice tone="success" icon={CircleCheck}>
          {feedback.text}
        </Notice>
      ) : dirty ? (
        <Notice tone="warning" icon={CircleAlert}>
          Tienes cambios sin guardar.
        </Notice>
      ) : null}

      {/* Paleta + mapa */}
      <div className="flex min-h-0 flex-1">
        <aside className="w-60 shrink-0 overflow-y-auto border-r border-neutral-200 bg-neutral-50 p-3">
          <ElementPalette types={types} onAddClick={addAtCenter} />
        </aside>

        <div
          className="relative min-w-0 flex-1"
          onDragOver={(e) => e.preventDefault()}
          onDrop={handleDrop}
        >
          <KonvaCanvas
            layoutId={layoutId}
            width={width}
            height={height}
            viewRotation={viewRotation}
            elements={elements}
            pulses={pulses}
            now={now}
            typesById={typesById}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onEditStart={() => recordEdit()}
            onMove={(id, x, y) => {
              patchElement(id, { x: Math.round(x), y: Math.round(y) });
              setDirty(true);
            }}
            onResize={(id, box) => {
              patchElement(id, box);
            }}
            onChange={markDirty}
            onZoomChange={setZoom}
            controllerRef={controllerRef}
          />

          {/* Panel del elemento elegido, flotando sobre el mapa */}
          {selected ? (
            <div className="absolute left-3 top-3 flex flex-wrap items-end gap-2 rounded-2xl bg-white/95 p-3 shadow-lg ring-1 ring-black/5">
              <label className="flex flex-col text-[11px] font-medium text-neutral-500">
                Nombre
                <input
                  type="text"
                  value={selected.label}
                  maxLength={60}
                  onChange={(e) => {
                    recordEdit(`label:${selected.id}`);
                    patchElement(selected.id, { label: e.target.value });
                    markDirty();
                  }}
                  className="mt-0.5 h-11 w-32 rounded-xl border border-neutral-300 px-3 text-sm font-normal text-neutral-800"
                  aria-label="Nombre del elemento"
                />
              </label>
              <label className="flex flex-col text-[11px] font-medium text-neutral-500">
                Puestos
                <input
                  type="number"
                  value={selected.capacity ?? ""}
                  min={1}
                  max={100}
                  placeholder="—"
                  onChange={(e) => {
                    const raw = e.target.value;
                    recordEdit(`capacity:${selected.id}`);
                    patchElement(selected.id, {
                      capacity: raw === "" ? null : Math.max(1, Number(raw)),
                    });
                    markDirty();
                  }}
                  className="mt-0.5 h-11 w-20 rounded-xl border border-neutral-300 px-3 text-sm font-normal text-neutral-800"
                  aria-label="Puestos"
                />
              </label>
              <ToolButton
                icon={RotateCcw}
                label="Girar ↺"
                onClick={() => rotateSelected(-ELEMENT_STEP)}
                title={`Girar el elemento ${ELEMENT_STEP}° a la izquierda`}
              />
              <ToolButton
                icon={RotateCw}
                label="Girar ↻"
                onClick={() => rotateSelected(ELEMENT_STEP)}
                title={`Girar el elemento ${ELEMENT_STEP}° a la derecha`}
              />
              <ToolButton
                icon={Trash2}
                label="Eliminar"
                onClick={() => removeElement(selected.id)}
                danger
              />
            </div>
          ) : null}

          <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-white/90 px-2.5 py-1.5 text-xs text-neutral-500 shadow-sm ring-1 ring-black/5">
            {layoutName} · {width}×{height} · v{savedVersion} · {elements.length}{" "}
            elemento(s)
            {viewRotation !== 0 ? ` · vista girada ${viewRotation}°` : ""}
          </div>
        </div>
      </div>

      {copyOpen ? (
        <CopyLayoutDialog
          sourceRestaurantId={restaurantId}
          sourceZoneName={layoutName}
          sourceZoneCount={layouts.length}
          sourceElementCount={elements.length}
          targets={copyTargets}
          onClose={() => setCopyOpen(false)}
          onCopied={(message) => {
            setCopyOpen(false);
            setFeedback({ kind: "saved", text: message });
          }}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Piezas de la interfaz
// ---------------------------------------------------------------------------

/** Botón de barra: ícono y texto corto debajo, 44 px o más para el dedo. */
function ToolButton({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  title,
  primary = false,
  danger = false,
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  primary?: boolean;
  danger?: boolean;
}) {
  const tone = primary
    ? "bg-neutral-900 text-white hover:bg-neutral-700 disabled:bg-neutral-200 disabled:text-neutral-500"
    : danger
      ? "text-red-700 hover:bg-red-50 disabled:text-neutral-300"
      : "text-neutral-700 hover:bg-neutral-100 disabled:text-neutral-300";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className={`flex h-14 min-w-16 flex-col items-center justify-center gap-0.5 rounded-xl px-2 text-[11px] font-medium transition active:scale-95 disabled:cursor-not-allowed disabled:active:scale-100 ${tone}`}
    >
      <Icon aria-hidden size={22} strokeWidth={ICON_STROKE} />
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
}

function Divider() {
  return <span aria-hidden className="mx-1 h-9 w-px bg-neutral-200" />;
}

function LiveIndicator({
  status,
  error,
}: {
  status: "conectando" | "en-vivo" | "sin-conexion";
  error: string | null;
}) {
  const live = status === "en-vivo";
  const Icon = live ? Radio : WifiOff;
  return (
    <span
      className={`ml-auto flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ${
        live ? "bg-emerald-50 text-emerald-700" : "bg-neutral-100 text-neutral-500"
      }`}
      title={error ?? undefined}
    >
      <Icon aria-hidden size={16} strokeWidth={ICON_STROKE} />
      {live ? "En vivo" : status === "conectando" ? "Conectando…" : "Sin tiempo real"}
    </span>
  );
}

const NOTICE_TONES = {
  info: "bg-sky-50 text-sky-800",
  success: "bg-emerald-50 text-emerald-800",
  warning: "bg-amber-50 text-amber-800",
  error: "bg-red-50 text-red-700",
} as const;

function Notice({
  tone,
  icon: Icon,
  children,
}: {
  tone: keyof typeof NOTICE_TONES;
  icon: LucideIcon;
  children: ReactNode;
}) {
  return (
    <div className={`flex items-center gap-2 px-3 py-2 text-sm ${NOTICE_TONES[tone]}`}>
      <Icon aria-hidden size={18} strokeWidth={ICON_STROKE} className="shrink-0" />
      {children}
    </div>
  );
}
