import { AnalyticsClient } from "@/components/analytics/analytics-client";
import { requirePage } from "@/lib/auth/session";

// Server Component: solo quien puede ver estadísticas (admin y analitica)
// llega a montar el panel. `/api/analiticas` y `/api/assistant` lo vuelven a
// comprobar por su cuenta.

export default async function AnaliticasPage() {
  await requirePage("/analiticas", "analiticas:ver");
  return <AnalyticsClient />;
}
