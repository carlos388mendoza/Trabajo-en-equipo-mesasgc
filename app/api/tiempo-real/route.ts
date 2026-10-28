// Tiempo real sin servidor propio: acciones (POST) y sondeo de avisos (GET).
// La lógica está en `lib/realtime/http.ts`; aquí solo se conecta con Next.

import { handleRealtimeGet, handleRealtimePost } from "@/lib/realtime/http";

// Cada respuesta depende de la sesión y de la base: nunca se cachea.
export const dynamic = "force-dynamic";

export function GET(request: Request) {
  return handleRealtimeGet(request);
}

export function POST(request: Request) {
  return handleRealtimePost(request);
}
