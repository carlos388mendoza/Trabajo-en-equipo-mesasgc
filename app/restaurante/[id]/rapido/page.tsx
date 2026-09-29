import { QuickModeClient } from "@/components/quick-mode/quick-mode-client";
import { requirePage } from "@/lib/auth/session";

export default async function ModoRapidoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requirePage(`/restaurante/${id}/rapido`, "rapido:ver", id);
  return <QuickModeClient restaurantId={id} />;
}
