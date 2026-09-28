import "./globals.css";

import Link from "next/link";
import { Settings } from "lucide-react";

import { InlineScript } from "@/components/theme/inline-script";
import { ThemeSync } from "@/components/theme/theme-sync";
import { themeBootScript, themeFallbackCss } from "@/lib/theme/theme";

export const metadata = {
  title: "Table Waitlist",
  description: "Sistema de manejo de listas de espera en restaurantes",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    // `suppressHydrationWarning` en <html>: el script de abajo le pone las
    // variables del tema y `data-theme` antes de que React hidrate, así que el
    // HTML del servidor y el del navegador no coinciden a propósito.
    <html lang="es" suppressHydrationWarning>
      <head>
        {/* Colores de Claro por si el script no llegara a ejecutarse. */}
        <style dangerouslySetInnerHTML={{ __html: themeFallbackCss() }} />
        {/* Aplica el tema guardado ANTES del primer pintado: sin esto, al
            recargar con el tema oscuro se vería un destello claro. Es la
            técnica de la guía de Next "Preventing flash before hydration". */}
        <InlineScript html={themeBootScript()} />
      </head>
      {/* Extensiones como Grammarly añaden atributos al <body> antes de que
          React hidrate, y eso daba un error de hydration que no es nuestro.
          Solo afecta a los atributos de este elemento, no a sus hijos. */}
      <body suppressHydrationWarning className="min-h-screen bg-app-bg text-app-text">
        <ThemeSync />
        <header className="flex items-center justify-between border-b border-app-border bg-panel px-4 py-3 text-panel-text">
          {/* El logotipo de texto "Table" + "Waitlist" resaltado; el color
              del resalte es el acento del tema, no un verde fijo. */}
          <Link href="/" className="text-lg font-bold tracking-tight">
            Table<span className="text-accent">Waitlist</span>
          </Link>
          <div className="flex items-center gap-2">
            {/* TODO (Ambos): nombre del usuario logueado + botón de logout, viene de Better Auth */}
            <Link
              href="/ajustes"
              className="flex h-11 items-center gap-2 rounded-xl px-3 text-sm font-medium hover:bg-app-border/60"
            >
              <Settings aria-hidden size={20} strokeWidth={2} />
              Ajustes
            </Link>
          </div>
        </header>
        {/* El padding se queda aquí: sin él el editor queda pegado a los
            bordes. El fondo lo pone el <body> con el color del tema. */}
        <main className="min-h-[calc(100vh-65px)] p-4">{children}</main>
      </body>
    </html>
  );
}
