import Link from "next/link";
import { redirect } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { ChartColumn, ChevronRight, Clock, LayoutGrid, Map as MapIcon, Radar, ShieldCheck, Store, Users, Zap } from "lucide-react";

import { AutoRefresh } from "@/components/layout/auto-refresh";
import { BrandBadge } from "@/components/layout/restaurant-switcher";
import { type Destination, ROLE_LABELS, can, destinationsFor, landingFor } from "@/lib/auth/rbac";
import { requirePage } from "@/lib/auth/session";
import { listRestaurants } from "@/lib/auth/users";
import { ROLES } from "@/lib/db/enums";
import { getCountersWithWait, waitLevel } from "@/lib/map/counters";

// A dónde entra cada uno después del login (ver `landingFor`): el admin al
// mapa general, analitica a las estadísticas y un host con un solo
// restaurante a su modo rápido. Con varios roles o varios restaurantes, elige
// aquí.
//
// Un host con varios restaurantes (el piloto: un usuario para los 4 locales
// de Denny's y Pizza Hut) ve una tarjeta por restaurante con cuántos clientes
// esperan y la espera media, y entra desde ahí al modo sencillo, al completo
// (editor) o al plano en vivo. Los números se refrescan solos cada 30 s.

export const metadata = { title: "Inicio · Table Waitlist" };

const ICONS: Record<Destination["kind"], LucideIcon> = {
  admin: ShieldCheck,
  restaurante: Store,
  analiticas: ChartColumn,
  mapa: MapIcon,
};

export default async function InicioPage() {
  const user = await requirePage("/inicio");
  const restaurants = await listRestaurants();
  const destinations = destinationsFor(user, restaurants);

  const landing = landingFor(user, destinations);
  if (landing) redirect(landing);

  // Los suyos, activos y con permiso: los mismos que las tarjetas de destino.
  const mine = user.roles.includes(ROLES.RESTAURANTE)
    ? restaurants.filter((r) => user.restaurantIds.includes(r.id) && can(user, "rapido:ver", r.id))
    : [];
  const counters = mine.length > 0 ? await getCountersWithWait(mine.map((r) => r.id)) : [];
  const others = destinations.filter((d) => d.kind !== "restaurante");

  return (
    <div className="mx-auto mt-6 max-w-5xl">
      <h1 className="text-2xl font-bold">Hola, {user.name}</h1>
      <p className="mt-1 text-sm text-app-muted">
        {user.roles.map((r) => ROLE_LABELS[r]).join(" · ")}
      </p>

      {destinations.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-app-border bg-panel p-5 text-sm text-panel-text">
          Tu usuario todavía no tiene acceso a ninguna pantalla. Pídele a un
          administrador que te asigne un rol o un restaurante.
        </p>
      ) : null}

      {mine.length > 0 ? (
        <section aria-labelledby="mis-restaurantes" className="mt-6">
          <AutoRefresh />
          <h2 id="mis-restaurantes" className="text-sm font-medium">
            {mine.length === 1 ? "Tu restaurante" : `Tus ${mine.length} restaurantes`}
          </h2>
          <ul className="mt-3 grid gap-3 sm:grid-cols-2">
            {mine.map((r) => {
              const c = counters.find((x) => x.restaurantId === r.id);
              const waiting = c?.waiting ?? 0;
              const minutes = c?.minutes ?? 0;
              const level = waitLevel(minutes);
              return (
                <li
                  key={r.id}
                  className="flex flex-col gap-3 rounded-2xl border border-app-border bg-panel p-4 text-panel-text shadow-sm"
                  style={{ borderTopColor: r.brand?.accentColor, borderTopWidth: 4 }}
                >
                  <div className="flex items-center gap-3">
                    <BrandBadge brand={r.brand} size={40} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-semibold">{r.name}</p>
                      <p className="truncate text-sm text-panel-muted">{[r.brand?.name, r.city].filter(Boolean).join(" · ")}</p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-end gap-x-5 gap-y-1">
                    <p className="flex items-center gap-2">
                      <Users aria-hidden size={20} strokeWidth={2} className="text-panel-muted" />
                      <span className="text-3xl font-bold tabular-nums">{waiting}</span>
                      <span className="text-sm text-panel-muted">{waiting === 1 ? "grupo esperando" : "grupos esperando"}</span>
                    </p>
                    <p
                      className={`flex items-center gap-1.5 text-sm font-medium ${
                        level === "critica" ? "text-critica" : level === "alerta" ? "text-alerta" : "text-panel-muted"
                      }`}
                    >
                      <Clock aria-hidden size={16} strokeWidth={2} />
                      {waiting > 0 ? `${minutes} ${minutes === 1 ? "minuto" : "minutos"} de espera media` : "sin espera"}
                    </p>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <ModeLink href={`/restaurante/${r.id}/rapido`} icon={Zap} label="Modo sencillo" primary />
                    <ModeLink href={`/restaurante/${r.id}/editor`} icon={LayoutGrid} label="Modo completo" />
                    <ModeLink href={`/restaurante/${r.id}/mapa`} icon={Radar} label="Plano en vivo" />
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      {others.length > 0 ? (
        <>
          <p className="mt-6 text-sm font-medium">{mine.length > 0 ? "También puedes entrar a" : "¿A dónde quieres entrar?"}</p>
          <ul className="mt-3 space-y-3">
            {others.map((d) => {
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
      ) : null}
    </div>
  );
}

function ModeLink({ href, icon: Icon, label, primary }: { href: string; icon: LucideIcon; label: string; primary?: boolean }) {
  return (
    <Link
      href={href}
      className={`flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-xl px-2 py-1.5 text-center text-xs font-semibold transition active:scale-[0.98] ${
        primary ? "bg-accent text-accent-text hover:bg-accent/85" : "border border-app-border hover:bg-app-border/60"
      }`}
    >
      <Icon aria-hidden size={18} strokeWidth={2} />
      {label}
    </Link>
  );
}
