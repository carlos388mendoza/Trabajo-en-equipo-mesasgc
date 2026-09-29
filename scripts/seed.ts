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
// 2b. El mapa general: 4 marcas y 8 restaurantes (2 por marca) repartidos en
//    Tegucigalpa y San Pedro Sula. `rest_centro` y `rest_norte` son dos de
//    ellos, con los mismos ids, para no romper los usuarios de prueba. Los
//    otros 6 copian su plano con `copyLayoutToRestaurant` (la misma función
//    que el diálogo del editor), y todos reciben clientes en espera y algunas
//    mesas ocupadas, sentadas con `assignTable`: el camino normal.
// 3. Usuarios de prueba (ver README, "Usuarios de prueba"), SOLO si NODE_ENV
//    no es production. En producción el primer admin se crea con
//    `npm run create-admin`, sin contraseñas escritas en el código.
//
// Los ids son fijos y deterministas a propósito: el seed se puede correr las
// veces que haga falta sin duplicar nada.

import { config } from "dotenv";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import { ELEMENT_TYPE_KEYS, SEATABLE_ELEMENT_KEYS, type ElementTypeKey, type Role } from "../lib/db/enums";
import { db } from "../lib/db";
import {
  brands,
  elementTypes,
  restaurants,
  tableLayouts,
  tables,
  userRestaurants,
  userRoles,
  waitlistEntries,
} from "../lib/db/schema";
import { createUserWithPassword, findUserIdByEmail } from "../lib/auth/users";
import { copyLayoutToRestaurant, getStructureCounts } from "../lib/layout/copy";
import { assignTable } from "../lib/tables/assign";

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

/** Colores de acento: se evitan el amarillo y el rojo puros de la alerta del mapa. */
const DEMO_BRANDS = [
  { id: "brand_china_wok", name: "China Wok", accentColor: "#f97316" },
  { id: "brand_pizza_hut", name: "Pizza Hut", accentColor: "#ef4444" },
  { id: "brand_kfc", name: "KFC", accentColor: "#ec4899" },
  { id: "brand_dennys", name: "Denny's", accentColor: "#a3e635" },
] as const;

const TGU = "Tegucigalpa";
const SPS = "San Pedro Sula";

/**
 * `mapX`/`mapY` van de 0 a 1000 y caen dentro de los distritos que dibuja
 * `lib/map/world.ts`: San Pedro Sula arriba a la izquierda y Tegucigalpa
 * abajo a la derecha, más o menos como están en el país.
 */
const DEMO_RESTAURANTS = [
  { id: "rest_centro", name: "China Wok Centro", slug: "demo-centro", brandId: "brand_china_wok", city: TGU, mapX: 660, mapY: 610 },
  { id: "rest_norte", name: "Pizza Hut Norte", slug: "demo-norte", brandId: "brand_pizza_hut", city: SPS, mapX: 250, mapY: 190 },
  { id: "rest_tgu_pizza", name: "Pizza Hut Los Próceres", slug: "pizza-hut-los-proceres", brandId: "brand_pizza_hut", city: TGU, mapX: 830, mapY: 590 },
  { id: "rest_tgu_kfc", name: "KFC Boulevard Morazán", slug: "kfc-boulevard-morazan", brandId: "brand_kfc", city: TGU, mapX: 780, mapY: 740 },
  { id: "rest_tgu_dennys", name: "Denny's Las Lomas", slug: "dennys-las-lomas", brandId: "brand_dennys", city: TGU, mapX: 620, mapY: 830 },
  { id: "rest_sps_chinawok", name: "China Wok Circunvalación", slug: "china-wok-circunvalacion", brandId: "brand_china_wok", city: SPS, mapX: 380, mapY: 300 },
  { id: "rest_sps_kfc", name: "KFC Río Piedras", slug: "kfc-rio-piedras", brandId: "brand_kfc", city: SPS, mapX: 170, mapY: 360 },
  { id: "rest_sps_dennys", name: "Denny's Los Andes", slug: "dennys-los-andes", brandId: "brand_dennys", city: SPS, mapX: 330, mapY: 460 },
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
  for (const b of DEMO_BRANDS) {
    await db
      .insert(brands)
      .values(b)
      .onConflictDoUpdate({ target: brands.id, set: { name: b.name, accentColor: b.accentColor } });
  }
  for (const r of DEMO_RESTAURANTS) {
    // Si ya existía (una base de antes del mapa), se le ponen nombre, marca,
    // ciudad y posición; el slug no se toca porque puede estar en URLs
    // guardadas.
    const { id, slug, ...mapFields } = r;
    await db
      .insert(restaurants)
      .values({ id, slug, ...mapFields })
      .onConflictDoUpdate({ target: restaurants.id, set: { ...mapFields, updatedAt: new Date() } });
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

  console.log(`  brands: ${DEMO_BRANDS.length}`);
  console.log(`  restaurants: ${DEMO_RESTAURANTS.length}`);
  console.log(`  table_layouts: ${DEMO_LAYOUTS.length}`);
  console.log(`  tables: ${DEMO_TABLES.length}`);
  console.log(`  waitlist_entries: ${DEMO_WAITLIST.length}`);
}

// ---------------------------------------------------------------------------
// Mapa general: planos copiados, clientes en espera y mesas ocupadas
// ---------------------------------------------------------------------------

/** De qué restaurante copia su plano cada uno de los nuevos. */
const COPY_FROM: Record<string, "rest_centro" | "rest_norte"> = {
  rest_tgu_pizza: "rest_centro",
  rest_tgu_kfc: "rest_centro",
  rest_tgu_dennys: "rest_norte",
  rest_sps_chinawok: "rest_centro",
  rest_sps_kfc: "rest_norte",
  rest_sps_dennys: "rest_centro",
};

/**
 * Cuántos esperan (y hace cuántos minutos llegó cada uno), cuántas mesas se
 * ocupan y cuántas se reservan. Pensado para que el mapa enseñe los tres
 * niveles: KFC Boulevard Morazán y Denny's Los Andes pasan de 40 min (rojo),
 * China Wok Circunvalación y Pizza Hut Norte de 20 (amarillo), el resto no.
 */
const LIVE_PLAN: Record<string, { waitingMinutes: number[]; seated: number; reserved: number }> = {
  rest_centro: { waitingMinutes: [12, 8], seated: 3, reserved: 1 },
  rest_norte: { waitingMinutes: [34, 30, 27, 24], seated: 2, reserved: 0 },
  rest_tgu_pizza: { waitingMinutes: [11, 7, 3], seated: 4, reserved: 1 },
  rest_tgu_kfc: { waitingMinutes: [62, 58, 55, 50, 47, 44, 41, 38, 35], seated: 7, reserved: 0 },
  rest_tgu_dennys: { waitingMinutes: [4], seated: 1, reserved: 1 },
  rest_sps_chinawok: { waitingMinutes: [32, 29, 27, 25, 23, 22], seated: 6, reserved: 1 },
  rest_sps_kfc: { waitingMinutes: [], seated: 1, reserved: 0 },
  rest_sps_dennys: { waitingMinutes: [55, 49, 44, 40], seated: 5, reserved: 2 },
};

/**
 * Mesas que el seed deja siempre libres: son las de la demo a mano del README
 * (`npm run demo:host -- sentar tbl_c_1 wl_1`, `carrera tbl_c_2 ...`).
 */
const KEEP_FREE = new Set(["tbl_c_1", "tbl_c_2"]);

const DEMO_NAMES = [
  "María López", "José Martínez", "Carmen Flores", "Juan Hernández", "Rosa Mejía",
  "Carlos Reyes", "Lucía Castillo", "Pedro Zelaya", "Sofía Aguilar", "Miguel Cruz",
  "Elena Pineda", "Andrés Maradiaga", "Valeria Ramos", "Diego Bonilla", "Paola Sierra",
];

async function seedWorldMap() {
  // 1. Planos: solo a quien no tiene ninguna zona, para que repetir el seed
  //    no pise lo que alguien editó a mano.
  let copied = 0;
  for (const [targetRestaurantId, sourceRestaurantId] of Object.entries(COPY_FROM)) {
    if ((await getStructureCounts(targetRestaurantId)).zones > 0) continue;
    const result = await copyLayoutToRestaurant({ sourceRestaurantId, targetRestaurantId, replace: false });
    if (!result.ok) throw new Error(`No se pudo copiar el plano a ${targetRestaurantId}: ${result.error}`);
    copied += 1;
  }

  // 2. Clientes, ocupación y reservas.
  const seatableTypes = await db
    .select({ id: elementTypes.id })
    .from(elementTypes)
    .where(inArray(elementTypes.key, [...SEATABLE_ELEMENT_KEYS]));
  const seatableIds = seatableTypes.map((t) => t.id);
  const now = Date.now();
  let nameIndex = 0;
  const nextName = () => DEMO_NAMES[nameIndex++ % DEMO_NAMES.length];
  let seatedCount = 0;

  for (const [restaurantId, plan] of Object.entries(LIVE_PLAN)) {
    const waiting = plan.waitingMinutes.map((minutes, i) => ({
      id: `wl_${restaurantId}_e${i + 1}`,
      restaurantId,
      customerName: nextName(),
      partySize: 2 + (i % 4),
      status: "esperando",
      arrivedAt: new Date(now - minutes * 60_000),
    }));
    // Los que se sientan también pasan por la lista: llegaron antes.
    const toSeat = Array.from({ length: plan.seated }, (_, i) => ({
      id: `wl_${restaurantId}_s${i + 1}`,
      restaurantId,
      customerName: nextName(),
      partySize: 2 + (i % 3),
      status: "esperando",
      arrivedAt: new Date(now - (70 + i * 5) * 60_000),
    }));
    if (waiting.length + toSeat.length > 0) {
      await db
        .insert(waitlistEntries)
        .values([...waiting, ...toSeat])
        .onConflictDoNothing({ target: waitlistEntries.id });
    }

    const restaurantTables = await db
      .select({ id: tables.id, currentEntryId: tables.currentEntryId, status: tables.status })
      .from(tables)
      .innerJoin(tableLayouts, eq(tableLayouts.id, tables.layoutId))
      .where(and(eq(tables.restaurantId, restaurantId), inArray(tables.elementTypeId, seatableIds)))
      .orderBy(asc(tableLayouts.sortOrder), asc(tables.y), asc(tables.x), asc(tables.id));
    const free = restaurantTables.filter(
      (t) => t.currentEntryId === null && t.status !== "reservada" && !KEEP_FREE.has(t.id),
    );

    for (const entry of toSeat) {
      const table = free[0];
      if (!table) break;
      // Si el cliente ya se sentó en un seed anterior, `assignTable` lo
      // rechaza y la mesa queda libre para el siguiente.
      const result = await assignTable({ restaurantId, tableId: table.id, entryId: entry.id, userId: null });
      if (result.ok) {
        free.shift();
        seatedCount += 1;
      }
    }

    // Reservadas, de las últimas mesas libres. El estado lo escribe el seed,
    // nunca el editor.
    const reservedNow = restaurantTables.filter((t) => t.status === "reservada").length;
    const toReserve = Math.max(0, plan.reserved - reservedNow);
    for (const table of toReserve > 0 ? free.slice(-toReserve) : []) {
      await db
        .update(tables)
        .set({ status: "reservada", version: sql`${tables.version} + 1`, updatedAt: new Date() })
        .where(and(eq(tables.id, table.id), isNull(tables.currentEntryId)));
    }
  }

  console.log(`  mapa general: ${copied} planos copiados, ${seatedCount} mesas ocupadas`);
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
  await db.delete(brands);
  console.log("  datos de layout, marcas y lista de espera borrados");
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
  await seedWorldMap();
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
