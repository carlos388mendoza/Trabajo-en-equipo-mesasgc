// Los datos en sí del lote de DEMOSTRACIÓN.
//
// Esto es solo data: no toca la base de datos. Quien carga el lote es
// `lib/demo/load.ts` y quien lo borra `lib/demo/delete.ts`, y ambos usan este
// archivo.
//
// Reglas que este archivo cumple para que nada se confunda con lo real:
//
//  1. Todos los ids llevan el prefijo `demo_` y son DETERMINISTAS. Repetir la
//     carga choca con las filas que ya están y no crea nada nuevo (el lote es
//     idempotente) y, además, un id humano se reconoce a ojo en el editor.
//  2. Cada fila que se inserta va marcada con `is_demo` y `demo_batch_id`. Es
//     la marca que usa el borrado; los nombres son solo para que se lea bien.
//  3. Ningún dato de aquí describe una persona, un local ni una marca real. Los
//     restaurantes son los reales (para que el mapa se vea completo) pero solo
//     se les AÑADE una zona demo; su zona real, sus mesas y sus clientes no se
//     tocan. Los nombres de persona son inventados y los teléfonos son de
//     mentira (`0000-0000-...`).
//  4. Los planos del demo son zonas nuevas de cada restaurante, con `is_demo`.
//     Por eso borrar el demo no puede llevarse por delante un plano dibujado a
//     mano.

import { SEATABLE_ELEMENT_KEYS } from "@/lib/db/enums";

/** Prefijo de todos los ids que crea el demo, para reconocerlos a ojo. */
export const DEMO_ID_PREFIX = "demo_";

/**
 * Versión del lote. Va en `demo_batch_id` de cada fila: borrar un lote es
 * borrarlo entero, y un lote futuro se distingue de este sin tocar el código de
 * borrado.
 */
export const DEMO_BATCH_ID = "demo_v1";

/** Días de historial que se generan: 8 semanas. */
export const DEMO_HISTORY_DAYS = 56;

/**
 * Teléfono de mentira. Todos los clientes del demo llevan esta raíz en lugar
 * de un número real, así que se distinguen de un vistazo en la lista de espera
 * y ninguno podría llamar a nadie por accidente.
 */
export const DEMO_PHONE_PREFIX = "0000-0000-";

/** Nota que llevan los clientes demo: queda claro al leerlos. */
export const DEMO_NOTE = "Cliente de demostración: no es una persona real.";

/**
 * Palabra que hay que escribir para BORRAR el lote desde la web.
 *
 * Vive aquí y no en `app/admin/demo-actions.ts` porque un archivo `"use server"`
 * solo puede exportar funciones async: si la constante saliera de ahí, el build
 * de Next la rechazaría. La usan el botón (para habilitarse) y la action (para
 * comprobarlo), y por eso están en el mismo sitio.
 */
export const DEMO_DELETE_WORD = "BORRAR";

export type DemoLayoutPlan = {
  /** Id determinista de la zona demo. */
  id: string;
  restaurantId: string;
  /** Nombre visible. Solo informativo: la marca estructural es `is_demo`. */
  name: string;
  description: string;
  sortOrder: number;
};

export type DemoTablePlan = {
  /** Id determinista: repetir la carga no lo cambia. */
  id: string;
  layoutId: string;
  /** Clave de `element_types` ("mesa-sillas", "bano", "caja"...). */
  typeKey: string;
  label: string;
  x: number;
  y: number;
  /** Aforo; null en lo que no es mesa. */
  capacity: number | null;
};

export type DemoRestaurantPlan = {
  restaurantId: string;
  layout: DemoLayoutPlan;
  tables: DemoTablePlan[];
  /** Mesas demo que quedan OCUPADAS ahora. */
  occupied: number;
  /** Mesas demo que quedan RESERVADAS ahora. */
  reserved: number;
  /** Minutos que lleva esperando cada cliente que está en la sala. */
  waitingMinutes: number[];
};

function plan(
  id: string,
  layoutId: string,
  typeKey: string,
  label: string,
  x: number,
  y: number,
  capacity: number | null = null,
): DemoTablePlan {
  return { id: `${DEMO_ID_PREFIX}${id}`, layoutId, typeKey, label, x, y, capacity };
}

/**
 * Sala estándar de una zona demo: mesas con sillas, una bancada, baños, caja y
 * zona de juegos. Va en rejilla para que se lea de un vistazo en el editor.
 *
 * `prefix` da nombre a los ids, de modo que cada restaurante tiene los suyos y
 * ninguno choca con el de al lado.
 */
function standardRoom(prefix: string, layoutId: string): DemoTablePlan[] {
  const id = (suffix: string) => `${DEMO_ID_PREFIX}${prefix}_${suffix}`;
  return [
    // Fila 1: cuatro mesas con sillas.
    plan(id("m1"), layoutId, "mesa-sillas", "Mesa 1", 120, 120, 4),
    plan(id("m2"), layoutId, "mesa-sillas", "Mesa 2", 300, 120, 4),
    plan(id("m3"), layoutId, "mesa-sillas", "Mesa 3", 120, 280, 2),
    plan(id("m4"), layoutId, "mesa-sillas", "Mesa 4", 300, 280, 2),
    // Fila 2: dos más y una bancada.
    plan(id("m5"), layoutId, "mesa-sillas", "Mesa 5", 480, 120, 4),
    plan(id("m6"), layoutId, "mesa-sillas", "Mesa 6", 480, 280, 6),
    plan(id("b1"), layoutId, "mesa-butacas", "Bancada 1", 660, 120, 6),
    // Servicios: en ellos no se sienta nadie.
    plan(id("bano"), layoutId, "bano", "Baños", 100, 520, null),
    plan(id("caja"), layoutId, "caja", "Caja", 700, 300, null),
    plan(id("juegos"), layoutId, "area-juegos", "Zona infantil", 480, 520, null),
  ];
}

/** Terraza: cuatro mesas, su caja y sus baños. Va en la zona demo principal. */
function terrace(prefix: string, layoutId: string): DemoTablePlan[] {
  const id = (suffix: string) => `${DEMO_ID_PREFIX}${prefix}_${suffix}`;
  return [
    plan(id("t1"), layoutId, "mesa-sillas", "Terraza 1", 140, 460, 4),
    plan(id("t2"), layoutId, "mesa-sillas", "Terraza 2", 320, 460, 4),
    plan(id("t3"), layoutId, "mesa-sillas", "Terraza 3", 140, 620, 4),
    plan(id("t4"), layoutId, "mesa-butacas", "Bancada terraza", 320, 620, 8),
    plan(id("caja_t"), layoutId, "caja", "Caja terraza", 560, 460, null),
    plan(id("bano_t"), layoutId, "bano", "Baños terraza", 560, 620, null),
  ];
}

/** Zona demo de un restaurante: tamaño pensado para que quepa todo lo de arriba. */
function demoLayout(restaurantId: string, suffix: string, sortOrder = 0): DemoLayoutPlan {
  return {
    id: `${DEMO_ID_PREFIX}lay_${suffix}`,
    restaurantId,
    name: "Comedor (demostración)",
    description: "Zona de demostración: mesas, baño, caja y zona de juegos.",
    sortOrder,
  };
}

// Los 8 restaurantes reales de Grupo Comidas, con los mismos ids que
// `lib/layout/base-restaurants.ts` y el mismo ritmo que el seed de desarrollo
// (para que las cifras con el demo cargado se parezcan a las que el equipo ya
// conoce, pero en datos que se pueden tirar sin riesgo).
export const DEMO_PLANS: DemoRestaurantPlan[] = [
  {
    restaurantId: "rest_centro",
    layout: demoLayout("rest_centro", "centro"),
    tables: [...standardRoom("centro", `${DEMO_ID_PREFIX}lay_centro`), ...terrace("centro", `${DEMO_ID_PREFIX}lay_centro`)],
    occupied: 3,
    reserved: 1,
    waitingMinutes: [12, 8],
  },
  {
    restaurantId: "rest_norte",
    layout: demoLayout("rest_norte", "norte"),
    tables: standardRoom("norte", `${DEMO_ID_PREFIX}lay_norte`),
    occupied: 2,
    reserved: 0,
    waitingMinutes: [34, 30, 27, 24],
  },
  {
    restaurantId: "rest_tgu_pizza",
    layout: demoLayout("rest_tgu_pizza", "tgu_pizza"),
    tables: standardRoom("tgu_pizza", `${DEMO_ID_PREFIX}lay_tgu_pizza`),
    occupied: 4,
    reserved: 1,
    waitingMinutes: [11, 7, 3],
  },
  {
    restaurantId: "rest_tgu_kfc",
    layout: demoLayout("rest_tgu_kfc", "tgu_kfc"),
    tables: standardRoom("tgu_kfc", `${DEMO_ID_PREFIX}lay_tgu_kfc`),
    occupied: 7,
    reserved: 0,
    waitingMinutes: [62, 58, 55, 50, 47, 44, 41, 38, 35],
  },
  {
    restaurantId: "rest_tgu_dennys",
    layout: demoLayout("rest_tgu_dennys", "tgu_dennys"),
    tables: standardRoom("tgu_dennys", `${DEMO_ID_PREFIX}lay_tgu_dennys`),
    occupied: 1,
    reserved: 1,
    waitingMinutes: [4],
  },
  {
    restaurantId: "rest_sps_chinawok",
    layout: demoLayout("rest_sps_chinawok", "sps_chinawok"),
    tables: standardRoom("sps_chinawok", `${DEMO_ID_PREFIX}lay_sps_chinawok`),
    occupied: 6,
    reserved: 1,
    waitingMinutes: [32, 29, 27, 25, 23, 22],
  },
  {
    restaurantId: "rest_sps_kfc",
    layout: demoLayout("rest_sps_kfc", "sps_kfc"),
    tables: standardRoom("sps_kfc", `${DEMO_ID_PREFIX}lay_sps_kfc`),
    occupied: 1,
    reserved: 0,
    waitingMinutes: [],
  },
  {
    restaurantId: "rest_sps_dennys",
    layout: demoLayout("rest_sps_dennys", "sps_dennys"),
    tables: standardRoom("sps_dennys", `${DEMO_ID_PREFIX}lay_sps_dennys`),
    occupied: 5,
    reserved: 2,
    waitingMinutes: [55, 49, 44, 40],
  },
];

/**
 * Ritmo del historial de cada restaurante: grupos en un día normal, espera
 * base, minutos extra en el pico y proporción de ausentes.
 *
 * Los mismos valores que el seed de desarrollo, a propósito: el demo tiene que
 * enseñar el mismo sistema que ya se conoce.
 */
export const DEMO_HISTORY_PROFILE: Record<
  string,
  { groups: number; baseWait: number; peakWait: number; absentRate: number }
> = {
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
export const DEMO_WEEKDAY_LOAD = [1.35, 0.7, 0.75, 0.8, 0.9, 1.3, 1.55];

/** Habituales, con cuántas veces vienen por semana: de ahí sale el "top de clientes". */
export const DEMO_REGULAR_VISITS_PER_WEEK = [3, 2.5, 2, 2, 1.5, 1.5, 1, 1];

export const DEMO_FIRST_NAMES = [
  "María", "José", "Carmen", "Juan", "Rosa", "Carlos", "Lucía", "Pedro", "Sofía",
  "Miguel", "Elena", "Andrés", "Valeria", "Diego", "Paola", "Jorge",
  "Gabriela", "Luis", "Daniela", "Ricardo", "Fernanda", "Óscar", "Alejandra",
  "Mario", "Karla", "Roberto", "Isabel", "Héctor", "Natalia", "Fernando",
  "Claudia", "Javier", "Patricia", "Raúl", "Mónica", "Kevin", "Wendy",
  "Allan", "Dania", "Marvin",
] as const;

export const DEMO_LAST_NAMES = [
  "López", "Martínez", "Flores", "Hernández", "Mejía", "Reyes", "Castillo",
  "Zelaya", "Aguilar", "Cruz", "Pineda", "Maradiaga", "Ramos", "Bonilla",
  "Sierra", "Rodríguez", "García", "Mendoza", "Ortiz", "Rivera", "Velásquez",
  "Andino", "Funes", "Ordóñez", "Banegas", "Cálix", "Padilla", "Espinoza",
  "Galeas", "Turcios",
] as const;

/** Los tipos en los que se puede sentar a alguien (los usa la carga). */
export const DEMO_SEATABLE_KEYS = SEATABLE_ELEMENT_KEYS;