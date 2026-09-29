import { WorldMap } from "@/components/map/world-map";
import { restaurantsAllowed } from "@/lib/auth/rbac";
import { requirePage } from "@/lib/auth/session";
import { getCounters } from "@/lib/map/counters";
import { getMapRestaurants, listBrands } from "@/lib/map/queries";

// Mapa general: admin y analitica (`mapa:ver`). El rol restaurante va a
// /sin-acceso; su plano en vivo está en /restaurante/[id]/mapa.
//
// Server Component: los restaurantes, las marcas y los contadores llegan ya en
// el HTML, y el cliente se engancha a la sala `overview` para seguir al día.

export const metadata = { title: "Mapa general · Table Waitlist" };

export default async function MapaPage() {
  const user = await requirePage("/mapa", "mapa:ver");
  const [all, brands] = await Promise.all([getMapRestaurants(), listBrands()]);
  // Hoy quien tiene `mapa:ver` ve todos; el filtro deja la regla en rbac.ts.
  const restaurants = restaurantsAllowed(user, "plano:ver", all);
  const counters = await getCounters(restaurants.map((r) => r.id));

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h1 className="text-2xl font-bold">Mapa general</h1>
        <p className="text-sm text-app-muted">
          {restaurants.length} restaurantes de {brands.length} marcas. Toca uno para ver su plano en vivo.
        </p>
      </div>
      <WorldMap restaurants={restaurants} brands={brands} initialCounters={counters} />
    </div>
  );
}
