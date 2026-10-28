// Límite de intentos FALLIDOS de inicio de sesión, por correo y por conexión.
//
// Lo usan los dos caminos por los que se entra:
//  - el formulario de /login (server action `signInAction`), que llama a
//    Better Auth por dentro y NO pasa por la ruta HTTP;
//  - la ruta HTTP `/api/auth/sign-in/email` (app/api/auth/[...all]/route.ts).
//
// Solo cuentan los intentos FALLIDOS (correo o contraseña incorrectos). Entrar
// bien no suma, y además borra los fallos de ese correo. Así todas las tablets
// de un restaurante, que salen a internet con la MISMA IP, pueden volver a
// entrar a la vez (por ejemplo tras rotar BETTER_AUTH_SECRET) sin bloquearse.
//
//  - Por correo: 5 fallos en 15 minutos bloquean ESE correo 15 minutos.
//  - Por conexión (IP): 30 fallos en 15 minutos, más alto a propósito por las
//    tablets que comparten IP.
//
// En la base (`login_failures`), no en memoria: en Vercel cada petición puede
// caer en una instancia distinta y una cuenta en memoria no se compartiría.
// Una fila por fallo; las de más de 15 minutos se borran de vez en cuando.

import { and, count, eq, gte, lt, min } from "drizzle-orm";

import { db } from "@/lib/db";
import { loginFailures } from "@/lib/db/schema";

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_FAILURES_EMAIL = 5;
export const LOGIN_MAX_FAILURES_IP = 30;

const normalize = (email: string) => email.trim().toLowerCase();

export type LoginLimit = { blocked: false } | { blocked: true; message: string };

async function recent(column: typeof loginFailures.email | typeof loginFailures.ip, value: string, now: number) {
  const [row] = await db
    .select({ total: count(), oldest: min(loginFailures.createdAt) })
    .from(loginFailures)
    .where(and(eq(column, value), gte(loginFailures.createdAt, new Date(now - LOGIN_WINDOW_MS))));
  return { total: row?.total ?? 0, oldest: row?.oldest ? new Date(row.oldest).getTime() : now };
}

/** ¿Hay que rechazar este intento antes de mirar la contraseña? */
export async function checkLoginLimit(email: string, ip: string, now = Date.now()): Promise<LoginLimit> {
  if (email) {
    const byEmail = await recent(loginFailures.email, normalize(email), now);
    if (byEmail.total >= LOGIN_MAX_FAILURES_EMAIL) {
      return { blocked: true, message: `Demasiados intentos fallidos con este correo. Espera ${minutesLeft(byEmail.oldest, now)} y vuelve a probar.` };
    }
  }
  const byIp = await recent(loginFailures.ip, ip, now);
  if (byIp.total >= LOGIN_MAX_FAILURES_IP) {
    return { blocked: true, message: `Demasiados intentos fallidos desde esta conexión. Espera ${minutesLeft(byIp.oldest, now)} y vuelve a probar.` };
  }
  return { blocked: false };
}

/** Un intento con correo o contraseña incorrectos. */
export async function recordLoginFailure(email: string, ip: string, now = Date.now()): Promise<void> {
  await db.insert(loginFailures).values({ email: normalize(email), ip, createdAt: new Date(now) });
  // De vez en cuando se borran los que ya no cuentan (la tabla no crece).
  if (Math.random() < 0.05) await db.delete(loginFailures).where(lt(loginFailures.createdAt, new Date(now - LOGIN_WINDOW_MS)));
}

/** Entró bien: se olvidan los fallos de ese correo (los de la IP se quedan). */
export async function recordLoginSuccess(email: string): Promise<void> {
  if (email) await db.delete(loginFailures).where(eq(loginFailures.email, normalize(email)));
}

/**
 * La IP del cliente. En Vercel llega en `X-Forwarded-For` (la primera es la
 * del cliente; Vercel la sobrescribe, no la añade) y en `X-Real-IP`. Se valida
 * que parezca una IP para no guardar basura. Aunque alguien la falsee, el
 * límite por CORREO sigue valiendo.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded && /^[0-9a-fA-F.:]{3,45}$/.test(forwarded)) return forwarded;
  const real = headers.get("x-real-ip")?.trim();
  if (real && /^[0-9a-fA-F.:]{3,45}$/.test(real)) return real;
  return "desconocida";
}

function minutesLeft(oldest: number, now: number): string {
  const ms = Math.max(0, oldest + LOGIN_WINDOW_MS - now);
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  return minutes === 1 ? "1 minuto" : `${minutes} minutos`;
}

/** Solo para las pruebas: borra todos los fallos guardados. */
export async function resetLoginLimitForTests(): Promise<void> {
  await db.delete(loginFailures);
}

