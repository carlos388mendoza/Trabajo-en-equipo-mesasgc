"use client";

// La paleta de tipos de elemento.
//
// Arrastre HTML5 nativo (`draggable` + dataTransfer) y no el de Konva, porque
// los botones viven en el DOM normal de Tailwind, fuera del canvas. El canvas
// recibe el evento `drop` y pide al handle que convierta las coordenadas de
// pantalla a coordenadas del lienzo, que es lo único que necesita este
// componente: solo tiene que decir QUÉ se está arrastrando, no dónde.

import type { ElementTypeInfo } from "@/lib/layout/types";

/** Clave del dataTransfer. El canvas lee esto en el `drop`. */
export const DND_MIME = "application/x-mesasgc-element-type";

type Props = {
  types: ElementTypeInfo[];
  onAddClick: (type: ElementTypeInfo) => void;
};

export function ElementPalette({ types, onAddClick }: Props) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Elementos
      </p>

      {types.map((type) => (
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
          onDoubleClick={() => onAddClick(type)}
          onClick={() => onAddClick(type)}
          title={`${type.label} — arrastra al mapa o haz clic para añadirlo al centro`}
          className="flex cursor-grab items-center gap-2 rounded-md border border-neutral-200 bg-white px-2 py-1.5 text-left text-sm shadow-sm transition hover:border-neutral-300 hover:bg-neutral-50 active:cursor-grabbing"
        >
          <span
            aria-hidden
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-base"
            style={{ backgroundColor: `${type.color}22`, color: type.color }}
          >
            {type.icon}
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
      ))}

      <p className="mt-1 text-xs leading-relaxed text-neutral-500">
        Arrastra al mapa o haz clic para añadirlo.
        <br />
        Arrastra el fondo para mover la vista, rueda para hacer zoom.
      </p>
    </div>
  );
}
