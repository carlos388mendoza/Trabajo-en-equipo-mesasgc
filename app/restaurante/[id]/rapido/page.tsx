import { QuickModeClient } from "@/components/quick-mode/quick-mode-client";
import { requirePage } from "@/lib/auth/session";

export default async function ModoRapidoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requirePage(`/restaurante/${id}/rapido`, "rapido:ver", id);
  // `key`: al cambiar de restaurante sin recargar (el selector de la cabecera),
  // el modo rápido se monta de cero, con su socket en la room del nuevo.
  return <QuickModeClient key={id} restaurantId={id} />;
}
