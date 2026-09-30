import { redirect } from "next/navigation";

import { can } from "@/lib/auth/rbac";
import { requirePage } from "@/lib/auth/session";

// /restaurante/[id] a secas lleva al modo que el usuario puede usar ahí
// (modo sencillo primero); si no puede ninguno, a /sin-acceso.

export default async function RestaurantePage({
  params,
}: {
  // Next 16: `params` es una Promise. El acceso síncrono se eliminó por
  // completo en la 16 (en la 15 había un periodo de compatibilidad).
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const user = await requirePage(`/restaurante/${id}`);
  if (can(user, "rapido:ver", id)) redirect(`/restaurante/${id}/rapido`);
  if (can(user, "editor:ver", id)) redirect(`/restaurante/${id}/editor`);
  redirect("/sin-acceso");
}
