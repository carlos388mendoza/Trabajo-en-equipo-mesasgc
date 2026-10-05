import { QuickModeClient } from "@/components/quick-mode/quick-mode-client";
import { requirePage } from "@/lib/auth/session";

export default async function ModoRapidoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const me = await requirePage(`/restaurante/${id}/rapido`, "rapido:ver", id);
  // `key`: al cambiar de restaurante sin recargar (el selector de la cabecera),
  // el modo rápido se monta de cero, con su socket en la room del nuevo.
  // `userId`: la cola sin conexión es de este usuario (en una tablet compartida
  // no se mezcla con la del siguiente). Es un id, no un secreto.
  return <QuickModeClient key={id} restaurantId={id} userId={me.id} />;
}
