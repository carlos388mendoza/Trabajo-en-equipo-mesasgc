import Link from "next/link";
import { LayoutGrid, Zap } from "lucide-react";

import { AdminUsers } from "@/components/admin/admin-users";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/auth";
import { requirePage } from "@/lib/auth/session";
import { listRestaurants, listUsers } from "@/lib/auth/users";

// Solo admin ("usuarios:gestionar"). No hay registro público: los usuarios se
// crean aquí. Cada acción de la página vuelve a comprobar el permiso en
// `app/admin/actions.ts`.

export const metadata = { title: "Administración · Table Waitlist" };

export default async function AdminPage() {
  const me = await requirePage("/admin", "usuarios:gestionar");
  const [users, restaurants] = await Promise.all([listUsers(), listRestaurants()]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Administración</h1>
        <p className="text-sm text-app-muted">Usuarios, roles y acceso a los restaurantes.</p>
      </div>

      <AdminUsers
        users={users}
        restaurants={restaurants}
        currentUserId={me.id}
        minPasswordLength={MIN_PASSWORD_LENGTH}
      />

      <section className="rounded-2xl border border-app-border bg-panel p-5 text-panel-text shadow-sm">
        <h2 className="text-lg font-semibold">Restaurantes</h2>
        <p className="text-sm text-panel-muted">Como admin puedes entrar a todos.</p>
        <ul className="mt-4 grid gap-3 sm:grid-cols-2">
          {restaurants.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-app-border p-3">
              <span className="font-medium">{r.name}</span>
              <span className="flex gap-2">
                <Link
                  href={`/restaurante/${r.id}/rapido`}
                  className="flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium hover:bg-app-border/60"
                >
                  <Zap aria-hidden size={16} strokeWidth={2} />
                  Modo sencillo
                </Link>
                <Link
                  href={`/restaurante/${r.id}/editor`}
                  className="flex h-10 items-center gap-1.5 rounded-lg px-3 text-sm font-medium hover:bg-app-border/60"
                >
                  <LayoutGrid aria-hidden size={16} strokeWidth={2} />
                  Plano
                </Link>
              </span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
