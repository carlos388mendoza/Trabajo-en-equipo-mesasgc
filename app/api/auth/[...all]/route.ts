// Endpoints de Better Auth (/api/auth/sign-in/email, /api/auth/sign-out,
// /api/auth/get-session...). El registro (/sign-up) responde con error:
// está desactivado en `lib/auth/auth.ts`.

import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "@/lib/auth/auth";
import { checkLoginLimit, clientIp, recordLoginFailure, recordLoginSuccess } from "@/lib/auth/login-limit";

// El handler se pide en cada petición y no al importar, para que el build no
// necesite BETTER_AUTH_SECRET.
export async function GET(request: Request) {
  return toNextJsHandler(getAuth()).GET(request);
}

export async function POST(request: Request) {
  const handler = toNextJsHandler(getAuth()).POST;
  if (!new URL(request.url).pathname.endsWith("/sign-in/email")) return handler(request);

  // Inicio de sesión por la ruta HTTP: el mismo límite de intentos fallidos
  // que el formulario de /login (ver `lib/auth/login-limit.ts`).
  let email = "";
  try {
    const body = (await request.clone().json()) as { email?: unknown };
    if (typeof body?.email === "string") email = body.email.trim().toLowerCase();
  } catch {
    // Sin cuerpo legible: Better Auth contestará el error; se limita por IP.
  }
  const ip = clientIp(request.headers);
  const limit = await checkLoginLimit(email, ip);
  if (limit.blocked) {
    return Response.json({ code: "TOO_MANY_ATTEMPTS", message: limit.message }, { status: 429 });
  }
  const response = await handler(request);
  if (response.status === 401) await recordLoginFailure(email, ip);
  else if (response.ok) await recordLoginSuccess(email);
  return response;
}
