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
// En memoria del proceso (`globalThis`, para que la action y la ruta compartan
// la misma cuenta aunque Next las empaquete por separado): basta para un solo
// servidor, que es lo que hay en Railway. Si un día hay varias instancias, hay
// que llevarlo a la base o a Redis.

export const LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const LOGIN_MAX_FAILURES_EMAIL = 5;
export const LOGIN_MAX_FAILURES_IP = 30;

type Store = Map<string, number[]>;
const g = globalThis as typeof globalThis & { __twLoginLimit?: Store };
const store: Store = (g.__twLoginLimit ??= new Map());

function recent(key: string, now: number): number[] {
  const list = (store.get(key) ?? []).filter((t) => now - t < LOGIN_WINDOW_MS);
  if (list.length) store.set(key, list);
  else store.delete(key);
  return list;
}

const emailKey = (email: string) => `correo:${email.trim().toLowerCase()}`;
const ipKey = (ip: string) => `ip:${ip}`;

export type LoginLimit = { blocked: false } | { blocked: true; message: string };

/** ¿Hay que rechazar este intento antes de mirar la contraseña? */
export function checkLoginLimit(email: string, ip: string, now = Date.now()): LoginLimit {
  const byEmail = email ? recent(emailKey(email), now) : [];
  if (byEmail.length >= LOGIN_MAX_FAILURES_EMAIL) {
    return { blocked: true, message: `Demasiados intentos fallidos con este correo. Espera ${minutesLeft(byEmail, now)} y vuelve a probar.` };
  }
  const byIp = recent(ipKey(ip), now);
  if (byIp.length >= LOGIN_MAX_FAILURES_IP) {
    return { blocked: true, message: `Demasiados intentos fallidos desde esta conexión. Espera ${minutesLeft(byIp, now)} y vuelve a probar.` };
  }
  return { blocked: false };
}

/** Un intento con correo o contraseña incorrectos. */
export function recordLoginFailure(email: string, ip: string, now = Date.now()): void {
  for (const key of [email ? emailKey(email) : null, ipKey(ip)]) {
    if (!key) continue;
    store.set(key, [...recent(key, now), now]);
  }
}

/** Entró bien: se olvidan los fallos de ese correo (los de la IP se quedan). */
export function recordLoginSuccess(email: string): void {
  if (email) store.delete(emailKey(email));
}

/**
 * La IP del cliente. En Railway llega en `X-Forwarded-For` (la primera es la
 * del cliente). Se valida que parezca una IP para no guardar basura. Aunque
 * alguien la falsee, el límite por CORREO sigue valiendo.
 */
export function clientIp(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded && /^[0-9a-fA-F.:]{3,45}$/.test(forwarded)) return forwarded;
  const real = headers.get("x-real-ip")?.trim();
  if (real && /^[0-9a-fA-F.:]{3,45}$/.test(real)) return real;
  return "desconocida";
}

function minutesLeft(list: number[], now: number): string {
  const ms = Math.max(0, list[0] + LOGIN_WINDOW_MS - now);
  const min = Math.max(1, Math.ceil(ms / 60_000));
  return min === 1 ? "1 minuto" : `${min} minutos`;
}

/** Solo para las pruebas. */
export function resetLoginLimitForTests(): void {
  store.clear();
}
