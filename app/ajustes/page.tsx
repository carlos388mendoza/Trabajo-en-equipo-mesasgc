import { AppearanceSettings } from "@/components/settings/appearance-settings";

// Ajustes de la app. La page es Server Component (para poder exportar
// `metadata`) y la sección de Apariencia es de cliente, porque lee y guarda en
// localStorage.
//
// TODO (Better Auth): cuando haya sesión, guardar las preferencias por usuario
// (ver el TODO de `lib/theme/theme.ts`) y proteger esta página.

export const metadata = {
  title: "Ajustes · Table Waitlist",
};

export default function AjustesPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <h1 className="text-2xl font-bold">Ajustes</h1>
      <div className="rounded-2xl border border-app-border bg-panel p-5 text-panel-text shadow-sm">
        <AppearanceSettings />
      </div>
    </div>
  );
}
