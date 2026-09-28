// Endpoints de Better Auth (/api/auth/sign-in/email, /api/auth/sign-out,
// /api/auth/get-session...). El registro (/sign-up) responde con error:
// está desactivado en `lib/auth/auth.ts`.

import { toNextJsHandler } from "better-auth/next-js";

import { getAuth } from "@/lib/auth/auth";

// El handler se pide en cada petición y no al importar, para que el build no
// necesite BETTER_AUTH_SECRET.
export async function GET(request: Request) {
  return toNextJsHandler(getAuth()).GET(request);
}

export async function POST(request: Request) {
  return toNextJsHandler(getAuth()).POST(request);
}
