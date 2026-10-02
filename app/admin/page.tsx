import { AdminCatalog } from "@/components/admin/admin-catalog";
import { AdminUsers } from "@/components/admin/admin-users";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/auth";
import { requirePage } from "@/lib/auth/session";
import { listRestaurants, listUsers } from "@/lib/auth/users";
import { listAdminBrands, listAdminRestaurants } from "@/lib/layout/catalog-admin";
import { MAP_BOUNDS } from "@/lib/map/projection";
import { CITIES } from "@/lib/map/world";

// Solo admin ("usuarios:gestionar"; marcas y restaurantes, "catalogo:gestionar",
// que también es solo del admin). No hay registro público: los usuarios se
// crean aquí. Cada acción de la página vuelve a comprobar el permiso en
// `app/admin/actions.ts` y `app/admin/catalog-actions.ts`.

export const metadata = { title: "Administración · Table Waitlist" };

export default async function AdminPage() {
  const me = await requirePage("/admin", "usuarios:gestionar");
  const [users, restaurants, adminBrands, adminRestaurants] = await Promise.all([
    listUsers(),
    // Para los accesos: solo los activos (uno desactivado no se asigna).
    listRestaurants(),
    listAdminBrands(),
    listAdminRestaurants(),
  ]);

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Administración</h1>
        <p className="text-sm text-app-muted">Usuarios, roles y acceso; marcas y restaurantes.</p>
      </div>

      <AdminUsers
        users={users}
        restaurants={restaurants}
        currentUserId={me.id}
        minPasswordLength={MIN_PASSWORD_LENGTH}
      />

      <AdminCatalog
        brands={adminBrands}
        restaurants={adminRestaurants}
        cities={CITIES.map(({ name, lat, lng }) => ({ name, lat, lng }))}
        bounds={MAP_BOUNDS}
      />
    </div>
  );
}
