import { and, asc, eq, gte, inArray, lt, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import { getBrandForRestaurant, type AnalyticsBrand } from "@/lib/analytics/brand";
import { brands, restaurants, waitlistEntries } from "@/lib/db/schema";
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
  brandId?: string;
  city?: string;
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
  brand: AnalyticsBrand | null;
  city: string | null;
  groups: number;
  minutes: number;
};

export type CustomerStat = {
  name: string;
  groups: number;
  minutes: number;
};

export type AnalyticsData = {
  filters: { restaurantId: string | null; brandId: string; city: string };
  period: { startDate: string; endDate: string; timeZone: "America/Tegucigalpa" };
  restaurantsAvailable: { id: string; name: string; brand: AnalyticsBrand | null; city: string | null }[];
  brandsAvailable: AnalyticsBrand[];
  citiesAvailable: string[];
  totals: {
    groups: number;
    todayGroups: number;
    averageWaitMinutes: number;
    calledGroups: number;
    averageCallMinutes: number;
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
  const brandId = filters.brandId?.trim() ?? "";
  const city = filters.city?.trim() ?? "";

  const [brandRows, restaurantRows] = await Promise.all([
    db.select({ id: brands.id, name: brands.name, accentColor: brands.accentColor })
      .from(brands)
      .orderBy(asc(brands.name)),
    db.select({
      id: restaurants.id,
      name: restaurants.name,
      brandId: restaurants.brandId,
      city: restaurants.city,
      brand: { id: brands.id, name: brands.name, accentColor: brands.accentColor },
    })
      .from(restaurants)
      .leftJoin(brands, eq(restaurants.brandId, brands.id))
      .orderBy(asc(restaurants.name)),
  ]);
  const restaurantsWithBrand = restaurantRows.map((restaurant) => ({
    ...restaurant,
    brand: getBrandForRestaurant(restaurant),
  }));
  const scopedRestaurants = restaurantsWithBrand.filter((restaurant) => {
    if (restaurantId && restaurant.id !== restaurantId) return false;
    if (brandId && restaurant.brand?.id !== brandId) return false;
    return !city || restaurant.city?.toLocaleLowerCase("es-HN") === city.toLocaleLowerCase("es-HN");
  });
  const scopedIds = scopedRestaurants.map((restaurant) => restaurant.id);
  const scopedBySelection = Boolean(restaurantId || brandId || city);
  const conditions = (start: Date, end: Date): SQL | undefined => and(
    eq(waitlistEntries.status, "sentado"),
    gte(waitlistEntries.seatedAt, start),
    lt(waitlistEntries.seatedAt, end),
    ...(scopedBySelection ? [inArray(waitlistEntries.restaurantId, scopedIds)] : []),
  );
  const calledConditions = (start: Date, end: Date): SQL | undefined => and(
    gte(waitlistEntries.calledAt, start),
    lt(waitlistEntries.calledAt, end),
    ...(scopedBySelection ? [inArray(waitlistEntries.restaurantId, scopedIds)] : []),
  );

  const [currentRows, previousRows, calledRows] = await Promise.all([
    db.select().from(waitlistEntries)
      .where(conditions(currentStart, currentEnd))
      .orderBy(asc(waitlistEntries.seatedAt)),
    db.select().from(waitlistEntries)
      .where(conditions(previousStart, currentStart))
      .orderBy(asc(waitlistEntries.seatedAt)),
    db.select({ arrivedAt: waitlistEntries.arrivedAt, calledAt: waitlistEntries.calledAt })
      .from(waitlistEntries)
      .where(calledConditions(currentStart, currentEnd)),
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
      brand: restaurant.brand,
      city: restaurant.city,
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

  const averageCallMinutes = average(calledRows.map((entry) => waitMinutes(entry.arrivedAt, entry.calledAt!)));
  const summary = [
    currentRows.length
      ? `En los últimos 14 días (hora de Honduras) se sentaron ${currentRows.length} ${currentRows.length === 1 ? "grupo" : "grupos"}; la espera promedio fue de ${minuteCount(average(waits))}.`
      : "Todavía no hay grupos sentados en los últimos 14 días.",
    slowestDay ? `El día más lento fue ${slowestDay.day}, con ${minuteCount(slowestDay.minutes)} de espera.` : "",
    topCustomers[0] ? `El cliente con más grupos acumuló ${topCustomers[0].groups} ${topCustomers[0].groups === 1 ? "grupo" : "grupos"}.` : "",
    calledRows.length
      ? `Se avisó a ${calledRows.length} ${calledRows.length === 1 ? "grupo" : "grupos"} después de un promedio de ${minuteCount(averageCallMinutes)} desde su llegada.`
      : "Todavía no hay avisos registrados en los últimos 14 días.",
  ].filter(Boolean).join(" ");

  return {
    filters: { restaurantId, brandId, city },
    period: { startDate, endDate: today, timeZone: "America/Tegucigalpa" },
    restaurantsAvailable: restaurantsWithBrand.map(({ id, name, brand, city }) => ({ id, name, brand, city })),
    brandsAvailable: brandRows,
    citiesAvailable: [...new Set(restaurantRows.map((restaurant) => restaurant.city).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "es-HN")),
    totals: {
      groups: currentRows.length,
      todayGroups: currentRows.filter((entry) => hondurasDateKey(entry.seatedAt!) === today).length,
      averageWaitMinutes: average(waits),
      calledGroups: calledRows.length,
      averageCallMinutes,
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

function minuteCount(count: number): string {
  return `${count} ${count === 1 ? "minuto" : "minutos"}`;
}
