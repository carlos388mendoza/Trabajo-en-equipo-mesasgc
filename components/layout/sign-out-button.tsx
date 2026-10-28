"use client";

// «Cerrar sesión», con dos cuidados del modo sin conexión:
//   - si en esta tablet quedan cambios del modo sencillo sin sincronizar, lo
//     dice antes (se perderían);
//   - borra la cola, las copias de la lista y la caché de páginas, para que la
//     siguiente persona que use la tablet no vea los datos de la anterior.
//
// La pregunta usa el diálogo propio de la app, no `window.confirm` (issue
// #107). El cierre de sesión en sí es la server action de siempre
// (`signOutAction`).

import { useRef, useState, type FormEvent } from "react";
import { LogOut } from "lucide-react";

import { signOutAction } from "@/app/login/actions";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { clearOfflineData, countAllPendingOperations } from "@/lib/offline/store";

export function SignOutButton() {
  const formRef = useRef<HTMLFormElement>(null);
  const confirmed = useRef(false);
  // null: cerrado; un número: abierto, con los cambios sin sincronizar.
  const [pending, setPending] = useState<number | null>(null);
  const [leaving, setLeaving] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    if (confirmed.current) return;
    event.preventDefault();
    setPending(await countAllPendingOperations());
  }

  async function confirm() {
    setLeaving(true);
    await clearOfflineData();
    confirmed.current = true;
    setPending(null);
    formRef.current?.requestSubmit();
  }

  return (
    <form ref={formRef} action={signOutAction} onSubmit={onSubmit}>
      <button
        type="submit"
        className="flex h-11 items-center gap-2 rounded-xl px-3 text-sm font-medium hover:bg-app-border/60"
      >
        <LogOut aria-hidden size={20} strokeWidth={2} />
        <span className="hidden md:inline">Cerrar sesión</span>
      </button>
      {pending !== null ? (
        <ConfirmDialog
          title={pending > 0 ? "¿Cerrar sesión con cambios sin sincronizar?" : "¿Seguro que quieres cerrar sesión?"}
          danger={pending > 0}
          pending={leaving}
          confirmLabel="Cerrar sesión"
          onCancel={() => setPending(null)}
          onConfirm={() => void confirm()}
        >
          {pending > 0 ? (
            <p>
              Hay {pending} {pending === 1 ? "cambio" : "cambios"} del modo sencillo sin sincronizar en esta tablet. Si cierras
              sesión ahora se pierden.
            </p>
          ) : null}
        </ConfirmDialog>
      ) : null}
    </form>
  );
}
