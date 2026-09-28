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

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useRouter } from "next/navigation";

import type { CanvasHandle } from "./konva-canvas";
import { DND_MIME, ElementPalette } from "./element-palette";
import { CopyLayoutDialog } from "./copy-layout-dialog";
import { nextLabel } from "@/lib/layout/element-style";
import type { ElementTypeInfo, LayoutElement, LayoutSummary } from "@/lib/layout/types";
// La action vive en la ruta (convención de Next para "use server"), y el
// editor la importa por el alias en vez de por una ruta relativa que
// saltaría de `components/` a `app/`.
import {
  saveLayoutStructure,
  type RestaurantOption,
} from "@/app/restaurante/[id]/editor/actions";

// `ssr: false` es imprescindible: ver la cabecera del archivo.
const KonvaCanvas = dynamic(
  () => import("./konva-canvas").then((mod) => mod.KonvaCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-neutral-200 text-sm text-neutral-500">
        Cargando mapa…
      </div>
    ),
  },
);

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
        // Locales, no vienen de la base de datos: el paso 6 los actualizará.
        status: "free",
        currentEntryId: null,
      };

      setElements((prev) => [...prev, element]);
      setSelectedId(id);
      markDirty();
    },
    [elements, markDirty],
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
      setElements((prev) => prev.filter((e) => e.id !== id));
      setSelectedId((current) => (current === id ? null : current));
      markDirty();
    },
    [markDirty],
  );

  // Supr y Retro borran lo seleccionado. Se ignora cuando el foco está en un
  // campo de texto, o el usuario no podría escribir una "b" en un nombre.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (!selectedId) return;
      e.preventDefault();
      removeElement(selectedId);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [removeElement, selectedId]);

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
    <div className="flex h-[70vh] min-h-[480px] flex-col">
      {/* Barra de zonas y herramientas */}
      <div className="flex flex-wrap items-center gap-3 border-b border-neutral-200 bg-white px-3 py-2">
        <label className="flex items-center gap-2 text-sm">
          <span className="text-neutral-500">Zona</span>
          <select
            value={layoutId}
            onChange={(e) => {
              const next = e.target.value;
              if (next === layoutId) return;
              router.push(
                `/restaurante/${restaurantId}/editor?zona=${encodeURIComponent(next)}`,
              );
            }}
            className="rounded-md border border-neutral-300 bg-white px-2 py-1 text-sm text-neutral-800"
          >
            {layouts.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </label>

        <div className="flex items-center gap-1 text-sm">
          <button
            type="button"
            onClick={() => controllerRef.current?.zoomOut()}
            title="Alejar"
            className="rounded-md border border-neutral-300 px-2 py-1 hover:bg-neutral-50"
          >
            −
          </button>
          <span className="w-12 text-center tabular-nums text-neutral-600">
            {zoom}%
          </span>
          <button
            type="button"
            onClick={() => controllerRef.current?.zoomIn()}
            title="Acercar"
            className="rounded-md border border-neutral-300 px-2 py-1 hover:bg-neutral-50"
          >
            +
          </button>
          <button
            type="button"
            onClick={() => controllerRef.current?.resetView()}
            title="Ajustar la zona a la ventana"
            className="ml-1 rounded-md border border-neutral-300 px-2 py-1 hover:bg-neutral-50"
          >
            Ajustar
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {selected ? (
            <div className="flex items-center gap-2 text-sm">
              <input
                type="text"
                value={selected.label}
                maxLength={60}
                onChange={(e) => patchElement(selected.id, { label: e.target.value })}
                className="w-28 rounded-md border border-neutral-300 px-2 py-1 text-sm"
                aria-label="Nombre del elemento"
              />
              <input
                type="number"
                value={selected.capacity ?? ""}
                min={1}
                max={100}
                placeholder="—"
                onChange={(e) => {
                  const raw = e.target.value;
                  patchElement(selected.id, {
                    capacity: raw === "" ? null : Math.max(1, Number(raw)),
                  });
                }}
                className="w-16 rounded-md border border-neutral-300 px-2 py-1 text-sm"
                aria-label="Puestos"
                title="Puestos"
              />
              <button
                type="button"
                onClick={() => removeElement(selected.id)}
                className="rounded-md border border-red-300 px-2 py-1 text-sm text-red-700 hover:bg-red-50"
              >
                Eliminar
              </button>
            </div>
          ) : (
            <span className="text-sm text-neutral-400">
              Selecciona un elemento para editarlo
            </span>
          )}

          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !dirty}
            title={dirty ? "Guardar los cambios" : "No hay cambios que guardar"}
            className="rounded-md bg-neutral-900 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-neutral-700 disabled:cursor-not-allowed disabled:bg-neutral-300"
          >
            {saving ? "Guardando…" : dirty ? "Guardar" : "Guardado"}
          </button>

          <button
            type="button"
            onClick={() => setCopyOpen(true)}
            disabled={dirty}
            title={
              dirty
                ? "Guarda los cambios antes de copiar, para no copiar una versión vieja"
                : "Copiar zonas y mesas a otro restaurante"
            }
            className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm font-medium text-neutral-800 transition hover:bg-neutral-50 disabled:cursor-not-allowed disabled:text-neutral-400"
          >
            Copiar estructura…
          </button>
        </div>
      </div>

      {/* Aviso de cambios sin guardar / resultado del guardado */}
      {dirty || feedback.kind !== "idle" ? (
        <div
          className={
            feedback.kind === "error"
              ? "bg-red-50 px-3 py-1.5 text-sm text-red-700"
              : feedback.kind === "saved"
                ? "bg-emerald-50 px-3 py-1.5 text-sm text-emerald-700"
                : "bg-amber-50 px-3 py-1.5 text-sm text-amber-800"
          }
        >
          {feedback.kind === "error" || feedback.kind === "saved"
            ? feedback.text
            : "Tienes cambios sin guardar."}
        </div>
      ) : null}

      {/* Paleta + mapa */}
      <div className="flex min-h-0 flex-1">
        <aside className="w-52 shrink-0 overflow-y-auto border-r border-neutral-200 bg-white p-3">
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
            elements={elements}
            typesById={typesById}
            selectedId={selectedId}
            onSelect={setSelectedId}
            onMove={(id, x, y) => {
              patchElement(id, { x: Math.round(x), y: Math.round(y) });
              setDirty(true);
            }}
            onResize={(id, w, h) => {
              patchElement(id, { width: w, height: h });
            }}
            onChange={markDirty}
            onZoomChange={setZoom}
            controllerRef={controllerRef}
          />

          <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-white/80 px-2 py-1 text-xs text-neutral-500">
            {layoutName} · {width}×{height} · v{version} ·{" "}
            {elements.length} elemento(s)
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
