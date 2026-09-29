import { and, asc, eq, gte, inArray, lt, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import { restaurants, waitlistEntries } from "@/lib/db/schema";
import {
  addCalendarDays,
  hondurasDateKey,
  hondurasMidnightUtc,
  hondurasToday,
  hondurasWeekday,
} from "@/lib/time/honduras";

const DAYS = 14;
const MINUTE_MS = 60_000;

export type AnalyticsFilters = {
  restaurantId?: string | null;
  /** En el esquema actual la marca se identifica por el nombre del restaurante. */
  brand?: string;
};

export type DailyStat = {
  day: string;
  date: string;
  groups: number;
  minutes: number;
};

export type RestaurantStat = {
  id: string;
  name: string;
  groups: number;
  minutes: number;
};

export type CustomerStat = {
  name: string;
  groups: number;
  minutes: number;
};

export type AnalyticsData = {
  filters: { restaurantId: string | null; brand: string };
  period: { startDate: string; endDate: string; timeZone: "America/Tegucigalpa" };
  restaurantsAvailable: { id: string; name: string }[];
  totals: {
    groups: number;
    todayGroups: number;
    averageWaitMinutes: number;
    changePercent: number | null;
    fastestDay: DailyStat | null;
    slowestDay: DailyStat | null;
  };
  daily: DailyStat[];
  restaurants: RestaurantStat[];
  topCustomers: CustomerStat[];
  summary: string;
};

export async function getAnalytics(
  filters: AnalyticsFilters = {},
  now = new Date(),
): Promise<AnalyticsData> {
  const today = hondurasToday(now);
  const startDate = addCalendarDays(today, -(DAYS - 1));
  const endDate = addCalendarDays(today, 1);
  const previousStartDate = addCalendarDays(today, -(DAYS * 2 - 1));
  const currentStart = hondurasMidnightUtc(startDate);
  const currentEnd = hondurasMidnightUtc(endDate);
  const previousStart = hondurasMidnightUtc(previousStartDate);
  const restaurantId = filters.restaurantId?.trim() || null;
  const brand = filters.brand?.trim() ?? "";

  const restaurantRows = await db
    .select({ id: restaurants.id, name: restaurants.name })
    .from(restaurants)
    .orderBy(asc(restaurants.name));
  const scopedRestaurants = restaurantRows.filter((restaurant) => {
    if (restaurantId && restaurant.id !== restaurantId) return false;
    // No existe una columna `brand` en el esquema actual; se puede filtrar
    // por marca/nombre visible sin inventar una columna ni alterar el schema.
    return !brand || restaurant.name.toLocaleLowerCase("es-HN").includes(brand.toLocaleLowerCase("es-HN"));
  });
  const scopedIds = scopedRestaurants.map((restaurant) => restaurant.id);
  const scopedBySelection = Boolean(restaurantId || brand);
  const conditions = (start: Date, end: Date): SQL | undefined => and(
    eq(waitlistEntries.status, "sentado"),
    gte(waitlistEntries.seatedAt, start),
    lt(waitlistEntries.seatedAt, end),
    ...(scopedBySelection ? [inArray(waitlistEntries.restaurantId, scopedIds)] : []),
  );

  const [currentRows, previousRows] = await Promise.all([
    db.select().from(waitlistEntries)
      .where(conditions(currentStart, currentEnd))
      .orderBy(asc(waitlistEntries.seatedAt)),
    db.select().from(waitlistEntries)
      .where(conditions(previousStart, currentStart))
      .orderBy(asc(waitlistEntries.seatedAt)),
  ]);

  const daily: DailyStat[] = Array.from({ length: DAYS }, (_, index) => {
    const date = addCalendarDays(startDate, index);
    const dayEntries = currentRows.filter((entry) => hondurasDateKey(entry.seatedAt!) === date);
    return {
      day: hondurasWeekday(date),
      date,
      groups: dayEntries.length,
      minutes: averageWait(dayEntries),
    };
  });
  const activeDays = daily.filter((day) => day.groups > 0);
  const fastestDay = activeDays.reduce<DailyStat | null>(
    (best, day) => !best || day.minutes < best.minutes ? day : best,
    null,
  );
  const slowestDay = activeDays.reduce<DailyStat | null>(
    (best, day) => !best || day.minutes > best.minutes ? day : best,
    null,
  );
  const waits = currentRows.map((entry) => waitMinutes(entry.arrivedAt, entry.seatedAt!));
  const changePercent = previousRows.length
    ? Math.round(((currentRows.length - previousRows.length) / previousRows.length) * 100)
    : null;

  const restaurantsStats: RestaurantStat[] = scopedRestaurants.map((restaurant) => {
    const entries = currentRows.filter((entry) => entry.restaurantId === restaurant.id);
    return {
      id: restaurant.id,
      name: restaurant.name,
      groups: entries.length,
      minutes: averageWait(entries),
    };
  });

  const byCustomer = new Map<string, { count: number; totalMinutes: number }>();
  for (const entry of currentRows) {
    const current = byCustomer.get(entry.customerName) ?? { count: 0, totalMinutes: 0 };
    current.count += 1;
    current.totalMinutes += waitMinutes(entry.arrivedAt, entry.seatedAt!);
    byCustomer.set(entry.customerName, current);
  }
  const topCustomers = [...byCustomer.entries()]
    .map(([name, value]) => ({
      name,
      groups: value.count,
      minutes: Math.round(value.totalMinutes / value.count),
    }))
    .sort((a, b) => b.groups - a.groups || a.name.localeCompare(b.name, "es-HN"))
    .slice(0, 10);

  const summary = currentRows.length
    ? `En los últimos 14 días (hora de Honduras) se sentaron ${currentRows.length} grupos; la espera promedio fue de ${average(waits)} minutos. ${slowestDay ? `El día más lento fue ${slowestDay.day}, con ${slowestDay.minutes} minutos de espera.` : ""}${topCustomers[0] ? ` El cliente con más grupos fue ${topCustomers[0].name}, con ${topCustomers[0].groups}.` : ""}`.trim()
    : "Todavía no hay grupos sentados en los últimos 14 días.";

  return {
    filters: { restaurantId, brand },
    period: { startDate, endDate: today, timeZone: "America/Tegucigalpa" },
    restaurantsAvailable: restaurantRows,
    totals: {
      groups: currentRows.length,
      todayGroups: currentRows.filter((entry) => hondurasDateKey(entry.seatedAt!) === today).length,
      averageWaitMinutes: average(waits),
      changePercent,
      fastestDay,
      slowestDay,
    },
    daily,
    restaurants: restaurantsStats,
    topCustomers,
    summary,
  };
}

function waitMinutes(arrivedAt: Date, seatedAt: Date): number {
  return Math.max(0, (seatedAt.getTime() - arrivedAt.getTime()) / MINUTE_MS);
}

function average(values: number[]): number {
  return values.length
    ? Math.round(values.reduce((sum, value) => sum + value, 0) / values.length)
    : 0;
}

function averageWait(entries: { arrivedAt: Date; seatedAt: Date | null }[]): number {
  return average(entries.map((entry) => waitMinutes(entry.arrivedAt, entry.seatedAt!)));
}
