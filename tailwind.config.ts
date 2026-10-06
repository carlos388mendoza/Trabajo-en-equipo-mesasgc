import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

import { TABLET_LANDSCAPE_QUERY } from "./lib/layout/immersive";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    // `components/` es donde vive el editor entero: 58 de las 76 clases del
    // repo. Sin esta línea Tailwind genera un CSS que no incluye ni el `w-52`
    // de la paleta ni el `flex-1` del lienzo, y la página sale en texto plano
    // sin que el build dé ningún error que lo delate.
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./lib/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      // Los valores NO están aquí: salen de `lib/theme/theme.ts` como
      // variables CSS ("r g b"), para que la app y el lienzo de Konva usen los
      // mismos colores y el tema cambie sin recompilar. Aquí solo se dice qué
      // variable usa cada clase (`bg-panel/80`, `text-accent`...).
      colors: {
        app: {
          bg: "rgb(var(--c-app-bg) / <alpha-value>)",
          text: "rgb(var(--c-app-text) / <alpha-value>)",
          muted: "rgb(var(--c-app-muted) / <alpha-value>)",
          border: "rgb(var(--c-border) / <alpha-value>)",
        },
        panel: {
          DEFAULT: "rgb(var(--c-panel) / <alpha-value>)",
          text: "rgb(var(--c-panel-text) / <alpha-value>)",
          muted: "rgb(var(--c-panel-muted) / <alpha-value>)",
        },
        map: {
          bg: "rgb(var(--c-map-bg) / <alpha-value>)",
          grid: "rgb(var(--c-grid) / <alpha-value>)",
          line: "rgb(var(--c-line) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "rgb(var(--c-accent) / <alpha-value>)",
          text: "rgb(var(--c-accent-text) / <alpha-value>)",
        },
        estado: {
          libre: "rgb(var(--c-libre) / <alpha-value>)",
          ocupada: "rgb(var(--c-ocupada) / <alpha-value>)",
          reservada: "rgb(var(--c-reservada) / <alpha-value>)",
        },
        // Alerta de espera del mapa general (ver `alertFor` en theme.ts).
        alerta: "rgb(var(--c-alerta) / <alpha-value>)",
        critica: "rgb(var(--c-critica) / <alpha-value>)",
      },
    },
  },
  plugins: [
    // Móvil tumbado: el teléfono de lado, que es la única pantalla donde el
    // alto manda y el ancho sobra. El corte en 1023 px deja fuera a tablet y
    // escritorio, que también se pueden girar pero ya tienen sitio de sobra.
    //
    // OJO: Tailwind emite este bloque ANTES que `sm`, así que una clase `sm:`
    // de la misma propiedad gana en horizontal. Por eso las medidas de la
    // carta en landscape van con `!` (`movil-horizontal:!h-[252px]`): si no,
    // el `sm:h-[400px]` de siempre se impondría y el arreglo no se vería.
    plugin(({ addVariant }) => {
      addVariant("movil-horizontal", "@media (orientation: landscape) and (max-width: 1023px)");
    }),
    // Tablet en horizontal: el plano en vivo pasa a pantalla completa (modo
    // inmersivo, ver `components/map/live-plan.tsx`). La media query y por qué
    // es así están en `lib/layout/immersive.ts`.
    //
    // Es CSS y no JS: al girar la tablet cambia en el mismo fotograma, y al
    // cargar la página no hay parpadeo de la vista normal.
    //
    // Se registran en este orden a propósito: Tailwind los emite así, y el de
    // `inmersivo` tiene que ganar al de `tableta-horizontal`.
    plugin(({ addVariant }) => {
      const tabletaHorizontal = TABLET_LANDSCAPE_QUERY;
      addVariant("tableta-horizontal", `@media ${tabletaHorizontal}`);
      // Dentro del plano en modo inmersivo (`data-inmersivo` en su raíz).
      addVariant("inmersivo", `@media ${tabletaHorizontal} { [data-inmersivo] & }`);
      // La raíz misma del plano en modo inmersivo.
      addVariant("inmersivo-raiz", `@media ${tabletaHorizontal} { &[data-inmersivo] }`);
      // Fuera del plano (cabecera, menú, márgenes) mientras hay uno inmersivo.
      addVariant("con-plano-inmersivo", `@media ${tabletaHorizontal} { :root:has([data-inmersivo]) & }`);
      // La página va dentro de un iframe del propio sitio (el panel de la
      // lista de espera del plano inmersivo): sin cabecera ni menú.
      addVariant("embebido", ":root[data-embebido] &");
    }),
  ],
};

export default config;
