import { QuickModeClient } from "@/components/quick-mode/quick-mode-client";
import { requirePage } from "@/lib/auth/session";

// Server Component: comprueba sesión y permiso sobre ESTE restaurante antes de
// mostrar el modo rápido. Las API que usa (`/api/restaurante/[id]/clientes`)
// lo vuelven a comprobar por su cuenta.

export default async function ModoRapidoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  await requirePage(`/restaurante/${id}/rapido`, "rapido:ver", id);
  return <QuickModeClient restaurantId={id} />;
}
