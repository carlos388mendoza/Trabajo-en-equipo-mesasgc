import "./globals.css";

import { AppHeader } from "@/components/layout/app-header";
import { InlineScript } from "@/components/theme/inline-script";
import { ThemeSync } from "@/components/theme/theme-sync";
import { themeBootScript, themeFallbackCss } from "@/lib/theme/theme";

// `data-embebido` en <html> si la página va dentro de un iframe. Solo puede
// ser del propio sitio: las cabeceras de `next.config.mjs` no dejan que otro
// la meta en un iframe.
const EMBED_BOOT_SCRIPT =
  '(function(){try{if(window.self!==window.top)document.documentElement.setAttribute("data-embebido","")}catch(e){document.documentElement.setAttribute("data-embebido","")}})();';

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
        {/* Dentro de un iframe del propio sitio (el panel de la lista de
            espera del plano en vivo) la página va sin cabecera ni menú: se
            marca ANTES del primer pintado para que no asomen un instante. */}
        <InlineScript html={EMBED_BOOT_SCRIPT} />
      </head>
      {/* Extensiones como Grammarly añaden atributos al <body> antes de que
          React hidrate, y eso daba un error de hydration que no es nuestro.
          Solo afecta a los atributos de este elemento, no a sus hijos. */}
      <body suppressHydrationWarning className="min-h-screen bg-app-bg text-app-text con-plano-inmersivo:min-h-0">
        <ThemeSync />
        {/* Logo, menú según los permisos, usuario, Ajustes y Cerrar sesión. */}
        <AppHeader />
        {/* El padding se queda aquí: sin él el editor queda pegado a los
            bordes. El fondo lo pone el <body> con el color del tema. Con el
            plano en vivo inmersivo (tablet en horizontal) el plano ocupa la
            pantalla entera y aquí no queda nada que medir: sin margen ni alto
            mínimo, para que la página no tenga scroll. */}
        <main className="min-h-[calc(100vh-65px)] p-4 con-plano-inmersivo:min-h-0 con-plano-inmersivo:p-0 embebido:min-h-0 embebido:p-0">
          {children}
        </main>
      </body>
    </html>
  );
}
