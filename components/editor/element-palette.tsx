"use client";

// La paleta de tipos de elemento.
//
// Arrastre HTML5 nativo (`draggable` + dataTransfer) y no el de Konva, porque
// los botones viven en el DOM normal de Tailwind, fuera del canvas. El canvas
// recibe el evento `drop` y pide al handle que convierta las coordenadas de
// pantalla a coordenadas del lienzo, que es lo único que necesita este
// componente: solo tiene que decir QUÉ se está arrastrando, no dónde.
//
// En una tablet el arrastre HTML5 no existe: allí se toca el botón y el
// elemento aparece en el centro de lo que se ve. Por eso los botones son
// grandes (56 px de alto) y el toque es el gesto principal.

import type { ElementTypeInfo } from "@/lib/layout/types";

import { ICON_STROKE, typeIcon } from "./icons";

/** Clave del dataTransfer. El canvas lee esto en el `drop`. */
export const DND_MIME = "application/x-mesasgc-element-type";

type Props = {
  types: ElementTypeInfo[];
  onAddClick: (type: ElementTypeInfo) => void;
};

export function ElementPalette({ types, onAddClick }: Props) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Elementos
      </p>

      {types.map((type) => {
        const Icon = typeIcon(type.key).component;
        return (
          <button
            key={type.id}
            type="button"
            draggable
            onDragStart={(e) => {
              // `text/plain` no: Firefox lo ignora y no dispara el drop.
              e.dataTransfer.setData(DND_MIME, type.id);
              e.dataTransfer.setData("text/plain", type.label);
              e.dataTransfer.effectAllowed = "copy";
            }}
            onDragEnd={(e) => {
              // Al soltar fuera del canvas, la fila se queda gris.
              (e.currentTarget as HTMLElement).style.opacity = "";
            }}
            onClick={() => onAddClick(type)}
            title={`${type.label}: arrastra al mapa o toca para añadirlo al centro`}
            className="flex min-h-14 cursor-grab items-center gap-3 rounded-xl border border-neutral-200 bg-white px-3 py-2 text-left text-sm shadow-sm transition hover:border-neutral-300 hover:bg-neutral-50 active:scale-[0.98] active:cursor-grabbing"
          >
            <span
              aria-hidden
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg"
              style={{ backgroundColor: `${type.color}1f`, color: type.color }}
            >
              <Icon size={20} strokeWidth={ICON_STROKE} />
            </span>
            <span className="min-w-0">
              <span className="block truncate font-medium text-neutral-800">
                {type.label}
              </span>
              {type.defaultCapacity ? (
                <span className="block text-xs text-neutral-500">
                  {type.defaultCapacity} puestos
                </span>
              ) : null}
            </span>
          </button>
        );
      })}

      <p className="mt-1 text-xs leading-relaxed text-neutral-500">
        Toca un elemento para añadirlo, o arrástralo al mapa.
        <br />
        Arrastra el fondo para mover la vista; pellizca o usa la rueda para
        hacer zoom.
      </p>
    </div>
  );
}
