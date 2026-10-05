import Image from "next/image";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ChartColumn, Map as MapIcon, Settings, ShieldCheck } from "lucide-react";

import { RestaurantModeLink, type ModeLinkRestaurant } from "@/components/layout/restaurant-mode-link";
import { RestaurantSwitcher, type SwitcherRestaurant } from "@/components/layout/restaurant-switcher";
import { SignOutButton } from "@/components/layout/sign-out-button";
import { ROLE_LABELS, can } from "@/lib/auth/rbac";
import { getCurrentUser } from "@/lib/auth/session";
import { listRestaurants } from "@/lib/auth/users";
import { ROLES } from "@/lib/db/enums";

// Encabezado de toda la app.
//
// Los enlaces solo muestran lo que este usuario puede ver, pero eso es
// PRESENTACIÓN: ocultar un enlace no protege nada. Cada página vuelve a
// comprobar el permiso en el servidor.

type NavLink = { href: string; label: string; icon: LucideIcon };

export async function AppHeader() {
  const user = await getCurrentUser();

  const links: NavLink[] = [];
  // Accesos directos a un modo del restaurante (ver `RestaurantModeLink`):
  // «Modo sencillo» para quien puede usarlo (admin y restaurante; analítica no)
  // y «Panel» (el modo completo, el editor) para el rol restaurante.
  let rapido: ModeLinkRestaurant[] = [];
  let panel: ModeLinkRestaurant[] = [];
  // Con varios restaurantes, un selector para cambiar entre ellos (solo los
  // suyos y activos: `restaurantIds` ya viene filtrado).
  let mine: SwitcherRestaurant[] = [];
  if (user && user.roles.includes(ROLES.RESTAURANTE) && user.restaurantIds.length > 1) {
    mine = (await listRestaurants())
      .filter((r) => user.restaurantIds.includes(r.id))
      .map(({ id, name, city, brand }) => ({ id, name, city, brand }));
  }
  if (user) {
    if (can(user, "usuarios:gestionar")) {
      links.push({ href: "/admin", label: "Administración", icon: ShieldCheck });
    }
    // Los restaurantes activos (`listRestaurants`) filtrados con `can()`: el
    // admin los ve todos, el rol restaurante solo los suyos, analítica ninguno.
    if (user.roles.includes(ROLES.ADMIN) || user.restaurantIds.length > 0) {
      const activos = (await listRestaurants()).map(({ id, name }) => ({ id, name }));
      rapido = activos.filter((r) => can(user, "rapido:ver", r.id));
      if (user.roles.includes(ROLES.RESTAURANTE)) {
        panel = activos.filter((r) => user.restaurantIds.includes(r.id) && can(user, "editor:ver", r.id));
      }
    }
    // "Mapa": el general para admin y analitica; para un host con un solo
    // restaurante, el plano en vivo del suyo. Con varios, lo elige desde
    // la navegación de cada restaurante.
    if (can(user, "mapa:ver")) {
      links.push({ href: "/mapa", label: "Mapa", icon: MapIcon });
    } else if (user.restaurantIds.length === 1 && can(user, "plano:ver", user.restaurantIds[0])) {
      links.push({ href: `/restaurante/${user.restaurantIds[0]}/mapa`, label: "Mapa", icon: MapIcon });
    }
    if (can(user, "analiticas:ver")) {
      links.push({ href: "/analiticas", label: "Estadísticas", icon: ChartColumn });
    }
  }

  return (
    <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-app-border bg-panel px-4 py-2.5 text-panel-text">
      <Link href={user ? "/inicio" : "/login"} className="flex shrink-0 items-center gap-2.5">
        <Image
          src="/brand/grupo-comidas-logo-circular-solo-nombre.png"
          alt="Grupo Comidas"
          width={36}
          height={36}
          priority
          className="h-9 w-9 rounded-full object-cover ring-1 ring-app-border"
        />
        {/* Logotipo de texto: "Table" y "Waitlist" en el acento del tema. */}
        <span className="text-lg font-bold tracking-tight">
          Table<span className="text-accent">Waitlist</span>
        </span>
      </Link>

      {mine.length > 1 ? <RestaurantSwitcher restaurants={mine} /> : null}

      {links.length > 0 || rapido.length > 0 ? (
        <nav aria-label="Principal" className="flex flex-wrap gap-1">
          {/* Solo se monta si hay a dónde ir: si no, ni la etiqueta viaja en la
              respuesta (analítica no puede usar el modo sencillo). */}
          {rapido.length > 0 ? <RestaurantModeLink mode="rapido" label="Modo sencillo" restaurants={rapido} /> : null}
          {panel.length > 0 ? <RestaurantModeLink mode="editor" label="Panel" restaurants={panel} /> : null}
          {links.map(({ href, label, icon: Icon }) => (
            <Link
              key={`${href} ${label}`}
              href={href}
              className="flex h-10 items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-panel-muted hover:bg-app-border/60 hover:text-panel-text"
            >
              <Icon aria-hidden size={18} strokeWidth={2} />
              {label}
            </Link>
          ))}
        </nav>
      ) : null}

      {user ? (
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <div className="hidden text-right sm:block">
            <p className="text-sm font-semibold leading-tight">{user.name}</p>
            <p className="mt-0.5 flex flex-wrap justify-end gap-1">
              {user.roles.map((role) => (
                <span key={role} className="rounded-full bg-accent/15 px-2 py-0.5 text-[11px] font-medium text-accent">
                  {ROLE_LABELS[role]}
                </span>
              ))}
            </p>
          </div>
          <Link
            href="/ajustes"
            className="flex h-11 items-center gap-2 rounded-xl px-3 text-sm font-medium hover:bg-app-border/60"
          >
            <Settings aria-hidden size={20} strokeWidth={2} />
            <span className="hidden md:inline">Ajustes</span>
          </Link>
          <SignOutButton />
        </div>
      ) : null}
    </header>
  );
}
