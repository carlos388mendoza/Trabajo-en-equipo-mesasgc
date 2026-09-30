// Carga el catálogo de tipos de elemento del editor. Seguro en producción.
//
//   npm run db:catalog
//
// Railway lo corre en el Pre-deploy, justo después de `db:migrate`. Solo crea
// o actualiza las filas de `element_types` por su clave: no toca
// restaurantes, mesas, clientes ni usuarios, y repetirlo no duplica nada. Usa
// la base de TURSO_DATABASE_URL, que tiene que tener las migraciones
// aplicadas.

import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

const { upsertElementTypeCatalog } = await import("@/lib/layout/catalog");
const { ELEMENT_TYPE_KEYS } = await import("@/lib/db/enums");
const { db } = await import("@/lib/db");
const { elementTypes } = await import("@/lib/db/schema");

try {
  const count = await upsertElementTypeCatalog();
  const found = await db.select({ key: elementTypes.key }).from(elementTypes);
  const missing = ELEMENT_TYPE_KEYS.filter((key) => !found.some((row) => row.key === key));
  if (missing.length > 0) {
    throw new Error(`Faltan tipos de elemento en el catálogo: ${missing.join(", ")}`);
  }
  console.log(`catálogo de elementos: ${count} tipos listos`);
  process.exit(0);
} catch (error) {
  console.error("No se pudo cargar el catálogo de elementos:", error);
  process.exit(1);
}
