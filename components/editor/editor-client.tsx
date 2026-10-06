"use client";

// El editor de mesas: el plano y UNA ventana de control (lateral en tablet
// horizontal y computadora; barra abajo y panel que sube en celular y tablet
// vertical). Ver «Piezas del panel de control» abajo.
//
// Konva se carga con el `dynamic({ ssr: false })` de `lazy-konva-canvas.tsx`,
// que es el único sitio que lo decide (ver allí por qué). La page es un
// Server Component y no puede hacerlo ella.
//
// Dos detalles que parecen arbitrarios y no lo son:
//
//  - La zona activa viaja en la URL (`?zona=`), no en el estado. Así el
//    botón "atrás" del navegador funciona y recargar no pierde el sitio. La
//    page monta este componente con `key={layout.id}`, así que cambiar de zona
//    lo remonta y el estado local empieza limpio, sin efectos ni cascadas.
//  - El handle del canvas se pasa por prop en vez de por `ref`, para no
//    depender de que `next/dynamic` reenvíe los refs.
//  - Copiar y pegar (Ctrl+C / Ctrl+V, o «Duplicar») usa un portapapeles del
//    módulo, no del componente: sobrevive al cambio de zona (que remonta el
//    editor), así que una mesa se puede copiar de la terraza al comedor.
//  - Zonas de meseros: el selector «Meseros activos» y «Ver meseros» tiñen
//    las mesas como en el plano en vivo. El reparto se edita en el plano en
//    vivo, que no deja mover nada (aquí un toque mueve la mesa).
//
// Pensado para tablet: todos los botones miden al menos 44 px y llevan ícono y
// texto, porque en una pantalla táctil no hay "hover" que explique un ícono.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import {
  Check,
  ChevronDown,
  CircleAlert,
  CircleCheck,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Eye,
  EyeOff,
  MoreHorizontal,
  Paintbrush,
  Plus,
  Radio,
  RefreshCw,
  Redo2,
  RotateCcw,
  RotateCw,
  Save,
  Scan,
  Star,
  Trash2,
  Undo2,
  WifiOff,
  ZoomIn,
  ZoomOut,
} from "lucide-react";

import type { CanvasHandle } from "./konva-canvas";
import { CopyLayoutDialog } from "./copy-layout-dialog";
import { KonvaCanvas } from "./lazy-konva-canvas";
import { ICON_STROKE, typeIcon } from "./icons";
import { useRestaurantSocket } from "@/components/realtime/use-restaurant-socket";
import { WaiterSelector, useWaiterZones } from "@/components/waiters/waiter-zones";
import { setDefaultLayoutAction } from "@/app/restaurante/[id]/editor/actions";
import { isSeatableElement } from "@/lib/db/enums";
import type { WaiterConfig } from "@/lib/waiters/configs";
import { type LayoutRotation, type TableStatus, asLayoutRotation } from "@/lib/db/enums";
import { pastedCopy } from "@/lib/layout/clipboard";
import { clampToZone, placeInView } from "@/lib/layout/placement";
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

/**
 * Clave del arrastre desde la paleta al plano (computadora). En una tablet
 * el arrastre HTML5 no existe: allí se toca el botón y el elemento aparece en
 * el centro de lo que se ve.
 */
const DND_MIME = "application/x-mesasgc-element-type";

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
  /** Giro guardado del plano completo (`table_layouts.rotation`). */
  rotation: LayoutRotation;
  elements: LayoutElement[];
  types: ElementTypeInfo[];
  layouts: LayoutSummary[];
  /** A quién se le puede copiar la estructura. Lo carga la page. */
  copyTargets: RestaurantOption[];
  waiterConfigs: WaiterConfig[];
  /** `meseros:gestionar`: puede cambiar la configuración activa. */
  canManageWaiters: boolean;
};

/** Portapapeles del editor (ver cabecera): el último elemento copiado. */
let clipboard: LayoutElement | null = null;

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
  rotation,
  elements: initialElements,
  types,
  layouts,
  copyTargets,
  waiterConfigs,
  canManageWaiters,
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
  // Giro del plano completo, en pasos de 90°. Es un cambio más de la zona:
  // marca "sin guardar" y se guarda con el botón Guardar
  // (`table_layouts.rotation`). Deshacer no lo toca: es de la vista entera,
  // no de un elemento, y se vuelve atrás con el botón contrario.
  const [viewRotation, setViewRotation] = useState<LayoutRotation>(rotation);
  const savedRotationRef = useRef<LayoutRotation>(rotation);
  // Versión de la zona que tiene este editor, y la última que otro
  // dispositivo anunció. Si la de fuera es mayor, lo de la pantalla es viejo.
  const [savedVersion, setSavedVersion] = useState(version);
  const [remoteVersion, setRemoteVersion] = useState(version);
  const [structureChanged, setStructureChanged] = useState(false);

  // Panel que sube desde abajo en celular y tablet en vertical: cerrado,
  // «añadir» (la paleta) o «herramientas». Solo se abre al tocar su botón.
  const [sheet, setSheet] = useState<null | "añadir" | "herramientas">(null);

  // --- Deshacer ------------------------------------------------------------
  //
  // Una pila de fotos de `elements` tomadas JUSTO ANTES de cada cambio. Es
  // solo del editor: no toca el guardado, y deshacer deja "cambios sin
  // guardar" como cualquier otra edición.
  const [history, setHistory] = useState<LayoutElement[][]>([]);
  // Lo que se puede volver a hacer: lo que se deshizo. Editar de nuevo la deja
  // vacía, como en cualquier programa.
  const [future, setFuture] = useState<LayoutElement[][]>([]);
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
    setFuture([]);
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

  // Deshacer necesita saber el giro actual sin recrearse en cada giro.
  const viewRotationRef = useRef(viewRotation);
  useEffect(() => {
    viewRotationRef.current = viewRotation;
  }, [viewRotation]);

  /** Gira el plano completo un cuarto de vuelta. Se guarda con Guardar. */
  const rotateLayout = useCallback(
    (delta: number) => {
      const next = asLayoutRotation(normalizeAngle(viewRotationRef.current + delta));
      setViewRotation(next);
      if (next !== savedRotationRef.current) markDirty();
      else setDirty(structureKey(elementsRef.current) !== savedKeyRef.current);
    },
    [markDirty],
  );

  const patchElement = useCallback(
    (id: string, patch: Partial<LayoutElement>) => {
      setElements((prev) =>
        prev.map((e) => (e.id === id ? { ...e, ...patch } : e)),
      );
    },
    [],
  );

  // Volver a una foto anterior conserva de la de pantalla lo que no es una
  // edición suya: la ocupación (lo que pasa en el local AHORA). Lo comparten
  // Deshacer y Rehacer, por eso está fuera de los dos.
  const restore = useCallback((snapshot: LayoutElement[]) => {
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
    setDirty(
      structureKey(restored) !== savedKeyRef.current ||
        viewRotationRef.current !== savedRotationRef.current,
    );
    setFeedback({ kind: "idle" });
  }, []);

  const undo = useCallback(() => {
    if (history.length === 0) return;
    const snapshot = history[history.length - 1];
    setHistory(history.slice(0, -1));
    // Lo que hay ahora es justo lo que se podría rehacer después.
    setFuture((prev) => [...prev, elementsRef.current].slice(-HISTORY_LIMIT));
    lastEditKeyRef.current = null;
    restore(snapshot);
  }, [history, restore]);

  const redo = useCallback(() => {
    if (future.length === 0) return;
    const snapshot = future[future.length - 1];
    setFuture(future.slice(0, -1));
    setHistory((prev) => [...prev, elementsRef.current].slice(-HISTORY_LIMIT));
    lastEditKeyRef.current = null;
    restore(snapshot);
  }, [future, restore]);

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
    // Otra tablet cambió las zonas de meseros: se vuelven a pedir (la page
    // las relee). No toca los elementos que se están editando.
    "waiters:changed": () => router.refresh(),
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

  /**
   * Añade un elemento DENTRO de lo que se ve: en el centro de la pantalla
   * (con el zoom y el desplazamiento de ahora) o, si ahí ya hay algo, en el
   * hueco libre más cercano (`placeInView`). Queda seleccionado. Cierra el
   * panel de abajo: lo siguiente es mirar o mover la mesa nueva.
   */
  const addAtCenter = useCallback(
    (type: ElementTypeInfo) => {
      const zone = { width, height };
      const center = controllerRef.current?.viewportCenter() ?? { x: width / 2, y: height / 2 };
      const visible = controllerRef.current?.visibleBox() ?? { left: 0, top: 0, right: width, bottom: height };
      const spot = placeInView({ width: type.width, height: type.height, rotation: 0 }, center, visible, zone, elementsRef.current);
      addElement(type, spot.x + type.width / 2, spot.y + type.height / 2);
      setSheet(null);
    },
    [addElement, height, width],
  );

  /**
   * Pega una copia de un elemento: id nuevo, nombre siguiente de su tipo y
   * un poco desplazada (respecto a `anchor`, o al original) para que se vea
   * que hay dos. Copia lo visual (tipo, tamaño, giro, puestos) y NADA de lo
   * que es del local ahora: nace libre, sin cliente ni reserva. Entra en
   * Deshacer y Rehacer como cualquier otra edición, y se guarda con Guardar.
   */
  const pasteElement = useCallback(
    (source: LayoutElement, anchor: LayoutElement = source) => {
      const type = typesById.get(source.elementTypeId);
      if (!type) return;
      const id = crypto.randomUUID();
      const copy = pastedCopy(source, {
        id,
        typeKey: type.key,
        labelsOfType: elements.filter((e) => e.elementTypeId === type.id).map((e) => e.label),
        anchor,
        zoneWidth: width,
        zoneHeight: height,
      });
      // Junto al original, pero dentro de lo que se ve y sin pisar otra mesa.
      const visible = controllerRef.current?.visibleBox() ?? { left: 0, top: 0, right: width, bottom: height };
      const spot = placeInView(copy, { x: copy.x + copy.width / 2, y: copy.y + copy.height / 2 }, visible, { width, height }, elements);
      const element = { ...copy, ...spot };
      recordEdit();
      setElements((prev) => [...prev, element]);
      setSelectedId(id);
      markDirty();
    },
    [elements, height, markDirty, recordEdit, typesById, width],
  );

  const [canPaste, setCanPaste] = useState(() => clipboard !== null);
  const copySelected = useCallback((element: LayoutElement) => {
    clipboard = element;
    setCanPaste(true);
  }, []);

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
      const rotation = normalizeAngle(selected.rotation + delta);
      // Girada puede ocupar más (una mesa larga de lado): se mete en la zona.
      patchElement(selected.id, { rotation, ...clampToZone({ ...selected, rotation }, { width, height }) });
      markDirty();
    },
    [height, markDirty, patchElement, recordEdit, selected, width],
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
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        // Ctrl+Z deshace; Ctrl+Shift+Z (o Ctrl+Y) rehace.
        if (e.shiftKey) redo();
        else undo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
        const current = elements.find((el) => el.id === selectedId);
        if (current) {
          e.preventDefault();
          copySelected(current);
        }
        return;
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
        if (clipboard) {
          e.preventDefault();
          pasteElement(clipboard);
        }
        return;
      }
      if (e.key !== "Delete" && e.key !== "Backspace") return;
      if (!selectedId) return;
      e.preventDefault();
      removeElement(selectedId);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [copySelected, elements, pasteElement, redo, removeElement, selectedId, undo]);

  // --- Plano por defecto --------------------------------------------------
  const [defaultId, setDefaultId] = useState(() => layouts.find((l) => l.isDefault)?.id ?? null);
  const [settingDefault, setSettingDefault] = useState(false);
  const makeDefault = useCallback(async () => {
    setSettingDefault(true);
    const result = await setDefaultLayoutAction({ restaurantId, layoutId });
    setSettingDefault(false);
    if (result.ok) {
      setDefaultId(layoutId);
      setFeedback({ kind: "saved", text: result.message ?? "Plano por defecto actualizado." });
    } else {
      setFeedback({ kind: "error", text: result.error });
    }
  }, [layoutId, restaurantId]);

  // --- Zonas de meseros (solo verlas y cambiar la activa) ----------------
  const [showWaiters, setShowWaiters] = useState(false);
  const seatableHere = useMemo(
    () =>
      elements
        .filter((e) => isSeatableElement(typesById.get(e.elementTypeId)?.key ?? ""))
        .map((e) => ({ id: e.id, layoutId, x: e.x, y: e.y })),
    [elements, layoutId, typesById],
  );
  const waiters = useWaiterZones({
    restaurantId,
    configs: waiterConfigs,
    canManage: canManageWaiters,
    tables: seatableHere,
    layoutOrder: [layoutId],
  });
  // Mesero del elemento elegido en la configuración activa (si es una mesa).
  const selectedSeatable = selected ? isSeatableElement(typesById.get(selected.elementTypeId)?.key ?? "") : false;
  const selectedWaiter = selected && waiters.active ? (waiters.marks[selected.id] ?? null) : null;

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

      const inside = clampToZone(
        { x: point.x - type.width / 2, y: point.y - type.height / 2, width: type.width, height: type.height, rotation: 0 },
        { width, height },
      );
      addElement(type, inside.x + type.width / 2, inside.y + type.height / 2);
    },
    [addElement, height, typesById, width],
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
      rotation: viewRotation,
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
      savedRotationRef.current = viewRotation;
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
  }, [elements, height, layoutId, restaurantId, viewRotation, width]);

  // Al escribir en el nombre o los puestos, el teclado del celular sube: la
  // mesa que se edita se mueve a la vista si quedara tapada.
  const revealSelected = useCallback(() => {
    const id = selectedId;
    if (!id) return;
    window.setTimeout(() => controllerRef.current?.revealElement(id), 350);
  }, [selectedId]);

  // --- Piezas del panel de control ------------------------------------------
  //
  // UNA sola ventana de control, que cambia de sitio según la pantalla:
  //
  //  - tablet en horizontal y computadora (`lg`, 1024 px o más): un panel
  //    lateral angosto con scroll propio; el lienzo se achica para dejarle
  //    sitio y nada lo tapa;
  //  - celular y tablet en vertical: una barra compacta abajo (Añadir,
  //    Deshacer, Rehacer, Guardar, Girar, Más), la tira del elemento
  //    seleccionado justo encima, y un panel que sube desde abajo (como mucho
  //    el 40 % del alto) con lo demás. Ese panel solo se abre al tocar
  //    «Añadir» o «Más», se baja arrastrándolo y se cierra solo al añadir.
  //
  // Las piezas se escriben una vez y se usan en los dos sitios.

  const zoneSelect = (
    <label className="flex min-w-0 flex-1 items-center">
      <span className="sr-only">Zona</span>
      <select
        value={layoutId}
        onChange={(e) => {
          const next = e.target.value;
          if (next === layoutId) return;
          router.push(`/restaurante/${restaurantId}/editor?zona=${encodeURIComponent(next)}`);
        }}
        className="h-11 w-full min-w-0 rounded-xl border border-app-border bg-panel px-3 text-sm text-panel-text"
      >
        {layouts.map((l) => (
          <option key={l.id} value={l.id}>
            {l.name}
            {l.id === defaultId ? " (por defecto)" : ""}
          </option>
        ))}
      </select>
    </label>
  );

  const defaultControl =
    defaultId === layoutId ? (
      <span className="flex h-11 shrink-0 items-center gap-1 rounded-xl px-2 text-xs font-semibold text-accent" title="Se abre al entrar en el editor y en el plano en vivo">
        <Star aria-hidden size={16} strokeWidth={2} fill="currentColor" />
        Por defecto
      </span>
    ) : (
      <ToolButton
        icon={Star}
        label={settingDefault ? "Marcando…" : "Marcar por defecto"}
        onClick={makeDefault}
        disabled={settingDefault}
        title="Abrir esta zona al entrar en el editor y en el plano en vivo"
      />
    );

  const saveButton = (
    <ToolButton
      icon={Save}
      label={saving ? "Guardando…" : dirty ? "Guardar" : "Guardado"}
      onClick={handleSave}
      disabled={saving || !dirty}
      title={dirty ? "Guardar los cambios" : "No hay cambios que guardar"}
      primary
    />
  );
  const undoButton = (
    <ToolButton icon={Undo2} label="Deshacer" onClick={undo} disabled={history.length === 0} title="Deshacer el último cambio (Ctrl+Z)" />
  );
  const redoButton = (
    <ToolButton icon={Redo2} label="Rehacer" onClick={redo} disabled={future.length === 0} title="Rehacer lo deshecho (Ctrl+Shift+Z o Ctrl+Y)" />
  );

  // Añadir: tocar un tipo lo pone en el centro de lo que se ve (en un hueco
  // libre); en computadora también se puede arrastrar al plano.
  const palette = (
    <div className="grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-1.5" role="group" aria-label="Añadir elemento">
      {types.map((type) => {
        const TypeIcon = typeIcon(type.key).component;
        return (
          <button
            key={type.id}
            type="button"
            draggable
            onDragStart={(e) => {
              e.dataTransfer.setData(DND_MIME, type.id);
              e.dataTransfer.setData("text/plain", type.label);
              e.dataTransfer.effectAllowed = "copy";
            }}
            onClick={() => addAtCenter(type)}
            className="flex min-h-14 flex-col items-center justify-center gap-0.5 rounded-xl border border-app-border px-1.5 py-1 text-[11px] font-medium leading-tight text-panel-text hover:bg-app-border/60 active:scale-[0.97]"
            title={`Añadir ${type.label}`}
          >
            <TypeIcon aria-hidden size={20} strokeWidth={ICON_STROKE} style={{ color: type.color }} />
            <span className="text-center">{type.label}</span>
          </button>
        );
      })}
    </div>
  );

  const planTools = (
    <div className="flex flex-wrap items-center gap-1">
      <ToolButton icon={RotateCcw} label="Girar plano ↺" onClick={() => rotateLayout(-VIEW_STEP)} title="Girar el plano completo 90° a la izquierda (se guarda con Guardar)" />
      <ToolButton icon={RotateCw} label="Girar plano ↻" onClick={() => rotateLayout(VIEW_STEP)} title="Girar el plano completo 90° a la derecha (se guarda con Guardar)" />
      <ToolButton
        icon={Copy}
        label="Copiar plano"
        onClick={() => setCopyOpen(true)}
        disabled={dirty}
        title={dirty ? "Guarda los cambios antes de copiar, para no copiar una versión vieja" : "Copiar zonas y mesas a otro restaurante"}
      />
      <ToolButton
        icon={ClipboardPaste}
        label="Pegar elemento"
        onClick={() => clipboard && pasteElement(clipboard)}
        disabled={!canPaste}
        title={canPaste ? "Pegar el elemento copiado (Ctrl+V); también en otra zona" : "Copia antes un elemento (Ctrl+C)"}
      />
      <ToolButton icon={ZoomOut} label="Alejar" onClick={() => controllerRef.current?.zoomOut()} />
      <span className="w-12 text-center text-sm tabular-nums text-panel-muted">{zoom}%</span>
      <ToolButton icon={ZoomIn} label="Acercar" onClick={() => controllerRef.current?.zoomIn()} />
      <ToolButton icon={Scan} label="Ajustar" onClick={() => controllerRef.current?.resetView()} title="Encuadrar las mesas en la pantalla" />
      <LiveIndicator status={realtime.status} error={realtime.joinError} />
    </div>
  );

  const waiterTools = (
    <div className="flex flex-wrap items-center gap-1.5">
      <WaiterSelector state={waiters} />
      {waiters.configs.length > 0 ? (
        <ToolButton
          icon={showWaiters ? EyeOff : Eye}
          label={showWaiters ? "Ocultar meseros" : "Ver meseros"}
          onClick={() => setShowWaiters((v) => !v)}
          title="Teñir cada mesa con el color de su mesero"
        />
      ) : null}
      {canManageWaiters ? (
        <a
          href={`/restaurante/${restaurantId}/mapa?meseros=editar`}
          className="flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-panel-text hover:bg-app-border/60"
        >
          <Paintbrush aria-hidden size={16} strokeWidth={2} />
          Repartir meseros
        </a>
      ) : null}
      {waiters.message ? <span role="status" className="text-sm text-panel-muted">{waiters.message.text}</span> : null}
    </div>
  );

  // Lo del elemento elegido. En el panel lateral, en filas; en la tira de
  // abajo (celular), en una sola fila que se desplaza de lado.
  const selectionControls = (variant: "panel" | "tira") =>
    selected ? (
      <>
        {variant === "panel" ? (
          <p className="flex w-full items-center justify-between gap-2 text-xs font-semibold text-panel-muted">
            <span className="min-w-0 truncate">
              Elemento seleccionado: <span className="font-bold text-panel-text">{selected.label}</span>
            </span>
            <DoneButton onClick={() => setSelectedId(null)} />
          </p>
        ) : null}
        <label className="flex shrink-0 flex-col text-[11px] font-medium text-panel-muted">
          Nombre
          <input
            type="text"
            value={selected.label}
            maxLength={60}
            onFocus={revealSelected}
            onChange={(e) => {
              recordEdit(`label:${selected.id}`);
              patchElement(selected.id, { label: e.target.value });
              markDirty();
            }}
            className={`mt-0.5 h-11 rounded-xl border border-app-border bg-panel px-2 text-sm font-normal text-panel-text ${variant === "panel" ? "w-40" : "w-28"}`}
            aria-label="Nombre del elemento"
          />
        </label>
        <label className="flex shrink-0 flex-col text-[11px] font-medium text-panel-muted">
          Puestos
          <input
            type="number"
            inputMode="numeric"
            value={selected.capacity ?? ""}
            min={1}
            max={100}
            placeholder="—"
            onFocus={revealSelected}
            onChange={(e) => {
              const raw = e.target.value;
              recordEdit(`capacity:${selected.id}`);
              patchElement(selected.id, { capacity: raw === "" ? null : Math.max(1, Number(raw)) });
              markDirty();
            }}
            className="mt-0.5 h-11 w-16 rounded-xl border border-app-border bg-panel px-2 text-sm font-normal text-panel-text"
            aria-label="Puestos"
          />
        </label>
        {selectedSeatable && waiters.active ? (
          <span className="flex h-11 shrink-0 items-center gap-1.5 self-end rounded-xl px-1 text-xs font-medium text-panel-text" title={`Configuración activa: ${waiters.active.name}`}>
            Mesero:
            {selectedWaiter ? (
              <>
                <span aria-hidden className="h-3 w-3 rounded-full" style={{ backgroundColor: selectedWaiter.color }} />
                <span className="font-bold">{selectedWaiter.label}</span>
              </>
            ) : (
              <span className="text-panel-muted">sin mesero</span>
            )}
          </span>
        ) : null}
        <div className={`flex items-center gap-1 ${variant === "panel" ? "w-full flex-wrap" : "shrink-0"}`}>
          <ToolButton icon={RotateCcw} label="Girar ↺" onClick={() => rotateSelected(-ELEMENT_STEP)} title={`Girar el elemento ${ELEMENT_STEP}° a la izquierda`} />
          <ToolButton icon={RotateCw} label="Girar ↻" onClick={() => rotateSelected(ELEMENT_STEP)} title={`Girar el elemento ${ELEMENT_STEP}° a la derecha`} />
          <ToolButton icon={Copy} label="Copiar" onClick={() => copySelected(selected)} title="Copiar este elemento (Ctrl+C). Se puede pegar en otra zona." />
          <ToolButton
            icon={ClipboardPaste}
            label="Pegar"
            onClick={() => clipboard && pasteElement(clipboard, selected)}
            disabled={!canPaste}
            title={canPaste ? "Pegar lo copiado junto a este elemento (Ctrl+V)" : "Copia antes un elemento"}
          />
          <ToolButton icon={CopyPlus} label="Duplicar" onClick={() => pasteElement(selected)} title="Crear una copia al lado" />
          <ToolButton icon={Trash2} label="Eliminar" onClick={() => removeElement(selected.id)} danger />
          {variant === "tira" ? <DoneButton onClick={() => setSelectedId(null)} /> : null}
        </div>
      </>
    ) : null;

  // Avisos: dentro de la ventana de control, nunca sueltos sobre el plano.
  const notices = (
    <>
      {staleFromElsewhere ? (
        <Notice tone="info" icon={RefreshCw}>
          <span className="flex-1">
            {structureChanged
              ? "La estructura de este restaurante se reemplazó desde otro dispositivo."
              : "Otro dispositivo guardó cambios en esta zona."}{" "}
            {dirty ? "Si recargas perderás lo que no has guardado; si guardas, sobrescribirás sus cambios." : "Recarga para verlos."}
          </span>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="min-h-11 rounded-lg bg-accent px-3 font-medium text-accent-text hover:bg-accent/85"
          >
            Recargar
          </button>
        </Notice>
      ) : null}
      {feedback.kind === "error" ? (
        <Notice tone="error" icon={CircleAlert}>{feedback.text}</Notice>
      ) : feedback.kind === "saved" ? (
        <Notice tone="success" icon={CircleCheck}>{feedback.text}</Notice>
      ) : dirty ? (
        <Notice tone="warning" icon={CircleAlert}>Tienes cambios sin guardar.</Notice>
      ) : null}
    </>
  );

  return (
    <div className="flex h-[78dvh] min-h-[380px] flex-col overflow-hidden rounded-2xl border border-app-border bg-panel text-panel-text shadow-sm movil-horizontal:h-[100dvh] movil-horizontal:min-h-[320px] lg:h-[calc(100dvh-9rem)] lg:min-h-[560px] lg:flex-row">
      {/* El plano */}
      <div className="relative min-h-0 min-w-0 flex-1" onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
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
            patchElement(id, { x, y });
            setDirty(true);
          }}
          onResize={(id, box) => {
            const element = elementsRef.current.find((e) => e.id === id);
            const inside = element ? clampToZone({ ...element, ...box }, { width, height }) : { x: box.x, y: box.y };
            patchElement(id, { ...box, ...inside });
          }}
          onChange={markDirty}
          onZoomChange={setZoom}
          controllerRef={controllerRef}
          waiterMarks={showWaiters ? waiters.marks : undefined}
        />

        {/* Datos de la zona, abajo en el centro. */}
        <div className="pointer-events-none absolute bottom-3 left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-2xl bg-panel/95 px-3 py-1.5 text-xs text-panel-muted shadow-lg ring-1 ring-app-border md:block">
          {layoutName} · {width}×{height} · v{savedVersion} · {elements.length} elemento(s)
          {viewRotation !== 0 ? ` · plano girado ${viewRotation}°` : ""}
        </div>

        {/* Celular y tablet en vertical: el panel que sube desde abajo. */}
        {sheet ? (
          <BottomSheet title={sheet === "añadir" ? "Añadir elemento" : "Herramientas"} onClose={() => setSheet(null)}>
            {sheet === "añadir" ? (
              palette
            ) : (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-1.5">
                  {zoneSelect}
                  {defaultControl}
                </div>
                {notices}
                {planTools}
                {waiterTools}
              </div>
            )}
          </BottomSheet>
        ) : null}
      </div>

      {/* Tablet en horizontal y computadora: el panel a un lado. */}
      <aside aria-label="Panel de control del editor" className="hidden w-80 shrink-0 flex-col border-l border-app-border bg-panel lg:flex">
        <div className="flex flex-col gap-2 border-b border-app-border p-3">
          <div className="flex items-center gap-1.5">
            {zoneSelect}
            {defaultControl}
          </div>
          <div className="flex items-center gap-1">
            {saveButton}
            {undoButton}
            {redoButton}
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3">
          {notices}
          {selected ? (
            <section aria-label="Elemento seleccionado" className="flex flex-wrap items-end gap-2 rounded-2xl bg-app-border/30 p-2.5">
              {selectionControls("panel")}
            </section>
          ) : null}
          <PanelSection title="Añadir">{palette}</PanelSection>
          <PanelSection title="Plano">{planTools}</PanelSection>
          <PanelSection title="Meseros">{waiterTools}</PanelSection>
        </div>
      </aside>

      {/* Celular y tablet en vertical: la barra de abajo. */}
      <div className="shrink-0 border-t border-app-border bg-panel lg:hidden">
        {feedback.kind === "error" || staleFromElsewhere ? <div className="px-2 pt-2">{notices}</div> : null}
        {/* La tira del elemento ocupa SIEMPRE el mismo alto (con una pista si
            no hay nada elegido): si apareciera y desapareciera, el plano
            cambiaría de tamaño y se volvería a dibujar entero en cada toque. */}
        <section aria-label="Elemento seleccionado" className="flex h-[4.25rem] items-end gap-2 overflow-x-auto border-b border-app-border px-2 py-1.5">
          {selected ? (
            selectionControls("tira")
          ) : (
            <p className="self-center px-1 text-xs text-panel-muted">Toca una mesa para editarla, o «Añadir» para poner una nueva.</p>
          )}
        </section>
        <nav aria-label="Herramientas principales" className="grid grid-cols-6 gap-1 p-1">
          <ToolButton icon={Plus} label="Añadir" onClick={() => setSheet((s) => (s === "añadir" ? null : "añadir"))} />
          {undoButton}
          {redoButton}
          {saveButton}
          <ToolButton
            icon={RotateCw}
            label={selected ? "Girar mesa" : "Girar plano"}
            onClick={() => (selected ? rotateSelected(ELEMENT_STEP) : rotateLayout(VIEW_STEP))}
            title={selected ? `Girar el elemento ${ELEMENT_STEP}°` : "Girar el plano completo 90°"}
          />
          <ToolButton icon={MoreHorizontal} label="Más" onClick={() => setSheet((s) => (s === "herramientas" ? null : "herramientas"))} title="Zona, plano, zoom y meseros" />
        </nav>
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
//
// Todas con los colores del tema (`bg-panel`, `text-accent`...), que salen de
// `lib/theme/theme.ts`: no hay colores sueltos en este archivo.
// ---------------------------------------------------------------------------

function PanelSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="flex flex-col gap-1.5">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-panel-muted">{title}</h3>
      {children}
    </section>
  );
}

function DoneButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex min-h-11 min-w-11 shrink-0 items-center justify-center gap-1 rounded-xl px-2 text-xs font-semibold text-panel-text hover:bg-app-border/60"
      title="Quitar la selección"
    >
      <Check aria-hidden size={16} strokeWidth={2.5} />
      Listo
    </button>
  );
}

/**
 * Panel que sube desde abajo (celular y tablet en vertical): como mucho el
 * 40 % del alto del plano, con scroll propio, y se cierra bajándolo con el
 * dedo (o con el botón, o con Esc). Va dentro del recuadro del plano, así que
 * nunca tapa la barra de abajo.
 */
function BottomSheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const [drag, setDrag] = useState(0);
  const start = useRef<number | null>(null);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-label={title}
      className="absolute inset-x-0 bottom-0 z-20 flex max-h-[40%] min-h-[9rem] flex-col rounded-t-2xl bg-panel text-panel-text shadow-[0_-8px_24px_rgba(0,0,0,0.18)] ring-1 ring-app-border"
      style={{ transform: drag > 0 ? `translateY(${drag}px)` : undefined }}
    >
      <div
        className="flex shrink-0 touch-none cursor-grab select-none items-center gap-2 px-3 pb-1 pt-2"
        onPointerDown={(e) => {
          start.current = e.clientY;
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          if (start.current !== null) setDrag(Math.max(0, e.clientY - start.current));
        }}
        onPointerUp={() => {
          const moved = drag;
          start.current = null;
          setDrag(0);
          if (moved > 60) onClose();
        }}
        onPointerCancel={() => {
          start.current = null;
          setDrag(0);
        }}
      >
        <span aria-hidden className="absolute left-1/2 top-1.5 h-1.5 w-10 -translate-x-1/2 rounded-full bg-app-border" />
        <h2 className="mt-2 flex-1 text-sm font-semibold">{title}</h2>
        <button
          type="button"
          onClick={onClose}
          className="mt-1 flex min-h-11 min-w-11 items-center justify-center rounded-xl hover:bg-app-border/60"
          aria-label="Cerrar"
        >
          <ChevronDown aria-hidden size={20} strokeWidth={2} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">{children}</div>
    </div>
  );
}

/** Botón de barra: ícono y texto corto debajo, 44 px o más para el dedo. */
function ToolButton({
  icon: Icon,
  label,
  onClick,
  disabled = false,
  title,
  primary = false,
  danger = false,
  className = "",
}: {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  primary?: boolean;
  danger?: boolean;
  className?: string;
}) {
  const tone = primary
    ? "bg-accent text-accent-text hover:bg-accent/85 disabled:bg-app-border/70 disabled:text-panel-muted"
    : danger
      ? "text-estado-ocupada hover:bg-estado-ocupada/10 disabled:text-panel-muted/50"
      : "text-panel-text hover:bg-app-border/60 disabled:text-panel-muted/50";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      className={`flex h-12 min-w-14 flex-col items-center justify-center gap-0.5 rounded-xl px-2 text-[11px] font-medium transition active:scale-95 disabled:cursor-not-allowed disabled:active:scale-100 ${tone} ${className}`}
    >
      <Icon aria-hidden size={20} strokeWidth={ICON_STROKE} />
      <span className="whitespace-nowrap">{label}</span>
    </button>
  );
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
        live ? "bg-estado-libre/15 text-estado-libre" : "bg-app-border/60 text-panel-muted"
      }`}
      title={error ?? undefined}
    >
      <Icon aria-hidden size={16} strokeWidth={ICON_STROKE} />
      {live ? "En vivo" : status === "conectando" ? "Conectando…" : "Sin tiempo real"}
    </span>
  );
}

// El color de cada aviso sale del tema: acento para lo informativo, los
// colores de estado para bien (libre) y mal (ocupada).
const NOTICE_TONES = {
  info: "text-accent",
  success: "text-estado-libre",
  warning: "text-accent",
  error: "text-estado-ocupada",
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
    <div role="status" className="flex max-w-full items-center gap-2 rounded-xl bg-app-border/40 px-3 py-2 text-sm">
      <Icon aria-hidden size={18} strokeWidth={ICON_STROKE} className={`shrink-0 ${NOTICE_TONES[tone]}`} />
      {children}
    </div>
  );
}
