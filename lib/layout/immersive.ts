// Cuándo el plano en vivo pasa a pantalla completa (modo inmersivo).
//
// Una sola media query para todo: la usan las variantes de Tailwind
// (`tableta-horizontal`, `inmersivo`...; ver `tailwind.config.ts`) y el
// plano en vivo, que con ella sabe cuándo encuadrar y dejar sitio a los
// controles flotantes. Si fueran dos copias, el CSS y el JS podrían no
// coincidir justo en el borde.
//
//  - Horizontal y 900×500 o más: entra cualquier tablet, también con la barra
//    de Opera a la vista; deja fuera al celular tumbado (430 px de alto como
//    mucho).
//  - `hover: none` y `pointer: coarse`: pantalla táctil. Deja fuera a la
//    computadora, que también es horizontal y puede medir lo mismo.
export const TABLET_LANDSCAPE_QUERY =
  "(orientation: landscape) and (min-width: 900px) and (min-height: 500px) and (hover: none) and (pointer: coarse)";
