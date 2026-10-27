"use client";

// Diálogo de confirmación propio, en lugar del `window.confirm` del navegador
// (issue #107): el nativo no sigue el tema de la app, en la tablet sale con
// «Cancel / OK» en inglés y en algunos navegadores bloquea la página.
//
// Accesible y usable con teclado:
//   - `role="alertdialog"` con título y texto enlazados;
//   - el foco entra al abrir (en el botón de confirmar) y queda atrapado:
//     Tab y Mayús+Tab dan la vuelta dentro del diálogo;
//   - Esc cancela; Enter confirma (salvo con el foco en «Cancelar», donde
//     Enter cancela, que es lo que se espera de ese botón);
//   - al cerrarse, el foco vuelve a donde estaba.
// Se dibuja en `document.body` con `position: fixed` y por encima de los
// paneles (z-[80]), así sale bien en la tablet acostada y con el navegador
// en pantalla completa (Opera, F11), donde no hay otra capa encima.

import { useEffect, useId, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

export function ConfirmDialog({
  title,
  children,
  danger,
  pending = false,
  onConfirm,
  onCancel,
  // Para las confirmaciones que piden una palabra: el botón no se habilita
  // hasta que se escribe. El servidor la vuelve a pedir igual; esto es solo para
  // que no parezca un botón normal.
  confirmDisabled,
  confirmLabel,
  cancelLabel = "Cancelar",
}: {
  title: string;
  children?: ReactNode;
  /** Acción que borra o no se deshace: el botón de confirmar va en rojo. */
  danger?: boolean;
  pending?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  confirmDisabled?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
}) {
  const id = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  // Las funciones cambian en cada render del padre: se leen de una ref para
  // no volver a montar los listeners (y no perder el foco) en cada render.
  const handlers = useRef({ onConfirm, onCancel, blocked: false });
  useEffect(() => {
    handlers.current = { onConfirm, onCancel, blocked: pending || Boolean(confirmDisabled) };
  });

  useEffect(() => {
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Si el diálogo tiene un campo (confirmaciones que piden una palabra), el
    // foco va ahí; si no, al botón de confirmar.
    const field = dialogRef.current?.querySelector<HTMLElement>("input, textarea, select");
    (field ?? confirmRef.current ?? cancelRef.current)?.focus();

    const onKey = (event: KeyboardEvent) => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        handlers.current.onCancel();
        return;
      }
      if (event.key === "Enter" && !event.isComposing) {
        // Enter mantenido (autorrepetición) no confirma: así no se salta los
        // dos pasos de una confirmación doble.
        if (event.repeat) return;
        if (document.activeElement === cancelRef.current) return;
        if (document.activeElement instanceof HTMLTextAreaElement) return;
        event.preventDefault();
        if (!handlers.current.blocked) handlers.current.onConfirm();
        return;
      }
      if (event.key === "Tab") {
        const focusable = [...dialog.querySelectorAll<HTMLElement>("button, input, textarea, select, a[href], [tabindex]:not([tabindex='-1'])")].filter(
          (el) => !el.hasAttribute("disabled"),
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        const inside = dialog.contains(document.activeElement);
        if (event.shiftKey && (document.activeElement === first || !inside)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !inside)) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    // En captura: el diálogo atiende Esc y Enter antes que los paneles de
    // debajo (que también escuchan Esc para cerrarse).
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      before?.focus();
    };
  }, []);

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/50 p-4" onClick={() => handlers.current.onCancel()}>
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={`${id}-titulo`}
        aria-describedby={children ? `${id}-texto` : undefined}
        className="max-h-[calc(100dvh-2rem)] w-full max-w-md overflow-y-auto rounded-2xl bg-panel p-5 text-panel-text shadow-xl ring-1 ring-app-border"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id={`${id}-titulo`} className="text-base font-semibold">
          {title}
        </h3>
        {children ? (
          <div id={`${id}-texto`} className="mt-3 space-y-2 text-sm">
            {children}
          </div>
        ) : null}
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={() => handlers.current.onCancel()}
            className="h-11 rounded-xl px-4 text-sm font-medium text-panel-text ring-1 ring-app-border hover:bg-app-border/60"
          >
            {cancelLabel}
          </button>
          <button
            ref={confirmRef}
            type="button"
            onClick={() => handlers.current.onConfirm()}
            disabled={pending || confirmDisabled}
            className={`h-11 rounded-xl px-4 text-sm font-semibold disabled:opacity-60 ${
              danger ? "bg-estado-ocupada text-white hover:bg-estado-ocupada/85" : "bg-accent text-accent-text hover:bg-accent/85"
            }`}
          >
            {confirmLabel ?? "Aceptar"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
