"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function RestaurantNav({ restaurantId }: { restaurantId: string }) {
  const pathname = usePathname();
  const links = [
    { href: `/restaurante/${restaurantId}/editor`, label: "Editor de mesas", active: pathname.endsWith("/editor") },
    { href: `/restaurante/${restaurantId}/rapido`, label: "Modo sencillo", active: pathname.endsWith("/rapido") },
    { href: "/analiticas", label: "Estadísticas e IA", active: pathname === "/analiticas" },
  ];

  return (
    <nav className="mb-4 flex flex-wrap gap-2 text-sm" aria-label="Secciones del restaurante">
      {links.map(({ href, label, active }) => (
        <Link
          key={href}
          href={href}
          aria-current={active ? "page" : undefined}
          className={`rounded-full px-3 py-2 transition ${active ? "bg-accent/15 font-semibold text-accent" : "text-app-muted hover:bg-app-border/60"}`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}
