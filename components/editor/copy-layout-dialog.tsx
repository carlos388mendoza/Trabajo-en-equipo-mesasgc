"use client";

// Diálogo "Copiar estructura a otro restaurante" (paso 3).
//
// Se cierra con Escape y con el botón de cerrar, y se cierra solo si la copia
// va bien. Si falla, se queda abierto con el mensaje, porque el usuario
// normalmente quiere cambiar el destino y volver a intentarlo.

import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

import { ICON_STROKE } from "./icons";
import {
  copyStructureToRestaurant,
  type RestaurantOption,
} from "@/app/restaurante/[id]/editor/actions";

type Props = {
  sourceRestaurantId: string;
  sourceZoneName: string;
  sourceZoneCount: number;
  sourceElementCount: number;
  targets: RestaurantOption[];
  onClose: () => void;
  /** Al terminar bien, el padre recarga la página (se copió a OTRO local). */
  onCopied: (message: string) => void;
};

type State =
  | { kind: "choosing" }
  | { kind: "confirming"; target: RestaurantOption }
  | { kind: "busy"; targetName: string }
  | { kind: "error"; message: string };

export function CopyLayoutDialog({
  sourceRestaurantId,
  sourceZoneName,
  sourceZoneCount,
  sourceElementCount,
  targets,
  onClose,
  onCopied,
}: Props) {
  const [state, setState] = useState<State>({ kind: "choosing" });
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      // Con la copia en marcha no se cierra: si se cerrara, el usuario
      // creería que se canceló cuando en realidad puede que se haya aplicado.
      if (state.kind !== "busy") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose, state.kind]);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  async function run(target: RestaurantOption, replace: boolean) {
    setState({ kind: "busy", targetName: target.name });
    const result = await copyStructureToRestaurant({
      sourceRestaurantId,
      targetRestaurantId: target.id,
      replace,
    });

    if (result.ok) {
      const detalle = result.replaced ? "sustituyendo la anterior" : "creándola";
      onCopied(
        `Copiadas ${result.zones} zona(s) y ${result.elements} elemento(s) ` +
          `a ${result.targetName}, ${detalle}.`,
      );
      return;
    }

    setState({ kind: "error", message: result.error });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onMouseDown={(e) => {
        // Clic en el fondo oscuro = cerrar. Solo si el clic empezó ahí, para
        // que arrastrar desde dentro del diálogo no lo cierre.
        if (e.target === e.currentTarget && state.kind !== "busy") onClose();
      }}
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="copy-title"
        className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl outline-none"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 id="copy-title" className="text-base font-semibold text-neutral-900">
              Copiar estructura a otro restaurante
            </h2>
            <p className="mt-1 text-sm text-neutral-500">
              Se copiarán{" "}
              <strong>
                {sourceZoneCount} zona{sourceZoneCount === 1 ? "" : "s"}
              </strong>{" "}
              (empezando por {sourceZoneName}) con{" "}
              <strong>{sourceElementCount} elemento{sourceElementCount === 1 ? "" : "s"}</strong>.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={state.kind === "busy"}
            aria-label="Cerrar"
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-40"
          >
            <X aria-hidden size={20} strokeWidth={ICON_STROKE} />
          </button>
        </div>

        {state.kind === "choosing" ? (
          <div className="space-y-2">
            {targets.length === 0 ? (
              <p className="rounded-md bg-amber-50 p-3 text-sm text-amber-800">
                No hay ningún otro restaurante en la base de datos. Crea uno
                primero.
              </p>
            ) : (
              <>
                <p className="text-sm text-neutral-600">
                  Elige a dónde llevarla:
                </p>
                {targets.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() =>
                      t.zones > 0
                        ? setState({ kind: "confirming", target: t })
                        : void run(t, false)
                    }
                    className="flex w-full items-center justify-between rounded-md border border-neutral-200 px-3 py-2 text-left text-sm hover:border-neutral-400 hover:bg-neutral-50"
                  >
                    <span className="font-medium text-neutral-800">{t.name}</span>
                    <span className="text-xs text-neutral-500">
                      {t.zones === 0
                        ? "vacío"
                        : `${t.zones} zona(s) · ${t.elements} elemento(s)`}
                    </span>
                  </button>
                ))}
              </>
            )}
          </div>
        ) : null}

        {state.kind === "confirming" ? (
          <div className="space-y-3">
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <p className="font-semibold">
                {state.target.name} ya tiene {state.target.zones} zona(s) y{" "}
                {state.target.elements} elemento(s).
              </p>
              <p className="mt-1">
                Si copias encima, <strong>se borran</strong> y se quedan solo
                los tuyos. No se puede deshacer.
              </p>
              {state.target.ocupadas > 0 ? (
                <p className="mt-1 font-semibold">
                  Tiene {state.target.ocupadas} mesa(s) con clientes sentados,
                  así que la copia se va a rechazar. Libéralas primero.
                </p>
              ) : null}
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setState({ kind: "choosing" })}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
              >
                Volver
              </button>
              <button
                type="button"
                onClick={() => void run(state.target, true)}
                className="rounded-md bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-700"
              >
                Sí, sustituirlo todo
              </button>
            </div>
          </div>
        ) : null}

        {state.kind === "busy" ? (
          <p className="py-2 text-sm text-neutral-600">
            Copiando a {state.targetName}…
          </p>
        ) : null}

        {state.kind === "error" ? (
          <div className="space-y-3">
            <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800">
              {state.message}
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setState({ kind: "choosing" })}
                className="rounded-md border border-neutral-300 px-3 py-1.5 text-sm hover:bg-neutral-50"
              >
                Cambiar de destino
              </button>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
