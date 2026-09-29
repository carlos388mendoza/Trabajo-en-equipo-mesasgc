// Permisos: solo quien tiene "analiticas:ver" (admin y analítica).
import { NextResponse } from "next/server";

import { getAnalytics } from "@/lib/analytics/data";
import { guardApi } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await guardApi(request, "analiticas:ver");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const restaurantId = url.searchParams.get("restaurantId")?.trim() ?? "";
  const brand = url.searchParams.get("brand")?.trim() ?? "";
  if (restaurantId.length > 64 || brand.length > 100) {
    return NextResponse.json({ error: "El filtro no es válido." }, { status: 400 });
  }

  try {
    // El filtro de 14 días y de restaurante se aplica en getAnalytics.
    const analytics = await getAnalytics({
      restaurantId: restaurantId || null,
      brand,
    });
    return NextResponse.json(analytics);
  } catch (error) {
    console.error("Failed to load analytics", error);
    return NextResponse.json({ error: "No se pudieron cargar las estadísticas." }, { status: 500 });
  }
}
