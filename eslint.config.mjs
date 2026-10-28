// Configuración de ESLint en formato plano (flat config).
//
// Antes esto era un `.eslintrc` implícito y `npm run lint` usaba `next lint`,
// pero ese comando se eliminó en Next 16: ahora se llama a `eslint` directly.
// `eslint-config-next` 16 ya exporta un array de configuración plano, así que
// solo hay que extenderlo.

import next from "eslint-config-next";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  ...next,
  ...nextTypescript,
  {
    rules: {
      // Nada de `alert`, `confirm` ni `prompt` del navegador (issue #107): no
      // siguen el tema, salen en inglés en la tablet y bloquean la página. Usa
      // `components/ui/confirm-dialog.tsx` o un aviso en pantalla.
      "no-alert": "error",
    },
  },
  {
    ignores: [
      ".next/**",
      // Salida de la app que levanta `npm run verify:auth`.
      ".next-verify/**",
      ".next-verify-*/**",
      // Builds locales con otro `NEXT_DIST_DIR` (medir FPS, vista previa).
      ".next-*/**",
      // Capturas y perfil de Chrome de `scripts/verify-browser.mts`.
      ".verify-browser/**",
      "out/**",
      "build/**",
      "node_modules/**",
      "next-env.d.ts",
      // Generado por drizzle-kit: no es código nuestro.
      "drizzle/**",
    ],
  },
];

export default config;
