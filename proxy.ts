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

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

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
