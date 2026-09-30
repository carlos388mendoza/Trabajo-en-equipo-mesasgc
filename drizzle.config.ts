import type { Config } from "drizzle-kit";
import { loadEnvConfig } from "@next/env";

loadEnvConfig(process.cwd());

export default {
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  // Desde drizzle-kit 0.22 esto es `dialect`, no `driver`. `turso` es un
  // dialecto de primera clase y usa el cliente libSQL, igual que la app.
  dialect: "turso",
  dbCredentials: {
    url: process.env.TURSO_DATABASE_URL!,
    // `|| undefined`: en local `.env.local` trae `TURSO_AUTH_TOKEN=` vacío (así
    // viene en `.env.example`), y drizzle-kit rechaza la cadena vacía con
    // "Please provide required params" en lugar de tratarla como "sin token".
    authToken: process.env.TURSO_AUTH_TOKEN || undefined,
  },
} satisfies Config;
