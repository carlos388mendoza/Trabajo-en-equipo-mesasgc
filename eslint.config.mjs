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
    ignores: [
      ".next/**",
      // Salida de la app que levanta `npm run verify:auth`.
      ".next-verify/**",
      ".next-verify-*/**",
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
