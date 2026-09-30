"use client";

// Formulario de /login. Envía a la server action `signInAction`, que es la que
// habla con Better Auth; aquí solo se pinta y se muestra el error.

import { useActionState, useState } from "react";
import { Eye, EyeOff, LogIn, TriangleAlert } from "lucide-react";

import { type LoginState, signInAction } from "@/app/login/actions";
import { ICON_STROKE } from "@/components/editor/icons";

const INPUT =
  "mt-1 h-12 w-full rounded-xl border border-app-border bg-panel px-4 text-base text-panel-text placeholder:text-panel-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30";

export function LoginForm({ next }: { next: string }) {
  const [state, formAction, pending] = useActionState<LoginState, FormData>(signInAction, {
    error: null,
    email: "",
  });
  const [visible, setVisible] = useState(false);

  return (
    <form action={formAction} className="mt-6 space-y-4" noValidate>
      <input type="hidden" name="next" value={next} />

      {state.error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-estado-ocupada/40 bg-estado-ocupada/10 px-3 py-2.5 text-sm"
        >
          <TriangleAlert aria-hidden size={18} strokeWidth={ICON_STROKE} className="mt-0.5 shrink-0 text-estado-ocupada" />
          {state.error}
        </p>
      ) : null}

      <label className="block text-sm font-medium">
        Correo
        <input
          name="email"
          type="email"
          autoComplete="username"
          inputMode="email"
          required
          defaultValue={state.email}
          placeholder="nombre@grupocomidas.com"
          className={INPUT}
        />
      </label>

      <label className="block text-sm font-medium">
        Contraseña
        <span className="relative mt-1 block">
          <input
            name="password"
            type={visible ? "text" : "password"}
            autoComplete="current-password"
            required
            className={`${INPUT} mt-0 pr-12`}
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            aria-label={visible ? "Ocultar contraseña" : "Mostrar contraseña"}
            aria-pressed={visible}
            className="absolute inset-y-0 right-1 my-auto flex h-10 w-10 items-center justify-center rounded-lg text-panel-muted hover:bg-app-border/60 hover:text-panel-text"
          >
            {visible ? (
              <EyeOff aria-hidden size={20} strokeWidth={ICON_STROKE} />
            ) : (
              <Eye aria-hidden size={20} strokeWidth={ICON_STROKE} />
            )}
          </button>
        </span>
      </label>

      <button
        type="submit"
        disabled={pending}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-accent text-base font-semibold text-accent-text transition hover:bg-accent/85 active:scale-[0.99] disabled:opacity-60"
      >
        <LogIn aria-hidden size={20} strokeWidth={ICON_STROKE} />
        {pending ? "Entrando…" : "Entrar"}
      </button>
    </form>
  );
}
