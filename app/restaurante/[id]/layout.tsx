import Link from "next/link";

import { can } from "@/lib/auth/rbac";
import { getCurrentUser } from "@/lib/auth/session";

// Navegación del restaurante: solo los modos que este usuario puede usar.
//
// Es solo PRESENTACIÓN. Ocultar un enlace no protege nada; cada página y API
// comprueba el permiso por su cuenta (y los layouts no se vuelven a ejecutar
// al navegar, así que aquí no se decide el acceso).

export default async function RestauranteLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}) {
  const [{ id }, user] = await Promise.all([params, getCurrentUser()]);
  const links = [
    { href: `/restaurante/${id}/editor`, label: "Editor de mesas", show: can(user, "editor:ver", id) },
    { href: `/restaurante/${id}/rapido`, label: "Modo sencillo", show: can(user, "rapido:ver", id) },
    { href: "/analiticas", label: "Estadísticas e IA", show: can(user, "analiticas:ver") },
  ].filter((l) => l.show);

  return (
    <div>
      {links.length > 0 ? (
        <nav className="mb-4 flex flex-wrap gap-2 text-sm">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className="rounded-full px-3 py-2 text-app-muted hover:bg-app-border/60 hover:text-app-text"
            >
              {l.label}
            </Link>
          ))}
        </nav>
      ) : null}
      {children}
    </div>
  );
}
