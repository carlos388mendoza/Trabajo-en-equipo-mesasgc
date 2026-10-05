"use client";

// «Cerrar sesión», con dos cuidados del modo sin conexión:
//   - si en esta tablet quedan cambios del modo sencillo sin sincronizar, lo
//     dice antes (se perderían);
//   - borra la cola, las copias de la lista y la caché de páginas, para que la
//     siguiente persona que use la tablet no vea los datos de la anterior.
//
// El cierre de sesión en sí es la server action de siempre (`signOutAction`).

import { useRef, type FormEvent } from "react";
import { LogOut } from "lucide-react";

import { signOutAction } from "@/app/login/actions";
import { clearOfflineData, countAllPendingOperations } from "@/lib/offline/store";

export function SignOutButton() {
  const confirmed = useRef(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (confirmed.current) return;
    event.preventDefault();
    const form = event.currentTarget;
    const pending = await countAllPendingOperations();
    if (pending > 0 && !window.confirm(
      `Hay ${pending} ${pending === 1 ? "cambio" : "cambios"} del modo sencillo sin sincronizar en esta tablet. ` +
      "Si cierras sesión ahora se pierden. ¿Cerrar sesión de todos modos?",
    )) return;
    await clearOfflineData();
    confirmed.current = true;
    form.requestSubmit();
  }

  return (
    <form action={signOutAction} onSubmit={onSubmit}>
      <button
        type="submit"
        className="flex h-11 items-center gap-2 rounded-xl px-3 text-sm font-medium hover:bg-app-border/60"
      >
        <LogOut aria-hidden size={20} strokeWidth={2} />
        <span className="hidden md:inline">Cerrar sesión</span>
      </button>
    </form>
  );
}
