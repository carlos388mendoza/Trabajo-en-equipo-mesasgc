import Image from "next/image";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/auth/login-form";
import { getCurrentUser, safeNext } from "@/lib/auth/session";

// Única página pública (ver `proxy.ts`). Si ya hay sesión, no tiene sentido
// volver a entrar: a /inicio (o a donde se iba).

export const metadata = { title: "Entrar · Table Waitlist" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const [{ next }, user] = await Promise.all([searchParams, getCurrentUser()]);
  const target = safeNext(next);
  if (user) redirect(target ?? "/inicio");

  return (
    <div className="flex min-h-[calc(100vh-8rem)] items-center justify-center py-6">
      <div className="w-full max-w-sm rounded-3xl border border-app-border bg-panel px-6 py-8 text-panel-text shadow-lg sm:px-8">
        <div className="flex flex-col items-center text-center">
          {/* Cuadrado 1:1 como el archivo, así `rounded-full` lo recorta en
              círculo sin deformarlo. */}
          <Image
            src="/brand/grupo-comidas-logo-circular.png"
            alt="Grupo Comidas"
            width={160}
            height={160}
            priority
            className="h-40 w-40 rounded-full object-cover shadow-md ring-1 ring-app-border"
          />
          <h1 className="mt-4 text-2xl font-bold tracking-tight">Table Waitlist</h1>
          <p className="mt-1 text-sm text-panel-muted">Entra con tu correo de trabajo.</p>
        </div>
        <LoginForm next={target ?? ""} />
      </div>
    </div>
  );
}
