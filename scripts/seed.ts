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
// 2c. Historial: 8 semanas de clientes ya atendidos o ausentes en los 8
//    restaurantes, para las estadísticas y el asistente (ver `seedHistory`).
// 3. Usuarios de prueba (ver README, "Usuarios de prueba"): un admin, una
//    analista, un gerente y un host por restaurante.
//
// Nada de esto se corre en producción: con NODE_ENV=production el seed se
// niega a arrancar. Allí el primer admin se crea con `npm run create-admin`,
// sin contraseñas escritas en el código.
//
// Los ids son fijos y deterministas a propósito: el seed se puede correr las
// veces que haga falta sin duplicar nada.

import { config } from "dotenv";

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";

import { ELEMENT_TYPE_KEYS, SEATABLE_ELEMENT_KEYS, type Role } from "../lib/db/enums";
import { db } from "../lib/db";
import {
  brands,
  elementTypes,
  restaurants,
  tableLayouts,
  tables,
  userRestaurants,
  userRoles,
  waiterConfigs,
  waiterZones,
  waitlistEntries,
} from "../lib/db/schema";
import { createUserWithPassword, findUserIdByEmail } from "../lib/auth/users";
import { BASE_BRANDS, BASE_RESTAURANTS } from "../lib/layout/base-restaurants";
import { upsertElementTypeCatalog } from "../lib/layout/catalog";
import { copyLayoutToRestaurant, getStructureCounts } from "../lib/layout/copy";
import { assignTable } from "../lib/tables/assign";
import { createWaiterConfig, waiterNameForTableSql } from "../lib/waiters/configs";
import { addCalendarDays, hondurasMidnightUtc, hondurasToday } from "../lib/time/honduras";

// dotenv no lee solo `.env`, y Next usa `.env.local`: se le pasan los dos.
config({ path: [".env.local", ".env"] });

// ---------------------------------------------------------------------------
// Catálogo de tipos de elemento
//
// Vive en `lib/layout/catalog.ts` porque producción también lo carga, con
// `npm run db:catalog` en el Pre-deploy: el seed no se corre allí.
// ---------------------------------------------------------------------------

async function seedElementTypes() {
  const count = await upsertElementTypeCatalog();
  console.log(`  element_types: ${count} tipos`);
}

// ---------------------------------------------------------------------------
// Datos de ejemplo
// ---------------------------------------------------------------------------

// Las marcas y los restaurantes son los reales, compartidos con
// `npm run db:restaurantes` (ver `lib/layout/base-restaurants.ts`). El seed los
// actualiza si ya existían; `db:restaurantes`, en cambio, nunca pisa nada.
const DEMO_BRANDS = BASE_BRANDS;
const DEMO_RESTAURANTS = BASE_RESTAURANTS;

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
      arrivedAt: new Date(now - (12 + i * 3) * 60_000),
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

// ---------------------------------------------------------------------------
// Historial: 8 semanas de lista de espera ya resuelta
//
// Alimenta las estadísticas (espera promedio, día más rápido y más lento, top
// de clientes, comparación por restaurante y marca) y el asistente. Solo usa
// los estados CERRADOS: "sentado" (atendido, lo que cuentan las estadísticas)
// y "ausente". Nunca "esperando" ni "listo", porque los contadores del mapa
// cuentan esos estados sin mirar la fecha y el historial aparecería como gente
// esperando ahora.
//
// Todo es determinista: el generador pseudoaleatorio se siembra con el
// restaurante y la fecha, y el id de cada fila sale de los mismos datos
// (`wl_h_<restaurante>_<fecha>_<n>`). Repetir el seed no duplica nada, y
// correrlo otro día solo añade los días que faltan.
// ---------------------------------------------------------------------------

const HISTORY_DAYS = 56;

/**
 * El ritmo de cada restaurante: grupos en un día normal, espera fuera de hora
 * pico, minutos extra en el pico y proporción de ausentes. KFC Boulevard
 * Morazán es el más lleno y lento; Denny's Las Lomas, el más tranquilo.
 */
const HISTORY_PROFILE: Record<string, { groups: number; baseWait: number; peakWait: number; absentRate: number }> = {
  rest_centro: { groups: 26, baseWait: 7, peakWait: 11, absentRate: 0.07 },
  rest_norte: { groups: 22, baseWait: 9, peakWait: 12, absentRate: 0.08 },
  rest_tgu_pizza: { groups: 20, baseWait: 6, peakWait: 8, absentRate: 0.06 },
  rest_tgu_kfc: { groups: 36, baseWait: 10, peakWait: 18, absentRate: 0.11 },
  rest_tgu_dennys: { groups: 14, baseWait: 5, peakWait: 6, absentRate: 0.05 },
  rest_sps_chinawok: { groups: 28, baseWait: 8, peakWait: 13, absentRate: 0.08 },
  rest_sps_kfc: { groups: 18, baseWait: 6, peakWait: 8, absentRate: 0.07 },
  rest_sps_dennys: { groups: 24, baseWait: 9, peakWait: 16, absentRate: 0.1 },
};

/** Afluencia por día de la semana (0 = domingo): el fin de semana se llena. */
const WEEKDAY_LOAD = [1.35, 0.7, 0.75, 0.8, 0.9, 1.3, 1.55];

const FIRST_NAMES = [
  "María", "José", "Carmen", "Juan", "Rosa", "Carlos", "Lucía", "Pedro", "Sofía", "Miguel",
  "Elena", "Andrés", "Valeria", "Diego", "Paola", "Jorge", "Gabriela", "Luis", "Daniela", "Ricardo",
  "Fernanda", "Óscar", "Alejandra", "Mario", "Karla", "Roberto", "Isabel", "Héctor", "Natalia", "Fernando",
  "Claudia", "Javier", "Patricia", "Raúl", "Mónica", "Kevin", "Wendy", "Allan", "Dania", "Marvin",
];
const LAST_NAMES = [
  "López", "Martínez", "Flores", "Hernández", "Mejía", "Reyes", "Castillo", "Zelaya", "Aguilar", "Cruz",
  "Pineda", "Maradiaga", "Ramos", "Bonilla", "Sierra", "Rodríguez", "García", "Mendoza", "Ortiz", "Rivera",
  "Velásquez", "Andino", "Funes", "Ordóñez", "Banegas", "Cálix", "Padilla", "Espinoza", "Galeas", "Turcios",
];

/**
 * Clientes que repiten en cada restaurante, con cuántas veces vienen por
 * semana. Llevan un solo apellido; los que pasan una vez llevan dos, así que
 * no se confunden con ellos y el top de clientes sale de los habituales.
 */
const REGULAR_VISITS_PER_WEEK = [3, 2.5, 2, 2, 1.5, 1.5, 1, 1];

/** Generador pseudoaleatorio con semilla (mulberry32): mismo texto, misma serie. */
function seededRandom(seedText: string): () => number {
  let seed = 2166136261;
  for (const char of seedText) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(random: () => number, mean: number, deviation: number): number {
  return mean + deviation * Math.sqrt(-2 * Math.log(1 - random())) * Math.cos(2 * Math.PI * random());
}

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)];
}

/** Minuto del día (hora de Honduras) en que llega un grupo: picos al mediodía y en la noche. */
function arrivalMinute(random: () => number): number {
  const roll = random();
  const minute = roll < 0.42
    ? normal(random, 12 * 60 + 50, 40)
    : roll < 0.87
      ? normal(random, 19 * 60 + 10, 50)
      : 11 * 60 + random() * 10.5 * 60;
  return Math.round(Math.min(21 * 60 + 45, Math.max(11 * 60, minute)));
}

/** 0 fuera de hora pico, 1 en el centro del pico del mediodía o de la noche. */
function peakLoad(minute: number): number {
  const lunch = Math.exp(-(((minute - 770) / 55) ** 2));
  const dinner = Math.exp(-(((minute - 1150) / 65) ** 2));
  return Math.max(lunch, dinner);
}

function partySize(random: () => number): number {
  const roll = random();
  if (roll < 0.1) return 1;
  if (roll < 0.45) return 2;
  if (roll < 0.65) return 3;
  if (roll < 0.87) return 4;
  if (roll < 0.94) return 5;
  if (roll < 0.98) return 6;
  return 7 + Math.floor(random() * 2);
}

/** Lunes de la semana de `dateKey`, para que toda la semana comparta ritmo. */
function mondayOf(dateKey: string, weekday: number): string {
  return addCalendarDays(dateKey, -((weekday + 6) % 7));
}

function weekdayOf(dateKey: string): number {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay();
}

type HistoryRow = typeof waitlistEntries.$inferInsert;

async function seedHistory() {
  const seatableTypes = await db
    .select({ id: elementTypes.id })
    .from(elementTypes)
    .where(inArray(elementTypes.key, [...SEATABLE_ELEMENT_KEYS]));
  const today = hondurasToday();
  const rows: HistoryRow[] = [];

  for (const [restaurantId, profile] of Object.entries(HISTORY_PROFILE)) {
    const restaurantTables = await db
      .select({ id: tables.id, capacity: tables.capacity })
      .from(tables)
      .where(and(eq(tables.restaurantId, restaurantId), inArray(tables.elementTypeId, seatableTypes.map((t) => t.id))))
      // Orden fijo: el sorteo de mesa tiene que dar lo mismo en cada corrida.
      .orderBy(asc(tables.capacity), asc(tables.id));
    const regularsRandom = seededRandom(`habituales|${restaurantId}`);
    const regulars = REGULAR_VISITS_PER_WEEK.map((visits) => ({
      name: `${pick(regularsRandom, FIRST_NAMES)} ${pick(regularsRandom, LAST_NAMES)}`,
      visits,
      size: partySize(regularsRandom),
    }));

    for (let daysAgo = HISTORY_DAYS; daysAgo >= 1; daysAgo -= 1) {
      const date = addCalendarDays(today, -daysAgo);
      const weekday = weekdayOf(date);
      const random = seededRandom(`${restaurantId}|${date}`);
      // Cada semana tiene su propio ritmo (quincena, feriados...), igual para
      // todos los restaurantes: así hay una semana claramente más lenta.
      const weekRandom = seededRandom(`semana|${mondayOf(date, weekday)}`);
      const weekLoad = 0.85 + weekRandom() * 0.35;
      const load = WEEKDAY_LOAD[weekday] * weekLoad;
      const midnight = hondurasMidnightUtc(date).getTime();

      const guests: { name: string; size: number }[] = regulars
        .filter((regular) => random() < (regular.visits / 7) * WEEKDAY_LOAD[weekday])
        .map((regular) => ({ name: regular.name, size: regular.size }));
      const walkIns = Math.max(0, Math.round(normal(random, profile.groups * load, profile.groups * 0.12)));
      for (let i = 0; i < walkIns; i += 1) {
        guests.push({
          name: `${pick(random, FIRST_NAMES)} ${pick(random, LAST_NAMES)} ${pick(random, LAST_NAMES)}`,
          size: partySize(random),
        });
      }

      guests.forEach((guest, index) => {
        const minute = arrivalMinute(random);
        const arrivedAt = new Date(midnight + minute * 60_000 + Math.floor(random() * 60_000));
        const bigGroup = guest.size >= 5 ? 6 : 0;
        const waitMinutes = Math.max(2, Math.round(
          profile.baseWait + profile.peakWait * peakLoad(minute) * load + bigGroup + normal(random, 0, 3),
        ));
        const calledAt = new Date(arrivedAt.getTime() + waitMinutes * 60_000);
        const base = {
          id: `wl_h_${restaurantId}_${date}_${index + 1}`,
          restaurantId,
          customerName: guest.name,
          partySize: guest.size,
          arrivedAt,
          createdAt: arrivedAt,
        };

        // Las esperas largas espantan a más gente.
        const absentRate = profile.absentRate + (waitMinutes > 30 ? 0.08 : 0);
        if (random() < absentRate) {
          // Unos se fueron antes del aviso; otros no volvieron cuando se les avisó.
          const leftEarly = random() < 0.4;
          const markedAbsent = new Date(leftEarly
            ? arrivedAt.getTime() + Math.round(waitMinutes * 0.7) * 60_000
            : calledAt.getTime() + (8 + Math.floor(random() * 5)) * 60_000);
          rows.push({
            ...base,
            status: "ausente",
            calledAt: leftEarly ? null : calledAt,
            // Para «Ver todas las cartas» («esperó X min»). Sin quién: el
            // historial es anterior a los usuarios de prueba.
            resolvedAt: markedAbsent,
            updatedAt: markedAbsent,
          });
          return;
        }

        const seatedAt = new Date(calledAt.getTime() + (1 + Math.floor(random() * 4)) * 60_000);
        const fits = restaurantTables.filter((t) => (t.capacity ?? 0) >= guest.size);
        const table = fits.length ? pick(random, fits) : restaurantTables.at(-1);
        rows.push({
          ...base,
          status: "sentado",
          calledAt,
          seatedAt,
          assignedTableId: table?.id ?? null,
          updatedAt: seatedAt,
        });
      });
    }
  }

  for (let start = 0; start < rows.length; start += 200) {
    await db
      .insert(waitlistEntries)
      .values(rows.slice(start, start + 200))
      .onConflictDoNothing({ target: waitlistEntries.id });
  }
  const seated = rows.filter((row) => row.status === "sentado").length;
  console.log(`  historial: ${rows.length} grupos en ${HISTORY_DAYS} días (${seated} sentados, ${rows.length - seated} ausentes)`);
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
  // Un host por cada uno de los otros 6 restaurantes del mapa.
  { email: "pizzahut-proceres@grupocomidas.test", name: "Host Pizza Hut Los Próceres", roles: ["restaurante"], restaurantIds: ["rest_tgu_pizza"] },
  { email: "kfc-morazan@grupocomidas.test", name: "Host KFC Boulevard Morazán", roles: ["restaurante"], restaurantIds: ["rest_tgu_kfc"] },
  { email: "dennys-lomas@grupocomidas.test", name: "Host Denny's Las Lomas", roles: ["restaurante"], restaurantIds: ["rest_tgu_dennys"] },
  { email: "chinawok-circunvalacion@grupocomidas.test", name: "Host China Wok Circunvalación", roles: ["restaurante"], restaurantIds: ["rest_sps_chinawok"] },
  { email: "kfc-riopiedras@grupocomidas.test", name: "Host KFC Río Piedras", roles: ["restaurante"], restaurantIds: ["rest_sps_kfc"] },
  { email: "dennys-andes@grupocomidas.test", name: "Host Denny's Los Andes", roles: ["restaurante"], restaurantIds: ["rest_sps_dennys"] },
  // Los del piloto: un usuario por marca, cada uno con sus 2 locales.
  {
    email: "dennys@grupocomidas.test",
    name: "Denny's",
    roles: ["restaurante"],
    restaurantIds: ["rest_tgu_dennys", "rest_sps_dennys"],
  },
  {
    email: "pizzahut@grupocomidas.test",
    name: "Pizza Hut",
    roles: ["restaurante"],
    restaurantIds: ["rest_norte", "rest_tgu_pizza"],
  },
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
// Zonas de meseros de ejemplo
//
// «2 meseros» (activa) y «3 meseros» en los dos restaurantes de ejemplo, con
// nombres de mesero, para que el plano en vivo salga con colores desde el
// primer arranque. Solo si el restaurante no tiene ninguna: no pisa las que
// alguien ya creó.
// ---------------------------------------------------------------------------

const EXAMPLE_WAITERS: Record<string, Record<number, string[]>> = {
  rest_centro: { 2: ["Ana", "Luis"], 3: ["Ana", "Luis", "Marta"] },
  rest_norte: { 2: ["Carlos", "Sofía"], 3: ["Carlos", "Sofía", "Diego"] },
};

async function seedWaiterConfigs() {
  let created = 0;
  for (const [restaurantId, byCount] of Object.entries(EXAMPLE_WAITERS)) {
    const [existing] = await db
      .select({ id: waiterConfigs.id })
      .from(waiterConfigs)
      .where(eq(waiterConfigs.restaurantId, restaurantId))
      .limit(1);
    if (existing) continue;
    for (const [count, names] of Object.entries(byCount)) {
      const result = await createWaiterConfig({ restaurantId, waiterCount: Number(count) });
      if (!result.ok) continue;
      created += 1;
      for (const zone of result.config.zones) {
        const name = names[zone.position - 1];
        if (name) await db.update(waiterZones).set({ waiterName: name }).where(eq(waiterZones.id, zone.id));
      }
    }
  }
  // Los sentados de ejemplo que no tienen mesero: el de su mesa ahora.
  await db
    .update(waitlistEntries)
    .set({ waiterName: waiterNameForTableSql(waitlistEntries.assignedTableId) })
    .where(and(isNull(waitlistEntries.waiterName), sql`${waitlistEntries.assignedTableId} is not null`));
  console.log(`  configuraciones de meseros: ${created} creadas`);
}

// ---------------------------------------------------------------------------

async function main() {
  const reset = process.argv.includes("--reset");

  // Todo el seed es de desarrollo: restaurantes de ejemplo, clientes
  // inventados y usuarios con contraseña pública. En producción no se corre
  // nunca; `--reset` además borraría los datos reales.
  if (process.env.NODE_ENV === "production") {
    throw new Error("El seed es solo para desarrollo y no se corre con NODE_ENV=production.");
  }

  console.log("Sembrando base de datos...");
  if (reset) await resetLayoutData();

  await seedElementTypes();
  await seedDemoData();
  await seedWorldMap();
  await seedHistory();
  await seedWaiterConfigs();
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
