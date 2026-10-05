"use client";

// Acceso directo de la cabecera a un modo de un restaurante («Modo sencillo»,
// «Panel»), sin pasar por /inicio:
//
//  - dentro de un restaurante (/restaurante/[id]/…), lleva a ESE restaurante;
//  - con uno solo permitido, va directo a él;
//  - con varios, abre una lista para elegir.
//
// La lista la decide el servidor con `can()` (la cabecera); esto es solo
// navegación: cada página vuelve a comprobar el permiso.

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, LayoutGrid, Zap } from "lucide-react";

export type ModeLinkRestaurant = { id: string; name: string };

const ICONS = { rapido: Zap, editor: LayoutGrid } as const;

export function RestaurantModeLink({
  mode,
  label,
  restaurants,
}: {
  mode: "rapido" | "editor";
  label: string;
  restaurants: ModeLinkRestaurant[];
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);
  const Icon = ICONS[mode];

  // Cerrar la lista al tocar fuera o con Esc.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (restaurants.length === 0) return null;

  const current = /^\/restaurante\/([^/]+)/.exec(pathname ?? "")?.[1];
  const target = restaurants.find((r) => r.id === current) ?? (restaurants.length === 1 ? restaurants[0] : null);
  const linkClass =
    "flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-panel-muted hover:bg-app-border/60 hover:text-panel-text";

  if (target) {
    return (
      <Link href={`/restaurante/${target.id}/${mode}`} className={linkClass} title={`${label} de ${target.name}`}>
        <Icon aria-hidden size={18} strokeWidth={2} />
        {label}
      </Link>
    );
  }

  return (
    <div ref={boxRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={linkClass}
      >
        <Icon aria-hidden size={18} strokeWidth={2} />
        {label}
        <ChevronDown aria-hidden size={14} strokeWidth={2} />
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={`${label}: elige el restaurante`}
          className="absolute left-0 top-11 z-50 max-h-80 w-64 overflow-y-auto rounded-xl bg-panel p-1 text-panel-text shadow-xl ring-1 ring-app-border"
        >
          {restaurants.map((r) => (
            <Link
              key={r.id}
              role="menuitem"
              href={`/restaurante/${r.id}/${mode}`}
              onClick={() => setOpen(false)}
              className="flex min-h-11 items-center rounded-lg px-3 text-sm hover:bg-app-border/60"
            >
              {r.name}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}
