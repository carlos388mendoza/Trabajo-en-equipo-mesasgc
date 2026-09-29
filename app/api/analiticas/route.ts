// TODO(auth): validar sesión Better Auth y filtrar estadísticas por permisos del usuario.
// TODO(metrics): agregar tiempo hasta avisar cuando `called_at` esté disponible en testing.
import { NextResponse } from "next/server";

import { getAnalytics } from "@/lib/analytics/data";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const restaurantId = url.searchParams.get("restaurantId")?.trim() ?? "";
  const brand = url.searchParams.get("brand")?.trim() ?? "";
  if (restaurantId.length > 64 || brand.length > 100) {
    return NextResponse.json({ error: "El filtro no es válido." }, { status: 400 });
  }

  try {
    // getAnalytics filtra en la consulta por los últimos 14 días de Honduras
    // (y el período anterior para comparar), con estado sentado y restaurante.
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
