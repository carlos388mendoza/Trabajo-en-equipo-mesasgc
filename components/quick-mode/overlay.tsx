"use client";

// Ventana del modo rápido: panel que sube desde abajo en celular y tablet, y
// ventana centrada en computadora (desde `lg`, 1024 px). La usan el
// formulario de agregar cliente y «Ver todas las cartas».
//
// Se cierra con Esc, tocando fuera o con el botón que ponga quien la usa. Al
// abrir enfoca el primer campo con `data-autofocus` (o el panel) y al cerrar
// devuelve el foco a donde estaba: en una tablet con teclado, Ctrl+Z y las
// flechas siguen funcionando después.

import { useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { AnimatePresence, motion } from "motion/react";

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

type OverlayProps = {
  open: boolean;
  onClose: () => void;
  /** id del título, para `aria-labelledby`. */
  labelledBy: string;
  /** `form`: ventana chica; `list`: más ancha (filas de «Varios»); `wide`: casi toda la pantalla. */
  size?: "form" | "list" | "wide";
  children: ReactNode;
};

export function Overlay({ open, onClose, labelledBy, size = "form", children }: OverlayProps) {
  const desktop = useIsDesktop();
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

  const sheet = !desktop;
  const panelClass = sheet
    ? `absolute inset-x-0 bottom-0 flex flex-col rounded-t-[1.75rem] border-t border-app-border bg-panel text-panel-text shadow-2xl ${
        size === "wide" ? "h-[92dvh]" : "max-h-[92dvh]"
      }`
    : `relative flex w-full flex-col rounded-3xl border border-app-border bg-panel text-panel-text shadow-2xl ${
        size === "wide" ? "h-[85vh] max-w-5xl" : size === "list" ? "max-h-[85vh] max-w-2xl" : "max-h-[85vh] max-w-lg"
      }`;

  return (
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
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            tabIndex={-1}
            className={`${panelClass} outline-none`}
            initial={sheet ? { y: "100%" } : { opacity: 0, scale: 0.96, y: 12 }}
            animate={sheet ? { y: 0 } : { opacity: 1, scale: 1, y: 0 }}
            exit={sheet ? { y: "100%" } : { opacity: 0, scale: 0.96, y: 12 }}
            transition={{ type: "spring", stiffness: 420, damping: 38 }}
          >
            {sheet && (
              <span aria-hidden className="mx-auto mt-2.5 h-1.5 w-12 shrink-0 rounded-full bg-app-border" />
            )}
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
