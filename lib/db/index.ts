import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";

const url = process.env.TURSO_DATABASE_URL;
const authToken = process.env.TURSO_AUTH_TOKEN;

if (!url || !authToken) {
  throw new Error("Faltan TURSO_DATABASE_URL y TURSO_AUTH_TOKEN en .env.local");
}

const client = createClient({ url, authToken });
export const db = drizzle(client, { schema });
