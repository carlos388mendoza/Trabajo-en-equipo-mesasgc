"use client";

// Ventana del modo rápido: panel que sube desde abajo en celular y tablet, y
// ventana centrada en computadora (desde `lg`, 1024 px). La usan el
// formulario de agregar cliente, la confirmación de borrar y «Ver todas las
// cartas».
//
// Se cierra con Esc, tocando fuera o con el botón que ponga quien la usa. Al
// abrir enfoca el primer campo con `data-autofocus` (o el panel) y al cerrar
// devuelve el foco a donde estaba: en una tablet con teclado, Ctrl+Z y las
// flechas siguen funcionando después.
//
// Con `draggable` («Ver todas las cartas») es SIEMPRE un panel desde abajo,
// también en computadora, y no tiene botón de cerrar: se arrastra desde su
// cabecera hacia arriba o hacia abajo y se queda en una de dos alturas fijas
// (alta o media); bajarlo del todo, o lanzarlo hacia abajo, lo cierra. Solo la
// cabecera arrastra (`useSheetDrag`): la lista sigue haciendo scroll y los
// botones siguen siendo botones. Con teclado, la agarradera baja y sube con
// las flechas, y Esc cierra.
//
// Se pinta en un portal sobre `body`: así una ventana abierta desde dentro de
// otra (confirmar un borrado desde «Ver todas las cartas») no queda atrapada
// en el `transform` del panel de debajo.

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useSyncExternalStore,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, animate, motion, useDragControls, useMotionValue, type PanInfo } from "motion/react";

const DESKTOP_QUERY = "(min-width: 1024px)";

function subscribeDesktop(onChange: () => void) {
  const media = window.matchMedia(DESKTOP_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

/** ¿Pantalla de computadora? En el servidor, no: las ventanas solo se abren en el cliente. */
export function useIsDesktop(): boolean {
  return useSyncExternalStore(
    subscribeDesktop,
    () => window.matchMedia(DESKTOP_QUERY).matches,
    () => false,
  );
}

const noop = () => () => {};
/** true solo en el navegador (para el portal; en el servidor no hay `document`). */
function useIsClient(): boolean {
  return useSyncExternalStore(noop, () => true, () => false);
}

/**
 * Alturas fijas del panel arrastrable, como fracción de lo que puede bajar
 * (0 = arriba del todo). Media: se ve casi la mitad de la pantalla.
 */
const SNAP_HIGH = 0;
const SNAP_MID = 0.45;
/** Más abajo de esto al soltar, se cierra. */
const CLOSE_AT = 0.7;
/** Lanzado hacia abajo más rápido que esto (px/s), se cierra aunque esté arriba. */
const CLOSE_VELOCITY = 900;
const SPRING = { type: "spring" as const, stiffness: 420, damping: 40 };

type SheetDrag = {
  /** Para el `onPointerDown` de la zona que arrastra (la cabecera). */
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  /** Para la agarradera: flechas para subir, bajar y cerrar. */
  onHandleKeyDown: (event: ReactKeyboardEvent<HTMLElement>) => void;
};

const SheetDragContext = createContext<SheetDrag | null>(null);

/**
 * La cabecera de un panel `draggable` lo usa para arrastrarlo. Fuera de uno,
 * devuelve null y la cabecera no hace nada especial.
 */
export function useSheetDrag(): SheetDrag | null {
  return useContext(SheetDragContext);
}

type OverlayProps = {
  open: boolean;
  onClose: () => void;
  /** id del título, para `aria-labelledby`. */
  labelledBy: string;
  /** `form`: ventana chica; `list`: más ancha (filas de «Varios»); `wide`: casi toda la pantalla. */
  size?: "form" | "list" | "wide";
  /** Panel desde abajo que se arrastra, sin botón de cerrar (ver arriba). */
  draggable?: boolean;
  children: ReactNode;
};

export function Overlay({ open, onClose, labelledBy, size = "form", draggable = false, children }: OverlayProps) {
  const desktop = useIsDesktop();
  const client = useIsClient();
  const panelRef = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // El efecto corre después de montar el panel: ya se puede enfocar.
    const target = panelRef.current?.querySelector<HTMLElement>("[data-autofocus]") ?? panelRef.current;
    target?.focus({ preventScroll: true });
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      // Con dos ventanas abiertas (confirmar un borrado encima de «Ver todas
      // las cartas»), Esc cierra solo la de arriba: la última que se montó.
      const dialogs = document.querySelectorAll("[data-overlay-panel]");
      if (dialogs.length && dialogs[dialogs.length - 1] !== panelRef.current) return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      document.body.style.overflow = overflow;
      previous?.focus({ preventScroll: true });
    };
  }, [open]);

  const sheet = draggable || !desktop;
  const panelClass = sheet
    ? `absolute inset-x-0 bottom-0 mx-auto flex w-full flex-col rounded-t-[1.75rem] border-t border-app-border bg-panel text-panel-text shadow-2xl ${
        draggable ? "h-[94dvh] max-w-5xl lg:border-x" : size === "wide" ? "h-[92dvh]" : "max-h-[92dvh]"
      }`
    : `relative flex w-full flex-col rounded-3xl border border-app-border bg-panel text-panel-text shadow-2xl ${
        size === "wide" ? "h-[85vh] max-w-5xl" : size === "list" ? "max-h-[85vh] max-w-2xl" : "max-h-[85vh] max-w-lg"
      }`;

  if (!client) return null;

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className={`fixed inset-0 z-50 ${sheet ? "" : "grid place-items-center p-6"}`}>
          <motion.div
            aria-hidden
            className="absolute inset-0 bg-black/45"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          {draggable ? (
            <DraggablePanel panelRef={panelRef} className={panelClass} labelledBy={labelledBy} onClose={onClose}>
              {children}
            </DraggablePanel>
          ) : (
            <motion.div
              ref={panelRef}
              data-overlay-panel
              role="dialog"
              aria-modal="true"
              aria-labelledby={labelledBy}
              tabIndex={-1}
              className={`${panelClass} outline-none`}
              initial={sheet ? { y: "100%" } : { opacity: 0, scale: 0.96, y: 12 }}
              animate={sheet ? { y: 0 } : { opacity: 1, scale: 1, y: 0 }}
              exit={sheet ? { y: "100%" } : { opacity: 0, scale: 0.96, y: 12 }}
              transition={SPRING}
            >
              {sheet && (
                <span aria-hidden className="mx-auto mt-2.5 h-1.5 w-12 shrink-0 rounded-full bg-app-border" />
              )}
              {children}
            </motion.div>
          )}
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}

type DraggablePanelProps = {
  panelRef: RefObject<HTMLDivElement | null>;
  className: string;
  labelledBy: string;
  onClose: () => void;
  children: ReactNode;
};

/**
 * El panel que se arrastra. La posición vertical es un `MotionValue` (`y`, en
 * px desde la altura alta): el arrastre y las animaciones lo mueven sin pasar
 * por React, así que no hay saltos ni renders por cada píxel.
 */
function DraggablePanel({ panelRef, className, labelledBy, onClose, children }: DraggablePanelProps) {
  const y = useMotionValue(0);
  const controls = useDragControls();
  const closing = useRef(false);

  /** Cuánto puede bajar el panel antes de salir de la pantalla. */
  const travel = useCallback(() => panelRef.current?.offsetHeight ?? window.innerHeight, [panelRef]);

  const close = useCallback(() => {
    if (closing.current) return;
    closing.current = true;
    // La animación de salida la hace `exit` (y: 100%): solo se avisa.
    onClose();
  }, [onClose]);

  const snapTo = useCallback((fraction: number) => {
    void animate(y, fraction * travel(), SPRING);
  }, [travel, y]);

  const onDragEnd = useCallback((_: unknown, info: PanInfo) => {
    const height = travel();
    const at = y.get() / height;
    if (info.velocity.y > CLOSE_VELOCITY || at > CLOSE_AT) {
      close();
      return;
    }
    // A la altura fija más cercana, adelantando un poco el impulso del dedo:
    // un tirón corto hacia abajo desde arriba lleva a la media.
    const projected = at + (info.velocity.y / height) * 0.18;
    snapTo(Math.abs(projected - SNAP_HIGH) <= Math.abs(projected - SNAP_MID) ? SNAP_HIGH : SNAP_MID);
  }, [close, snapTo, travel, y]);

  const drag: SheetDrag = {
    onPointerDown: (event) => {
      if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
      // Un botón, un campo o un chip de la cabecera siguen siendo eso: tocarlos
      // no empieza a arrastrar el panel.
      if ((event.target as Element).closest("button, input, select, textarea, a, [data-no-drag]")) return;
      controls.start(event);
    },
    onHandleKeyDown: (event) => {
      const at = y.get() / travel();
      if (event.key === "ArrowDown") {
        event.preventDefault();
        if (at < SNAP_MID - 0.05) snapTo(SNAP_MID);
        else close();
      } else if (event.key === "ArrowUp") {
        event.preventDefault();
        snapTo(SNAP_HIGH);
      }
    },
  };

  return (
    <motion.div
      ref={panelRef}
      data-overlay-panel
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      tabIndex={-1}
      className={`${className} outline-none`}
      style={{ y }}
      // En píxeles, no en "100%": `y` tiene que ser un número para que el
      // arrastre y las alturas fijas (`y / alto`) se puedan calcular.
      initial={{ y: window.innerHeight }}
      animate={{ y: 0 }}
      exit={{ y: window.innerHeight }}
      transition={SPRING}
      drag="y"
      dragControls={controls}
      dragListener={false}
      // Arriba no pasa del borde (0, con un poco de resistencia). Abajo no hay
      // tope práctico: al soltar, `onDragEnd` lo lleva a una altura fija o lo
      // cierra. Con tope abajo, motion lo devolvería arriba por su cuenta.
      dragConstraints={{ top: 0, bottom: 100_000 }}
      dragElastic={{ top: 0.04, bottom: 0 }}
      dragMomentum={false}
      onDragEnd={onDragEnd}
    >
      <SheetDragContext.Provider value={drag}>{children}</SheetDragContext.Provider>
    </motion.div>
  );
}

/**
 * Agarradera de un panel `draggable`: la rayita de arriba. Es también el
 * control de teclado (flechas), porque el panel ya no tiene botón de cerrar.
 */
export function SheetHandle({ label }: { label: string }) {
  const drag = useSheetDrag();
  if (!drag) return null;
  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${label}. Arrastra o usa las flechas: abajo para bajar o cerrar, arriba para subir.`}
      onKeyDown={drag.onHandleKeyDown}
      className="mx-auto flex h-7 w-24 shrink-0 cursor-grab touch-none items-center justify-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent active:cursor-grabbing"
    >
      <span aria-hidden className="h-1.5 w-12 rounded-full bg-app-border" />
    </div>
  );
}
