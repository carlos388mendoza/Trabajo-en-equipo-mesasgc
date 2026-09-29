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

export function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (PUBLIC_PAGES.has(pathname)) return NextResponse.next();
  if (PUBLIC_APIS.has(pathname)) return NextResponse.next();
  if (getSessionCookie(request)) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Tu sesión terminó. Vuelve a entrar." }, { status: 401 });
  }

  const login = request.nextUrl.clone();
  login.pathname = "/login";
  login.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname + search)}`;
  return NextResponse.redirect(login);
}

export const config = {
  // Todo menos los endpoints de Better Auth (el propio login), los archivos
  // estáticos de Next, los logos de /brand y los íconos de la pestaña: sin
  // esta exclusión el login no podría ni cargar su logo.
  matcher: [
    "/((?!api/auth|_next/static|_next/image|brand/|icon|apple-icon|favicon\\.ico).*)",
  ],
};
