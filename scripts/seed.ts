// Seed de la base de datos.
//
//   npm run db:seed          -> siembra (idempotente, se puede repetir)
//   npm run db:seed -- --reset -> borra los datos de layout y vuelve a sembrar
//
// Qué siembra y por qué:
//
// 1. `element_types`: el catálogo con los 5 tipos del editor. Es OBLIGATORIO:
//    sin estas filas el editor no tiene nada que pintar en su paleta, y las
//    claves ("mesa-sillas", "caja"...) son las que usa la lógica para saber
//    qué tipos admiten clientes.
// 2. Dos restaurantes de ejemplo con sus zonas y mesas. Sirven para probar el
//    editor (paso 2), el copiado entre restaurantes (paso 3) y la galería de
//    zonas (paso 4) sin tener que crear nada a mano.
// 3. Usuarios de prueba (ver README, "Usuarios de prueba"), SOLO si NODE_ENV
//    no es production. En producción el primer admin se crea con
//    `npm run create-admin`, sin contraseñas escritas en el código.
//
// Los ids son fijos y deterministas a propósito: el seed se puede correr las
// veces que haga falta sin duplicar nada.

import { config } from "dotenv";

import { ELEMENT_TYPE_KEYS, type ElementTypeKey, type Role } from "../lib/db/enums";
import { db } from "../lib/db";
import {
  elementTypes,
  restaurants,
  tableLayouts,
  tables,
  userRestaurants,
  userRoles,
  waitlistEntries,
} from "../lib/db/schema";
import { createUserWithPassword, findUserIdByEmail } from "../lib/auth/users";

// dotenv no lee solo `.env`, y Next usa `.env.local`: se le pasan los dos.
config({ path: [".env.local", ".env"] });

// ---------------------------------------------------------------------------
// Catálogo de tipos de elemento
// ---------------------------------------------------------------------------

/**
 * Colores pensados para que los cinco se distinguan de un vistazo en el mapa
 * y, sobre todo, para que "ocupada" se distinga del color del tipo (el editor
 * pinta la mesa ocupada con un borde rojo, no cambiando el relleno).
 */
const ELEMENT_TYPE_SEED: {
  key: ElementTypeKey;
  label: string;
  color: string;
  icon: string;
  width: number;
  height: number;
  defaultCapacity: number | null;
}[] = [
  {
    key: "mesa-sillas",
    label: "Mesa con sillas",
    color: "#3b82f6",
    icon: "utensils",
    width: 80,
    height: 80,
    defaultCapacity: 4,
  },
  {
    key: "mesa-butacas",
    label: "Mesa con butacas",
    color: "#8b5cf6",
    icon: "sofa",
    width: 130,
    height: 70,
    defaultCapacity: 6,
  },
  {
    key: "area-juegos",
    label: "Área de juegos",
    color: "#f59e0b",
    icon: "puzzle",
    width: 220,
    height: 220,
    defaultCapacity: null,
  },
  {
    key: "bano",
    label: "Baño",
    color: "#6b7280",
    icon: "toilet",
    width: 60,
    height: 60,
    defaultCapacity: null,
  },
  {
    key: "caja",
    label: "Caja",
    color: "#10b981",
    icon: "banknote",
    width: 70,
    height: 70,
    defaultCapacity: null,
  },
];

async function seedElementTypes() {
  for (const [sortOrder, type] of ELEMENT_TYPE_SEED.entries()) {
    await db
      .insert(elementTypes)
      .values({ id: `el_${type.key}`, sortOrder, ...type })
      .onConflictDoUpdate({
        // La clave es la identidad lógica del tipo: si alguien la cambió, se
        // actualiza la fila en vez de crear un duplicado.
        target: elementTypes.key,
        set: {
          label: type.label,
          color: type.color,
          icon: type.icon,
          width: type.width,
          height: type.height,
          defaultCapacity: type.defaultCapacity,
          sortOrder,
        },
      });
  }
  console.log(`  element_types: ${ELEMENT_TYPE_SEED.length} tipos`);
}

// ---------------------------------------------------------------------------
// Datos de ejemplo
// ---------------------------------------------------------------------------

const DEMO_RESTAURANTS = [
  { id: "rest_centro", name: "Restaurante Demo Centro", slug: "demo-centro" },
  { id: "rest_norte", name: "Restaurante Demo Norte", slug: "demo-norte" },
] as const;

const DEMO_LAYOUTS = [
  { id: "lay_centro_principal", restaurantId: "rest_centro", name: "Comedor principal", description: "Sala principal, 8 mesas", sortOrder: 0, isDefault: true },
  { id: "lay_centro_terraza", restaurantId: "rest_centro", name: "Terraza", description: "Exterior, 4 mesas", sortOrder: 1, isDefault: false },
  { id: "lay_norte_principal", restaurantId: "rest_norte", name: "Comedor principal", description: "Sala única", sortOrder: 0, isDefault: true },
] as const;

/** `x`/`y` en unidades del canvas, en rejilla para que se vea ordenado. */
const DEMO_TABLES = [
  // Comedor del Centro
  { id: "tbl_c_1", layoutId: "lay_centro_principal", elementTypeId: "el_mesa-sillas", label: "Mesa 1", x: 120, y: 120, capacity: 4 },
  { id: "tbl_c_2", layoutId: "lay_centro_principal", elementTypeId: "el_mesa-sillas", label: "Mesa 2", x: 280, y: 120, capacity: 4 },
  { id: "tbl_c_3", layoutId: "lay_centro_principal", elementTypeId: "el_mesa-butacas", label: "Bancada 1", x: 460, y: 120, capacity: 6 },
  { id: "tbl_c_4", layoutId: "lay_centro_principal", elementTypeId: "el_mesa-sillas", label: "Mesa 4", x: 120, y: 280, capacity: 2 },
  { id: "tbl_c_5", layoutId: "lay_centro_principal", elementTypeId: "el_mesa-sillas", label: "Mesa 5", x: 280, y: 280, capacity: 2 },
  { id: "tbl_c_juegos", layoutId: "lay_centro_principal", elementTypeId: "el_area-juegos", label: "Zona infantil", x: 520, y: 320, capacity: null },
  { id: "tbl_c_bano", layoutId: "lay_centro_principal", elementTypeId: "el_bano", label: "Baños", x: 80, y: 480, capacity: null },
  { id: "tbl_c_caja", layoutId: "lay_centro_principal", elementTypeId: "el_caja", label: "Caja 1", x: 700, y: 80, capacity: null },
  // Terraza del Centro
  { id: "tbl_t_1", layoutId: "lay_centro_terraza", elementTypeId: "el_mesa-sillas", label: "Terraza 1", x: 140, y: 140, capacity: 4 },
  { id: "tbl_t_2", layoutId: "lay_centro_terraza", elementTypeId: "el_mesa-sillas", label: "Terraza 2", x: 300, y: 140, capacity: 4 },
  { id: "tbl_t_3", layoutId: "lay_centro_terraza", elementTypeId: "el_mesa-butacas", label: "Terraza 3", x: 140, y: 300, capacity: 8 },
  { id: "tbl_t_caja", layoutId: "lay_centro_terraza", elementTypeId: "el_caja", label: "Caja terraza", x: 520, y: 120, capacity: null },
  // Comedor del Norte (copia parcial: a propósito, para probar el pegado)
  { id: "tbl_n_1", layoutId: "lay_norte_principal", elementTypeId: "el_mesa-sillas", label: "Mesa 1", x: 120, y: 120, capacity: 4 },
  { id: "tbl_n_2", layoutId: "lay_norte_principal", elementTypeId: "el_mesa-sillas", label: "Mesa 2", x: 280, y: 120, capacity: 4 },
  { id: "tbl_n_3", layoutId: "lay_norte_principal", elementTypeId: "el_mesa-butacas", label: "Bancada 1", x: 460, y: 120, capacity: 6 },
  { id: "tbl_n_caja", layoutId: "lay_norte_principal", elementTypeId: "el_caja", label: "Caja 1", x: 700, y: 80, capacity: null },
] as const;

const DEMO_WAITLIST = [
  { id: "wl_1", restaurantId: "rest_centro", customerName: "Ana Torres", partySize: 3, status: "esperando" },
  { id: "wl_2", restaurantId: "rest_centro", customerName: "Luis Ríos", partySize: 2, status: "esperando" },
  { id: "wl_3", restaurantId: "rest_centro", customerName: "Familia Pérez", partySize: 5, status: "listo" },
  { id: "wl_4", restaurantId: "rest_norte", customerName: "Sara Gómez", partySize: 2, status: "esperando" },
] as const;

async function seedDemoData() {
  for (const r of DEMO_RESTAURANTS) {
    await db
      .insert(restaurants)
      .values(r)
      .onConflictDoNothing({ target: restaurants.id });
  }

  for (const l of DEMO_LAYOUTS) {
    await db
      .insert(tableLayouts)
      .values({ width: 1200, height: 800, ...l })
      .onConflictDoNothing({ target: tableLayouts.id });
  }

  // `tables.restaurantId` está desnormalizado (se puede consultar el mapa de un
  // restaurante sin pasar por la zona) y es NOT NULL, así que se deriva de la
  // zona en vez de repetirlo a mano en cada mesa: menos sitios donde escribir
  // mal el id.
  const restaurantOfLayout = new Map(
    DEMO_LAYOUTS.map((l) => [l.id, l.restaurantId]),
  );

  for (const t of DEMO_TABLES) {
    const restaurantId = restaurantOfLayout.get(t.layoutId);
    if (!restaurantId) {
      throw new Error(`La mesa ${t.id} apunta a la zona ${t.layoutId}, que no existe en el seed`);
    }
    await db
      .insert(tables)
      .values({ width: 80, height: 80, ...t, restaurantId })
      .onConflictDoNothing({ target: tables.id });
  }

  for (const w of DEMO_WAITLIST) {
    await db
      .insert(waitlistEntries)
      .values(w)
      .onConflictDoNothing({ target: waitlistEntries.id });
  }

  console.log(`  restaurants: ${DEMO_RESTAURANTS.length}`);
  console.log(`  table_layouts: ${DEMO_LAYOUTS.length}`);
  console.log(`  tables: ${DEMO_TABLES.length}`);
  console.log(`  waitlist_entries: ${DEMO_WAITLIST.length}`);
}

/**
 * Borra solo los datos de layout y lista de espera.
 *
 * NO toca `user`/`session`/`account`: las cuentas las crea el admin y no son
 * datos de demostración. Aviso: al borrar `restaurants` se borran también, en
 * cascada, las asignaciones de `user_restaurants`. Los usuarios de prueba las
 * recuperan solos en `seedTestUsers`; los creados a mano hay que reasignarlos.
 */
async function resetLayoutData() {
  await db.delete(waitlistEntries);
  await db.delete(tables);
  await db.delete(tableLayouts);
  await db.delete(restaurants);
  console.log("  datos de layout y lista de espera borrados");
}

// ---------------------------------------------------------------------------
// Usuarios de prueba (solo desarrollo)
//
// La contraseña es la misma para todos y está aquí a la vista A PROPÓSITO:
// son cuentas de desarrollo. Por eso no se crean nunca con NODE_ENV=production.
// ---------------------------------------------------------------------------

const TEST_PASSWORD = "12345abc";

const TEST_USERS: { email: string; name: string; roles: Role[]; restaurantIds: string[] }[] = [
  { email: "admin@grupocomidas.test", name: "Administrador", roles: ["admin"], restaurantIds: [] },
  { email: "centro@grupocomidas.test", name: "Host Centro", roles: ["restaurante"], restaurantIds: ["rest_centro"] },
  { email: "norte@grupocomidas.test", name: "Host Norte", roles: ["restaurante"], restaurantIds: ["rest_norte"] },
  { email: "analitica@grupocomidas.test", name: "Analista", roles: ["analitica"], restaurantIds: [] },
  { email: "gerente@grupocomidas.test", name: "Gerente Centro", roles: ["restaurante", "analitica"], restaurantIds: ["rest_centro"] },
];

async function seedTestUsers() {
  if (process.env.NODE_ENV === "production") {
    console.log("  usuarios de prueba: omitidos (NODE_ENV=production)");
    return;
  }
  let created = 0;
  for (const u of TEST_USERS) {
    const existing = await findUserIdByEmail(u.email);
    if (!existing) {
      await createUserWithPassword({ ...u, password: TEST_PASSWORD });
      created += 1;
      continue;
    }
    // Ya existe: no se duplica ni se toca su contraseña, pero se le vuelven a
    // poner sus roles y restaurantes. `--reset` borra los restaurantes y, por
    // el ON DELETE CASCADE, también sus asignaciones.
    await db
      .insert(userRoles)
      .values(u.roles.map((role) => ({ userId: existing, role })))
      .onConflictDoNothing();
    if (u.restaurantIds.length > 0) {
      await db
        .insert(userRestaurants)
        .values(u.restaurantIds.map((restaurantId) => ({ userId: existing, restaurantId })))
        .onConflictDoNothing();
    }
  }
  console.log(`  usuarios de prueba: ${created} creados, ${TEST_USERS.length - created} ya existían`);
}

// ---------------------------------------------------------------------------

async function main() {
  const reset = process.argv.includes("--reset");

  console.log("Sembrando base de datos...");
  if (reset) await resetLayoutData();

  await seedElementTypes();
  await seedDemoData();
  await seedTestUsers();

  // Comprobación de que el catálogo quedó bien: si falta algún tipo, el editor
  // se romperá más tarde y será menos obvio llegar hasta aquí.
  const found = await db.select({ key: elementTypes.key }).from(elementTypes);
  const missing = ELEMENT_TYPE_KEYS.filter((k) => !found.some((f) => f.key === k));
  if (missing.length > 0) {
    throw new Error(`Faltan tipos de elemento en el catálogo: ${missing.join(", ")}`);
  }

  console.log("Listo.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error en el seed:", error);
    process.exit(1);
  });
