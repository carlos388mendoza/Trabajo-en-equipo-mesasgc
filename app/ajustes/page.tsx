import { AppearanceSettings } from "@/components/settings/appearance-settings";
import { requirePage } from "@/lib/auth/session";

// Ajustes de la app. La page es Server Component (para poder exportar
// `metadata`) y la sección de Apariencia es de cliente, porque lee y guarda en
// localStorage.
//
// Cualquier usuario con sesión puede entrar: son sus preferencias.
//
// TODO: guardar la apariencia por usuario en la base de datos (ver el TODO de
// `lib/theme/theme.ts`). Hoy vive solo en el navegador.

export const metadata = {
  title: "Ajustes · Table Waitlist",
};

export default async function AjustesPage() {
  await requirePage("/ajustes");
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-2xl font-bold">Ajustes</h1>
      <div className="rounded-2xl border border-app-border bg-panel p-5 text-panel-text shadow-sm">
        <AppearanceSettings />
      </div>
    </div>
  );
}
