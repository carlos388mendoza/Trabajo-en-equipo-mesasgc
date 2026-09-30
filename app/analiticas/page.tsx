import { AnalyticsClient } from "@/components/analytics/analytics-client";
import { requirePage } from "@/lib/auth/session";

// El panel es servidor protegido por RBAC; las API validan cada petición de nuevo.
export default async function AnaliticasPage() {
  await requirePage("/analiticas", "analiticas:ver");
  return <AnalyticsClient />;
}
