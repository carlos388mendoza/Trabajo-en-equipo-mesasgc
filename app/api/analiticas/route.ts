// Permisos: solo quien tiene "analiticas:ver" (admin y analítica).
//
// Nombres del top 10: el admin los ve siempre; analítica solo si la dirección
// lo permite en /admin → «Configuración» (por defecto, no: ve «Cliente 1
// (A. G.)»). Se enmascara AQUÍ, en el servidor: ocultarlo en el navegador no
// protegería nada, porque los nombres irían en la respuesta.
import { NextResponse } from "next/server";

import { getAnalytics } from "@/lib/analytics/data";
import { guardApi } from "@/lib/auth/session";
import { canSeeTopCustomerNames, maskTopCustomers } from "@/lib/settings/privacy";
import { logServerError } from "@/lib/log";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const guard = await guardApi(request, "analiticas:ver");
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const restaurantId = url.searchParams.get("restaurantId")?.trim() ?? "";
  const brandId = url.searchParams.get("brandId")?.trim() ?? "";
  const city = url.searchParams.get("city")?.trim() ?? "";
  if (restaurantId.length > 64 || brandId.length > 64 || city.length > 100) {
    return NextResponse.json({ error: "El filtro no es válido." }, { status: 400 });
  }

  try {
    // El filtro de 14 días y de restaurante se aplica en getAnalytics.
    const analytics = await getAnalytics({
      restaurantId: restaurantId || null,
      brandId,
      city,
    });
    if (!(await canSeeTopCustomerNames(guard.user))) {
      analytics.topCustomers = maskTopCustomers(analytics.topCustomers);
    }
    return NextResponse.json(analytics);
  } catch (error) {
    logServerError("Failed to load analytics", error);
    return NextResponse.json({ error: "No se pudieron cargar las estadísticas." }, { status: 500 });
  }
}
