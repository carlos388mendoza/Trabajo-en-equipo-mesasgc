"use client";

// Piezas comunes de /admin: la ventana de confirmación y los botones.

import { useEffect, useRef } from "react";
import type { LucideIcon } from "lucide-react";
import { X } from "lucide-react";

import { ICON_STROKE } from "@/components/editor/icons";

/** Ventana de confirmación: Esc, Cancelar o tocar fuera la cierran sin hacer nada. */
export function ConfirmDialog({
  title,
  children,
  danger,
  pending,
  onConfirm,
  onCancel,
  // Para las confirmaciones que piden una palabra: el botón no se habilita
  // hasta que se escribe. El servidor la vuelve a pedir igual; esto es solo para
  // que no parezca un botón normal.
  confirmDisabled,
  confirmLabel,
}: {
  title: string;
  children: React.ReactNode;
  danger?: boolean;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  confirmDisabled?: boolean;
  confirmLabel?: string;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    // El foco empieza en Cancelar: un Enter distraído no cambia nada.
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel, title]);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="admin-confirm-title"
        aria-describedby="admin-confirm-body"
        className="w-full max-w-md rounded-2xl bg-panel p-5 text-panel-text shadow-xl ring-1 ring-app-border"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 id="admin-confirm-title" className="text-base font-semibold">
          {title}
        </h3>
        <div id="admin-confirm-body" className="mt-3 space-y-2 text-sm">
          {children}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            onClick={onCancel}
            className="h-11 rounded-xl px-4 text-sm font-medium text-panel-text hover:bg-app-border/60"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={pending || confirmDisabled}
            className={`h-11 rounded-xl px-4 text-sm font-semibold disabled:opacity-60 ${
              danger ? "bg-estado-ocupada text-white hover:bg-estado-ocupada/85" : "bg-accent text-accent-text hover:bg-accent/85"
            }`}
          >
            {confirmLabel ?? "Aceptar"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function FormButtons({
  pending,
  onCancel,
  submitLabel,
  disabled,
}: {
  pending: boolean;
  onCancel: () => void;
  submitLabel: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-wrap justify-end gap-2">
      <Button icon={X} onClick={onCancel} disabled={pending}>
        Cancelar
      </Button>
      <button
        type="submit"
        disabled={pending || disabled}
        className="h-11 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-text hover:bg-accent/85 disabled:opacity-60"
      >
        {pending ? "Guardando…" : submitLabel}
      </button>
    </div>
  );
}

export function Button({
  icon: Icon,
  children,
  onClick,
  disabled,
  title,
  primary,
  danger,
}: {
  icon: LucideIcon;
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  primary?: boolean;
  danger?: boolean;
}) {
  const tone = primary
    ? "bg-accent text-accent-text hover:bg-accent/85"
    : danger
      ? "text-estado-ocupada hover:bg-estado-ocupada/10"
      : "text-panel-text hover:bg-app-border/60";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${tone}`}
    >
      <Icon aria-hidden size={18} strokeWidth={ICON_STROKE} />
      {children}
    </button>
  );
}

export function IconButton({ icon: Icon, label, onClick }: { icon: LucideIcon; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-app-border hover:bg-app-border/60"
    >
      <Icon aria-hidden size={18} strokeWidth={ICON_STROKE} />
    </button>
  );
}
