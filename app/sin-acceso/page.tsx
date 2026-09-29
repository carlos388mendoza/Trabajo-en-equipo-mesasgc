import Link from "next/link";
import { ShieldX } from "lucide-react";

import { requirePage } from "@/lib/auth/session";

// A dónde se redirige cuando alguien CON sesión intenta entrar donde no le
// toca (sin sesión se va a /login). Las API routes responden 403 en JSON.

export const metadata = { title: "Sin acceso · Table Waitlist" };

export default async function SinAccesoPage() {
  const user = await requirePage("/sin-acceso");
  return (
    <div className="mx-auto mt-10 max-w-md rounded-2xl border border-app-border bg-panel p-8 text-center text-panel-text shadow-sm">
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-estado-ocupada/10 text-estado-ocupada">
        <ShieldX aria-hidden size={28} strokeWidth={2} />
      </span>
      <h1 className="mt-4 text-xl font-bold">No tienes acceso</h1>
      <p className="mt-2 text-sm text-panel-muted">
        {user.name}, tu usuario no tiene permiso para ver esa página. Si crees que
        es un error, pídele a un administrador que revise tus roles.
      </p>
      <Link
        href="/inicio"
        className="mt-6 inline-flex h-11 items-center rounded-xl bg-accent px-5 text-sm font-semibold text-accent-text hover:bg-accent/85"
      >
        Ir a mi inicio
      </Link>
    </div>
  );
}
