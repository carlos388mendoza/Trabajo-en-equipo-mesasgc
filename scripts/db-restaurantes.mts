// Crea las marcas y los restaurantes reales, y una zona vacía por
// restaurante. Seguro en producción.
//
//   npm run db:restaurantes
//
// Solo añade lo que falta (ver `lib/layout/base-restaurants.ts`): no borra ni
// actualiza nada, no crea mesas, clientes ni usuarios, y repetirlo no
// duplica nada. Usa la base de TURSO_DATABASE_URL, que tiene que tener las
// migraciones aplicadas. En producción se corre una vez con
// `railway run npm run db:restaurantes`.

import { config } from "dotenv";

config({ path: [".env.local", ".env"], quiet: true });

const { ensureBaseRestaurants } = await import("@/lib/layout/base-restaurants");

try {
  const { brandsCreated, restaurantsCreated, locationsFilled, zonesCreated } = await ensureBaseRestaurants();
  console.log(`marcas creadas: ${brandsCreated}`);
  console.log(`restaurantes creados: ${restaurantsCreated}`);
  console.log(`ubicaciones reales añadidas a restaurantes que no tenían: ${locationsFilled}`);
  console.log(`zonas vacías creadas: ${zonesCreated}`);
  console.log("Nada más de lo que ya existía se tocó.");
  process.exit(0);
} catch (error) {
  console.error("No se pudieron crear los restaurantes:", error);
  process.exit(1);
}
