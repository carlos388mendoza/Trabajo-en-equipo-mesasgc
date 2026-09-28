// Capa de acceso a datos (DAL) de la sesión, para el código de Next.
//
// Es la comprobación de verdad. La guía de autenticación de Next 16 lo dice
// así: `proxy.ts` solo mira si hay cookie (comprobación optimista) y cada
// página, server action y route handler verifica aquí la sesión y el permiso.
// Una server action es un POST a su página: si un cambio del matcher del
// proxy la dejara fuera, esta capa seguiría protegiéndola.
//
// El usuario se lee de la base en cada petición (con `cache` para no repetir
// dentro del mismo render): si un admin lo desactiva o le quita un rol, deja
// de valer al momento, no cuando caduque la cookie.

import { cache } from "react";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";

import { getAuth } from "./auth";
import { type Action, can } from "./rbac";
import { type AuthUser, loadAuthUser } from "./users";

export const NO_SESSION_MESSAGE = "Tu sesión terminó. Vuelve a entrar.";
export const FORBIDDEN_MESSAGE = "No tienes permiso para hacer esto.";

async function userFromHeaders(requestHeaders: Headers): Promise<AuthUser | null> {
  const result = await getAuth().api.getSession({ headers: requestHeaders });
  if (!result) return null;
  const authUser = await loadAuthUser(result.user.id);
  return authUser && authUser.active ? authUser : null;
}

/** Quién está conectado, o null. Memorizado dentro de cada render. */
export const getCurrentUser = cache(async (): Promise<AuthUser | null> => {
  return userFromHeaders(await headers());
});

/** Solo acepta rutas propias: evita redirigir a otra web con `?next=`. */
export function safeNext(next: string | null | undefined): string | null {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return null;
  }
  return next;
}

/**
 * Para páginas: sin sesión, a /login (y vuelta a `path` después); sin
 * permiso, a /sin-acceso.
 */
export async function requirePage(
  path: string,
  action?: Action,
  restaurantId?: string,
): Promise<AuthUser> {
  const current = await getCurrentUser();
  if (!current) redirect(`/login?next=${encodeURIComponent(path)}`);
  if (action && !can(current, action, restaurantId)) redirect("/sin-acceso");
  return current;
}

export type Guard = { ok: true; user: AuthUser } | { ok: false; error: string };

/** Para server actions: devuelve el error como mensaje, no redirige. */
export async function guardAction(action: Action, restaurantId?: string): Promise<Guard> {
  const current = await getCurrentUser();
  if (!current) return { ok: false, error: NO_SESSION_MESSAGE };
  if (!can(current, action, restaurantId)) return { ok: false, error: FORBIDDEN_MESSAGE };
  return { ok: true, user: current };
}

export type ApiGuard = { ok: true; user: AuthUser } | { ok: false; response: NextResponse };

/** Para API routes: 401 sin sesión, 403 sin permiso. */
export async function guardApi(
  request: Request,
  action: Action,
  restaurantId?: string,
): Promise<ApiGuard> {
  const current = await userFromHeaders(request.headers);
  if (!current) {
    return { ok: false, response: NextResponse.json({ error: NO_SESSION_MESSAGE }, { status: 401 }) };
  }
  if (!can(current, action, restaurantId)) {
    return { ok: false, response: NextResponse.json({ error: FORBIDDEN_MESSAGE }, { status: 403 }) };
  }
  return { ok: true, user: current };
}
