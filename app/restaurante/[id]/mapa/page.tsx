import { notFound } from "next/navigation";

import { RestaurantLivePlan } from "@/components/map/restaurant-live-plan";
import { can } from "@/lib/auth/rbac";
import { requirePage } from "@/lib/auth/session";
import { getLivePlan } from "@/lib/map/queries";

// Plano en vivo de UN restaurante, con el mismo estilo radar del mapa.
//
// Es la vista del rol restaurante (solo los suyos: otro restaurante va a
// /sin-acceso), pero admin y analitica también pueden abrirla. Los nombres de
// los clientes solo salen del servidor con `plano:clientes`.

export default async function PlanoEnVivoPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requirePage(`/restaurante/${id}/mapa`, "plano:ver", id);

  const plan = await getLivePlan(id, can(user, "plano:clientes", id));
  if (!plan) notFound();

  // Quien puede entrar en la room del restaurante se entera por ella; quien
  // no (analitica, que no ve nombres), por los contadores de la sala overview.
  const live = can(user, "editor:ver", id) || can(user, "rapido:ver", id) ? "restaurante" : "overview";

  return (
    <div className="flex h-[calc(100vh-9.5rem)] min-h-[30rem] flex-col gap-3">
      <div>
        <h1 className="text-2xl font-bold">{plan.restaurant.name}</h1>
        <p className="text-sm text-app-muted">
          Plano en vivo{plan.restaurant.brand ? ` · ${plan.restaurant.brand.name}` : ""}
          {plan.restaurant.city ? ` · ${plan.restaurant.city}` : ""}. Solo lectura: las mesas se sientan
          desde el editor o el modo sencillo.
        </p>
      </div>
      <div className="min-h-0 flex-1">
        <RestaurantLivePlan restaurantId={id} initialPlan={plan} live={live} />
      </div>
    </div>
  );
}
