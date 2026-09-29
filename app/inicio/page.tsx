import Link from "next/link";
import { redirect } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { ChartColumn, ChevronRight, ShieldCheck, Store } from "lucide-react";

import { type Destination, ROLE_LABELS, destinationsFor } from "@/lib/auth/rbac";
import { requirePage } from "@/lib/auth/session";
import { listRestaurants } from "@/lib/auth/users";

// A dónde entra cada uno después del login. Con un solo destino se le lleva
// directo (admin a /admin, un host a su modo rápido, analítica a
// /analiticas); con varios roles o restaurantes, elige aquí.

export const metadata = { title: "Inicio · Table Waitlist" };

const ICONS: Record<Destination["kind"], LucideIcon> = {
  admin: ShieldCheck,
  restaurante: Store,
  analiticas: ChartColumn,
};

export default async function InicioPage() {
  const user = await requirePage("/inicio");
  const destinations = destinationsFor(user, await listRestaurants());

  if (destinations.length === 1) redirect(destinations[0].href);

  return (
    <div className="mx-auto mt-6 max-w-2xl">
      <h1 className="text-2xl font-bold">Hola, {user.name}</h1>
      <p className="mt-1 text-sm text-app-muted">
        {user.roles.map((r) => ROLE_LABELS[r]).join(" · ")}
      </p>

      {destinations.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-app-border bg-panel p-5 text-sm text-panel-text">
          Tu usuario todavía no tiene acceso a ninguna pantalla. Pídele a un
          administrador que te asigne un rol o un restaurante.
        </p>
      ) : (
        <>
          <p className="mt-6 text-sm font-medium">¿A dónde quieres entrar?</p>
          <ul className="mt-3 space-y-3">
            {destinations.map((d) => {
              const Icon = ICONS[d.kind];
              return (
                <li key={d.href}>
                  <Link
                    href={d.href}
                    className="flex min-h-20 items-center gap-4 rounded-2xl border border-app-border bg-panel p-4 text-panel-text shadow-sm transition hover:border-accent/60 active:scale-[0.99]"
                  >
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent/15 text-accent">
                      <Icon aria-hidden size={24} strokeWidth={2} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-semibold">{d.label}</span>
                      <span className="block text-sm text-panel-muted">{d.description}</span>
                    </span>
                    <ChevronRight aria-hidden size={20} strokeWidth={2} className="text-panel-muted" />
                  </Link>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
