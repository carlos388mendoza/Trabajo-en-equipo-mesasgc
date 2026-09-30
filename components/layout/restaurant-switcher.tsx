"use client";

// Selector de restaurante de la cabecera, para quien tiene varios asignados
// (por ejemplo, un usuario para los 4 locales de Denny's y Pizza Hut).
//
// Lleva al MISMO modo en el otro restaurante: si está en el modo sencillo de
// uno, abre el modo sencillo del elegido. Es solo navegación: cada página
// vuelve a comprobar el permiso en el servidor, y al cambiar de ruta la
// pantalla se monta de cero y su socket entra en la room del nuevo (y sale
// de la anterior).

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Check, ChevronDown, Store } from "lucide-react";

import { readableOn } from "@/lib/theme/theme";

export type SwitcherRestaurant = {
  id: string;
  name: string;
  city: string | null;
  brand: { name: string; accentColor: string } | null;
};

const MODES = ["rapido", "editor", "mapa"] as const;
type Mode = (typeof MODES)[number];

const NO_BRAND = "#94a3b8";

/** El distintivo de la marca: su color con la inicial, legible en claro y oscuro. */
export function BrandBadge({ brand, size = 24 }: { brand: SwitcherRestaurant["brand"]; size?: number }) {
  const color = brand?.accentColor ?? NO_BRAND;
  return (
    <span
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full font-bold ring-1 ring-black/10"
      style={{ width: size, height: size, backgroundColor: color, color: readableOn(color), fontSize: size * 0.45 }}
    >
      {(brand?.name ?? "?").charAt(0).toUpperCase()}
    </span>
  );
}

export function RestaurantSwitcher({ restaurants }: { restaurants: SwitcherRestaurant[] }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const match = pathname.match(/^\/restaurante\/([^/]+)(?:\/([^/]+))?/);
  const currentId = match?.[1] ?? null;
  const mode: Mode = MODES.includes(match?.[2] as Mode) ? (match?.[2] as Mode) : "rapido";
  const current = restaurants.find((r) => r.id === currentId) ?? null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={current ? `Restaurante: ${current.name}. Cambiar de restaurante` : "Elegir restaurante"}
        onClick={() => setOpen((v) => !v)}
        className="flex h-11 max-w-[16rem] items-center gap-2 rounded-xl border border-app-border px-2.5 text-sm font-semibold hover:bg-app-border/60"
      >
        {current ? <BrandBadge brand={current.brand} /> : <Store aria-hidden size={18} strokeWidth={2} />}
        <span className="truncate">{current?.name ?? "Elegir restaurante"}</span>
        <ChevronDown aria-hidden size={16} strokeWidth={2} className={`shrink-0 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div role="menu" aria-label="Mis restaurantes" className="absolute left-0 z-40 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-2xl border border-app-border bg-panel p-1.5 text-panel-text shadow-xl">
          {restaurants.map((r) => {
            const active = r.id === currentId;
            return (
              <Link
                key={r.id}
                role="menuitem"
                href={`/restaurante/${r.id}/${mode}`}
                aria-current={active ? "page" : undefined}
                onClick={() => setOpen(false)}
                className={`flex min-h-12 items-center gap-3 rounded-xl px-2.5 py-2 text-sm hover:bg-app-border/60 ${active ? "bg-accent/10" : ""}`}
              >
                <BrandBadge brand={r.brand} size={28} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{r.name}</span>
                  <span className="block truncate text-xs text-panel-muted">
                    {[r.brand?.name, r.city].filter(Boolean).join(" · ")}
                  </span>
                </span>
                {active ? <Check aria-hidden size={18} strokeWidth={2.25} className="text-accent" /> : null}
              </Link>
            );
          })}
          <Link href="/inicio" role="menuitem" onClick={() => setOpen(false)} className="mt-1 flex h-10 items-center justify-center rounded-xl text-sm font-medium text-accent hover:bg-app-border/60">
            Ver todos en Inicio
          </Link>
        </div>
      ) : null}
    </div>
  );
}
