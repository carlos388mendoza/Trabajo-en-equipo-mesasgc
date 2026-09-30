// Aplica TODAS las migraciones de `drizzle/` a una base SQLite, en orden.
//
// Lo usan los `verify:*` con su base temporal. Lee el orden del journal de
// drizzle-kit (`drizzle/meta/_journal.json`) en vez de ordenar por nombre, que
// es el que manda. No usa `drizzle-kit push` a propósito: leería el
// TURSO_DATABASE_URL del entorno y podría tocar una base de verdad.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { createClient } from "@libsql/client";

type Journal = { entries: { idx: number; tag: string }[] };

export async function applyAllMigrations(url: string): Promise<string[]> {
  const dir = resolve(process.cwd(), "drizzle");
  const journal = JSON.parse(readFileSync(resolve(dir, "meta/_journal.json"), "utf8")) as Journal;
  const tags = [...journal.entries].sort((a, b) => a.idx - b.idx).map((e) => e.tag);

  const client = createClient({ url });
  try {
    for (const tag of tags) {
      await client.executeMultiple(readFileSync(resolve(dir, `${tag}.sql`), "utf8"));
    }
  } finally {
    client.close();
  }
  return tags;
}
