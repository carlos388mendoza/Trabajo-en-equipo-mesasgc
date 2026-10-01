// Historial de demostración: ocho semanas de clientes ya resueltos.
//
// Existe para que /analiticas y el asistente tengan algo que contar antes de que
// haya un solo piloto. Es el mismo generador que usa el seed de desarrollo
// (`scripts/seed.ts`), con dos diferencias que importan:
//
//  1. Las filas nacen marcadas (`is_demo`, `demo_batch_id`) y con id `demo_`.
//  2. NUNCA crea marcas, restaurantes, zonas, mesas ni usuarios: solo filas de
//     `waitlist_entries`. Las mesas que se sortean son las demo del lote, y el
//     sorteo solo escribe `assigned_table_id` (un puntero; no cambia el estado
//     de ninguna mesa).
//
// Determinista: el generador pseudoaleatorio se siembra con el restaurante y la
// fecha, y el id de cada fila sale de esos mismos datos. Repetir la carga no
// duplica nada, y volver a cargarla otro día solo añade los días que falten.

import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import { elementTypes, tables, waitlistEntries } from "@/lib/db/schema";
import { addCalendarDays, hondurasMidnightUtc, hondurasToday } from "@/lib/time/honduras";

import {
  DEMO_BATCH_ID,
  DEMO_FIRST_NAMES,
  DEMO_HISTORY_DAYS,
  DEMO_HISTORY_PROFILE,
  DEMO_ID_PREFIX,
  DEMO_LAST_NAMES,
  DEMO_NOTE,
  DEMO_PHONE_PREFIX,
  DEMO_PLANS,
  DEMO_REGULAR_VISITS_PER_WEEK,
  DEMO_SEATABLE_KEYS,
  DEMO_WEEKDAY_LOAD,
} from "./fixtures";

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

/** Teléfono de mentira: mismo prefijo en todos, distinto final. */
function demoPhone(random: () => number): string {
  const tail = String(Math.floor(random() * 10000)).padStart(4, "0");
  return `${DEMO_PHONE_PREFIX}${tail}`;
}

/** Filas por lote: ~12.000 filas de una vez es una INSERT lentísima. */
const CHUNK = 500;

export type DemoHistoryResult = {
  /** Filas NUEVAS insertadas (las que ya estaban no se cuentan). */
  inserted: number;
  sentados: number;
  ausentes: number;
  /** Restaurantes del plan sin plano demo, a los que no se les puso historial. */
  skipped: string[];
};

/**
 * Inserta el historial de demostración de los 8 restaurantes.
 *
 * Es idempotente: los ids son deterministas y el insert es
 * `ON CONFLICT DO NOTHING`, así que repetirla no añade nada.
 */
export async function loadDemoHistory(
  batchId: string = DEMO_BATCH_ID,
): Promise<DemoHistoryResult> {
  const seatableTypes = await db
    .select({ id: elementTypes.id })
    .from(elementTypes)
    .where(inArray(elementTypes.key, [...DEMO_SEATABLE_KEYS]));
  const seatableIds = seatableTypes.map((t) => t.id);

  const today = hondurasToday();
  const rows: (typeof waitlistEntries.$inferInsert)[] = [];
  const skipped: string[] = [];

  for (const { restaurantId } of DEMO_PLANS) {
    const profile = DEMO_HISTORY_PROFILE[restaurantId];
    if (!profile) continue;

    // Solo las mesas DEMO del restaurante: el historial del demo nunca apunta a
    // una mesa real, ni la cambia (aquí no se escribe `tables`).
    const demoTables = await db
      .select({ id: tables.id, capacity: tables.capacity })
      .from(tables)
      .where(
        and(
          eq(tables.restaurantId, restaurantId),
          eq(tables.isDemo, true),
          inArray(tables.elementTypeId, seatableIds),
        ),
      )
      // Orden fijo: el sorteo de mesa tiene que dar lo mismo en cada corrida.
      .orderBy(asc(tables.capacity), asc(tables.id));
    if (demoTables.length === 0) {
      // No hay plano demo (el restaurante no existe, o aún no se cargó el plano).
      skipped.push(restaurantId);
      continue;
    }

    const regularsRandom = seededRandom(`demo-habituales|${restaurantId}`);
    const regulars = DEMO_REGULAR_VISITS_PER_WEEK.map((visits) => ({
      name: `${pick(regularsRandom, DEMO_FIRST_NAMES)} ${pick(regularsRandom, DEMO_LAST_NAMES)}`,
      visits,
      size: partySize(regularsRandom),
    }));

    for (let daysAgo = DEMO_HISTORY_DAYS; daysAgo >= 1; daysAgo -= 1) {
      const date = addCalendarDays(today, -daysAgo);
      const weekday = weekdayOf(date);
      const random = seededRandom(`demo|${restaurantId}|${date}`);
      // Cada semana tiene su propio ritmo (quincena, feriados...), igual para
      // todos los restaurantes: así hay una semana claramente más lenta.
      const weekRandom = seededRandom(`demo-semana|${mondayOf(date, weekday)}`);
      const weekLoad = 0.85 + weekRandom() * 0.35;
      const load = DEMO_WEEKDAY_LOAD[weekday] * weekLoad;
      const midnight = hondurasMidnightUtc(date).getTime();

      const guests: { name: string; size: number }[] = regulars
        .filter((regular) => random() < (regular.visits / 7) * DEMO_WEEKDAY_LOAD[weekday])
        .map((regular) => ({ name: regular.name, size: regular.size }));
      const walkIns = Math.max(
        0,
        Math.round(normal(random, profile.groups * load, profile.groups * 0.12)),
      );
      for (let i = 0; i < walkIns; i += 1) {
        guests.push({
          name: `${pick(random, DEMO_FIRST_NAMES)} ${pick(random, DEMO_LAST_NAMES)} ${pick(random, DEMO_LAST_NAMES)}`,
          size: partySize(random),
        });
      }

      guests.forEach((guest, index) => {
        const minute = arrivalMinute(random);
        const arrivedAt = new Date(midnight + minute * 60_000 + Math.floor(random() * 60_000));
        const bigGroup = guest.size >= 5 ? 6 : 0;
        const waitMinutes = Math.max(
          2,
          Math.round(
            profile.baseWait
              + profile.peakWait * peakLoad(minute) * load
              + bigGroup
              + normal(random, 0, 3),
          ),
        );
        const calledAt = new Date(arrivedAt.getTime() + waitMinutes * 60_000);
        const base = {
          id: `${DEMO_ID_PREFIX}h_${restaurantId}_${date}_${index + 1}`,
          restaurantId,
          customerName: guest.name,
          partySize: guest.size,
          phone: demoPhone(random),
          notes: DEMO_NOTE,
          isDemo: true,
          demoBatchId: batchId,
          arrivedAt,
          createdAt: arrivedAt,
        };

        // Las esperas largas espantan a más gente.
        const absentRate = profile.absentRate + (waitMinutes > 30 ? 0.08 : 0);
        if (random() < absentRate) {
          // Unos se fueron antes del aviso; otros no volvieron cuando se les avisó.
          const leftEarly = random() < 0.4;
          const markedAbsent = new Date(
            leftEarly
              ? arrivedAt.getTime() + Math.round(waitMinutes * 0.7) * 60_000
              : calledAt.getTime() + (8 + Math.floor(random() * 5)) * 60_000,
          );
          rows.push({
            ...base,
            status: "ausente",
            calledAt: leftEarly ? null : calledAt,
            resolvedAt: markedAbsent,
            updatedAt: markedAbsent,
          });
          return;
        }

        const seatedAt = new Date(calledAt.getTime() + (1 + Math.floor(random() * 4)) * 60_000);
        const fits = demoTables.filter((t) => (t.capacity ?? 0) >= guest.size);
        const table = fits.length ? pick(random, fits) : demoTables.at(-1);
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

  let inserted = 0;
  for (let start = 0; start < rows.length; start += CHUNK) {
    const created = await db
      .insert(waitlistEntries)
      .values(rows.slice(start, start + CHUNK))
      .onConflictDoNothing()
      .returning({ id: waitlistEntries.id });
    inserted += created.length;
  }

  const sentados = rows.filter((row) => row.status === "sentado").length;
  return {
    inserted,
    sentados,
    ausentes: rows.length - sentados,
    skipped,
  };
}