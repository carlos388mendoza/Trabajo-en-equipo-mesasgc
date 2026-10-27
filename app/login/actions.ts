"use server";

// Entrar y salir.
//
// El login es una server action que llama a Better Auth desde el servidor; el
// plugin `nextCookies` (ver `lib/auth/auth.ts`) deja la cookie de sesión.
// Los errores se traducen a mensajes claros en español, sin decir nunca si el
// fallo fue el correo o la contraseña (eso ayudaría a adivinar cuentas).

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { APIError } from "better-auth/api";

import { INACTIVE_USER_MESSAGE, getAuth } from "@/lib/auth/auth";
import { checkLoginLimit, clientIp, recordLoginFailure, recordLoginSuccess } from "@/lib/auth/login-limit";
import { safeNext } from "@/lib/auth/session";
import { WEAK_PASSWORD_COOKIE, isPublicDeployment, passwordWeakness } from "@/lib/auth/weak-passwords";
import { logServerError } from "@/lib/log";

export type LoginState = { error: string | null; email: string };

const WRONG_CREDENTIALS = "Correo o contraseña incorrectos";

export async function signInAction(_prev: LoginState, formData: FormData): Promise<LoginState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(String(formData.get("next") ?? ""));

  if (!email || !password) {
    return { error: "Escribe tu correo y tu contraseña.", email };
  }

  // Límite de intentos fallidos por correo y por conexión (ver
  // `lib/auth/login-limit.ts`): este formulario no pasa por la ruta HTTP de
  // Better Auth, así que el límite se mira aquí.
  const requestHeaders = await headers();
  const ip = clientIp(requestHeaders);
  const limit = checkLoginLimit(email, ip);
  if (limit.blocked) return { error: limit.message, email };

  try {
    await getAuth().api.signInEmail({ body: { email, password }, headers: requestHeaders });
    recordLoginSuccess(email);
    await rememberWeakPassword(password);
  } catch (error) {
    if (error instanceof APIError) {
      const code = (error.body as { code?: string } | undefined)?.code;
      if (code === "USER_INACTIVE") return { error: INACTIVE_USER_MESSAGE, email };
      if (error.statusCode === 429) {
        return { error: "Demasiados intentos. Espera un momento y vuelve a probar.", email };
      }
      // Correo inexistente, contraseña mala, correo mal escrito...: el mismo
      // mensaje para todo.
      if (error.statusCode === 401 || error.statusCode === 400) {
        recordLoginFailure(email, ip);
        return { error: WRONG_CREDENTIALS, email };
      }
    }
    logServerError("[login] error inesperado", error);
    return { error: "No se pudo iniciar sesión. Inténtalo de nuevo.", email };
  }

  // Fuera del try: `redirect` funciona lanzando una excepción.
  redirect(next ?? "/inicio");
}

/**
 * En producción, entrar con una contraseña pública (la del código) o muy
 * débil deja un aviso en el encabezado y una línea en el log, sin el correo
 * (ver `lib/auth/weak-passwords.ts`). No impide entrar.
 */
async function rememberWeakPassword(password: string): Promise<void> {
  if (!isPublicDeployment()) return;
  const jar = await cookies();
  const weakness = passwordWeakness(password);
  if (!weakness) {
    jar.delete(WEAK_PASSWORD_COOKIE);
    return;
  }
  jar.set(WEAK_PASSWORD_COOKIE, weakness, { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 12 * 60 * 60 });
  console.warn(`[login] se entró a producción con una contraseña ${weakness === "publica" ? "que está en el código" : "muy débil"}`);
}

export async function signOutAction(): Promise<void> {
  (await cookies()).delete(WEAK_PASSWORD_COOKIE);
  try {
    await getAuth().api.signOut({ headers: await headers() });
  } catch {
    // Sin sesión que cerrar: da igual, se va al login de todos modos.
  }
  redirect("/login");
}
