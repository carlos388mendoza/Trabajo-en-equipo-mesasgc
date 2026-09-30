import Link from "next/link";

import { can } from "@/lib/auth/rbac";
import { getCurrentUser } from "@/lib/auth/session";

// El layout solo presenta enlaces; páginas, actions y APIs hacen la comprobación real.
export default async function RestauranteLayout({
  children,
  params,
}: {
  params: Promise<{ id: string }>;
  children: React.ReactNode;
}) {
  const [{ id }, user] = await Promise.all([params, getCurrentUser()]);
  const links = [
    { href: `/restaurante/${id}/editor`, label: "Editor de mesas", show: can(user, "editor:ver", id) },
    { href: `/restaurante/${id}/rapido`, label: "Modo sencillo", show: can(user, "rapido:ver", id) },
    { href: `/restaurante/${id}/mapa`, label: "Plano en vivo", show: can(user, "plano:ver", id) },
    { href: "/analiticas", label: "Estadísticas e IA", show: can(user, "analiticas:ver") },
  ].filter((link) => link.show);

  return (
    <div>
      {links.length > 0 ? (
        <nav className="mb-4 flex flex-wrap gap-2 text-sm">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-full px-3 py-2 text-app-muted hover:bg-app-border/60 hover:text-app-text"
            >
              {link.label}
            </Link>
          ))}
        </nav>
      ) : null}
      {children}
    </div>
  );
}
