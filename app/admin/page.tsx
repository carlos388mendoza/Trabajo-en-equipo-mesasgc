import { requirePage } from "@/lib/auth/session";

// Solo para admin ("usuarios:gestionar"). La gestión de usuarios llega en el
// siguiente commit; la protección va primero.

export default async function AdminPage() {
  await requirePage("/admin", "usuarios:gestionar");
  return (
    <div>
      <h1 className="text-xl font-semibold">Panel de Administrador</h1>
    </div>
  );
}
