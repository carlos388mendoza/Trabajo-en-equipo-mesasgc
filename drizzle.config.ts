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
    authToken: process.env.TURSO_AUTH_TOKEN,
  },
} satisfies Config;
