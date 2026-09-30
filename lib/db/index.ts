// Cliente de la base de datos (Turso / libSQL + Drizzle).
//
// Un solo punto de acceso a la BD para toda la app. Las páginas y las server
// actions importan `db` desde aquí; nunca crean su propio cliente.

import { createClient, type Client } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";

import * as schema from "./schema";

function createDatabase() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) {
    throw new Error(
      "Falta TURSO_DATABASE_URL. Copia .env.example a .env.local y llénalo.",
    );
  }

  const client: Client = createClient({
    url,
    // Solo las bases remotas de Turso lo necesitan; en local puede ir vacío.
    authToken: process.env.TURSO_AUTH_TOKEN,
  });

  // `schema` es lo que habilita el API `db.query.*` y las relaciones.
  return drizzle(client, { schema });
}

type Database = ReturnType<typeof createDatabase>;

let instance: Database | null = null;

/**
 * `db` es un proxy perezoso: la conexión se abre en el primer uso, no al
 * importar el módulo.
 *
 * Sin esto, `next build` falla en cuanto una página toca la BD y no hay
 * credenciales en el entorno de build, que es justo lo que pasa en un entorno
 * de despliegue si alguien olvida las variables.
 *
 * El proxy solo se resuelve en el servidor. Este módulo no debe importarse
 * desde un Client Component: si alguna vez hace falta, añadir `server-only`
 * como dependencia para que el error salte en build y no en producción.
 */
export const db: Database = new Proxy({} as Database, {
  get(_target, prop) {
    if (!instance) instance = createDatabase();
    const value = Reflect.get(instance, prop);
    // Sin `bind`, `db.select(...)` perdería el `this` interno de Drizzle.
    return typeof value === "function" ? value.bind(instance) : value;
  },
});

export { schema };
