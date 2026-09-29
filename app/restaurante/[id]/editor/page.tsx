import { EditorClient } from "@/components/editor/editor-client";
import { restaurantsAllowed } from "@/lib/auth/rbac";
import { requirePage } from "@/lib/auth/session";
import { getElementTypes, getLayout, getLayoutsForRestaurant, restaurantExists } from "@/lib/db/queries/layouts";
import { getRestaurantsWithoutLayout } from "@/lib/layout/copy";

// Es una Server Component a propósito: la zona, el catálogo de tipos y los
// elementos llegan desde la base de datos y se pasan ya resueltos al editor.
// Así el HTML inicial trae el mapa y no hay un spinner al abrir, y sobre todo
// el `dynamic({ ssr: false })` de Konva vive dentro del Client Component, que
// es la única forma de que funcione en Next 16.

export default async function EditorPage({
  params,
  searchParams,
}: {
  // Next 16: `params` y `searchParams` son Promise (ver app/restaurante/[id]/page.tsx).
  params: Promise<{ id: string }>;
  searchParams: Promise<{ zona?: string }>;
}) {
  const [{ id }, { zona }] = await Promise.all([params, searchParams]);

  // Antes de leer nada: sin permiso sobre ESTE restaurante no se carga su
  // plano (redirige a /login o /sin-acceso).
  const user = await requirePage(`/restaurante/${id}/editor`, "editor:ver", id);

  const [exists, layouts, types, allTargets] = await Promise.all([
    restaurantExists(id),
    getLayoutsForRestaurant(id),
    getElementTypes(),
    getRestaurantsWithoutLayout(id),
  ]);
  // Solo se ofrece copiar a los restaurantes que este usuario puede editar.
  const copyTargets = restaurantsAllowed(user, "editor:guardar", allTargets);

  if (!exists) {
    return (
      <div>
        <h1 className="text-lg font-semibold">Restaurante no encontrado</h1>
        <p className="text-sm text-neutral-500">
          No hay ningún restaurante con el id <code>{id}</code>.
        </p>
      </div>
    );
  }

  // La zona activa viaja en la URL para que el botón "atrás" del navegador
  // funcione y recargar no pierda el sitio. Si la URL no dice nada, se abre la
  // que el restaurante marcó como predeterminada, o la primera.
  const requested = zona ? layouts.find((l) => l.id === zona) : undefined;
  const active = requested ?? layouts.find((l) => l.isDefault) ?? layouts[0];

  if (!active) {
    return (
      <div>
        <h1 className="text-lg font-semibold">Sin zonas</h1>
        <p className="text-sm text-neutral-500">
          Este restaurante todavía no tiene ninguna zona. Créala con el seed
          (`npm run db:seed`) o desde la galería en el paso 4.
        </p>
      </div>
    );
  }

  const layout = await getLayout(active.id, id);
  if (!layout) return null;

  return (
    <div className="flex h-[calc(100vh-6rem)] min-h-[32rem] flex-col">
      <EditorClient
        // `key` para que cambiar de zona remonte el editor y empiece con el
        // estado limpio. Sin esto, los elementos de la zona anterior se
        // quedarían en pantalla al navegar.
        key={layout.id}
        restaurantId={id}
        layoutId={layout.id}
        layoutName={layout.name}
        width={layout.width}
        height={layout.height}
        version={layout.version}
        rotation={layout.rotation}
        elements={layout.elements}
        types={types}
        layouts={layouts}
        copyTargets={copyTargets}
      />
    </div>
  );
}
