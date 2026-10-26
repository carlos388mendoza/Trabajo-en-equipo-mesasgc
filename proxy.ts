// Proxy de Next 16 (antes `middleware.ts`): la primera barrera, OPTIMISTA.
//
// Solo mira si llega la cookie de sesión, sin consultar la base de datos,
// como recomienda la guía de autenticación de Next: el proxy corre en cada
// petición, también en los prefetch, y una consulta aquí lo haría lento.
//
// - Sin cookie, una página redirige a /login (y vuelve después con `?next=`).
// - Sin cookie, una API responde 401.
//
// Que la cookie sea válida, que el usuario esté activo y que tenga permiso lo
// comprueba `lib/auth/session.ts` en cada página, server action y API route.
// El proxy no basta solo: una cookie falsa o caducada pasa por aquí.

import { type NextRequest, NextResponse } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const PUBLIC_PAGES = new Set(["/login"]);
const PUBLIC_APIS = new Set(["/api/health"]);

// ---------------------------------------------------------------------------
// Límite de intentos de inicio de sesión (issue de seguridad).
//
// Solo se aplica a la ruta de Better Auth que recibe la contraseña. Se cuenta
// por IP y por correo: así un atacante no puede probar muchas contraseñas para
// un mismo correo desde una IP, ni distribuir el ataque entre correos desde la
// misma IP. Es en memoria del proceso: suficiente para un solo servidor
// (Railway), que es lo que tenemos hoy.
// ---------------------------------------------------------------------------
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_LIMIT_IP = 10;
const LOGIN_LIMIT_EMAIL = 5;
const attempts = new Map<string, number[]>();

function prune(key: string, now: number) {
  const list = attempts.get(key);
  if (!list) return [];
  const fresh = list.filter((t) => now - t < LOGIN_WINDOW_MS);
  if (fresh.length === 0) attempts.delete(key);
  else attempts.set(key, fresh);
  return fresh;
}

function clientIp(request: NextRequest): string {
  // En Railway llega la IP real en X-Forwarded-For. Se toma solo el primer
  // valor y se valida para no confiar en basura del cliente.
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (forwarded && /^[0-9a-fA-F.:]+$/.test(forwarded)) return forwarded;
  return request.headers.get("x-real-ip")?.trim() || "desconocida";
}

async function checkLoginLimit(request: NextRequest): Promise<NextResponse | null> {
  if (request.method !== "POST") return null;
  const pathname = request.nextUrl.pathname;
  if (!pathname.startsWith("/api/auth/sign-in")) return null;

  const now = Date.now();
  const ip = clientIp(request);
  let email = "";
  try {
    const cloned = request.clone();
    const body = await cloned.json().catch(() => null);
    if (body && typeof body.email === "string") email = body.email.trim().toLowerCase();
  } catch {
    // Si no se puede leer el cuerpo, se limita solo por IP.
  }

  const ipKey = `ip:${ip}`;
  const ipList = prune(ipKey, now);
  if (ipList.length >= LOGIN_LIMIT_IP) {
    return NextResponse.json(
      { error: "Demasiados intentos desde esta conexión. Espera 15 minutos." },
      { status: 429 },
    );
  }

  if (email) {
    const emailKey = `email:${email}`;
    const emailList = prune(emailKey, now);
    if (emailList.length >= LOGIN_LIMIT_EMAIL) {
      return NextResponse.json(
        { error: "Demasiados intentos para este correo. Espera 15 minutos." },
        { status: 429 },
      );
    }
    emailList.push(now);
    attempts.set(emailKey, emailList);
  }

  ipList.push(now);
  attempts.set(ipKey, ipList);
  return null;
}

// Cabeceras de seguridad aplicadas a todas las respuestas que pasan por el proxy.
// El CSP además del frame-ancestors: se mantiene deliberadamente permisivo en
// scripts y estilos porque Next 16 inyecta código en línea para la hidratación
// y el tema se aplica antes del primer pintado. Lo que se protege aquí es el
// clickjacking (frame-ancestors) y el sniffing de tipo.
function applySecurityHeaders(response: NextResponse) {
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  response.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains");
  const existingCsp = response.headers.get("Content-Security-Policy");
  if (!existingCsp || !existingCsp.includes("frame-ancestors")) {
    response.headers.set(
      "Content-Security-Policy",
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; connect-src 'self' ws: wss:; font-src 'self' data:; frame-ancestors 'self'",
    );
  }
}

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  // Límite de intentos de login antes de cualquier otra comprobación.
  const limited = await checkLoginLimit(request);
  if (limited) {
    applySecurityHeaders(limited);
    return limited;
  }

  let response: NextResponse;
  if (PUBLIC_PAGES.has(pathname)) response = NextResponse.next();
  else if (PUBLIC_APIS.has(pathname)) response = NextResponse.next();
  else if (getSessionCookie(request)) response = NextResponse.next();
  else if (pathname.startsWith("/api/")) {
    response = NextResponse.json({ error: "Tu sesión terminó. Vuelve a entrar." }, { status: 401 });
  } else {
    const login = request.nextUrl.clone();
    login.pathname = "/login";
    login.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
    response = NextResponse.redirect(login);
  }

  applySecurityHeaders(response);
  return response;
}

export const config = {
  // Todo menos los endpoints de Better Auth (el propio login), los archivos
  // estáticos de Next, los logos de /brand y los íconos de la pestaña: sin
  // esta exclusión el login no podría ni cargar su logo. `sw.js` (el service
  // worker del modo sencillo sin conexión) también: el navegador lo vuelve a
  // pedir por su cuenta para actualizarlo, y no lleva ningún dato.
  matcher: [
    "/((?!api/auth|_next/static|_next/image|brand/|icon|apple-icon|favicon\\.ico|sw\\.js$).*)",
  ],
};
