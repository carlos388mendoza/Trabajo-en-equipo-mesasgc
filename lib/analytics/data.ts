import { and, asc, count, eq, gte, inArray, isNotNull, isNull, lt, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import { getBrandForRestaurant, type AnalyticsBrand } from "@/lib/analytics/brand";
import { brands, restaurants, waitlistEntries } from "@/lib/db/schema";
import {
  addCalendarDays,
  hondurasMidnightUtc,
  hondurasToday,
  hondurasWeekday,
} from "@/lib/time/honduras";

const DAYS = 14;

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

/**
 * Clientes atendidos por cada mesero (zonas de meseros): los grupos sentados
 * en el período cuyo `waiter_name` es ese, por restaurante. El mismo nombre
 * en dos restaurantes son dos meseros distintos.
 */
export type WaiterStat = {
  name: string;
  restaurantId: string;
  restaurantName: string;
  groups: number;
  /** Personas (suma de `party_size`). */
  people: number;
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
  waiters: WaiterStat[];
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

  // Todo se AGREGA en la base: llegan unas decenas de filas (por restaurante y
  // día, por cliente, por mesero) en vez de cada grupo sentado de 14 y 28 días,
  // que con datos reales son decenas de miles. La espera es la misma cuenta que
  // antes, minuto a minuto sin redondear y nunca negativa; el día, el de
  // Honduras (UTC−6 todo el año: no tiene horario de verano).
  const wait = sql<number>`max(0, (${waitlistEntries.seatedAt} - ${waitlistEntries.arrivedAt}) / 60000.0)`;
  const dayKey = sql<string>`date((${waitlistEntries.seatedAt} - 21600000) / 1000, 'unixepoch')`;
  const [byDayRows, previousCount, calledRow, customerRows, waiterRows] = await Promise.all([
    db.select({ restaurantId: waitlistEntries.restaurantId, day: dayKey, groups: count(), totalWait: sql<number>`sum(${wait})` })
      .from(waitlistEntries)
      .where(conditions(currentStart, currentEnd))
      .groupBy(waitlistEntries.restaurantId, dayKey),
    db.select({ n: count() }).from(waitlistEntries).where(conditions(previousStart, currentStart)),
    db.select({ n: count(), totalWait: sql<number>`coalesce(sum(max(0, (${waitlistEntries.calledAt} - ${waitlistEntries.arrivedAt}) / 60000.0)), 0)` })
      .from(waitlistEntries)
      .where(calledConditions(currentStart, currentEnd)),
    // Un cliente anonimizado por la retención (`anonymizedAt`) ya no es
    // nadie: no cuenta para el top (todos se llamarían «Cliente anónimo»).
    db.select({ name: waitlistEntries.customerName, groups: count(), totalWait: sql<number>`sum(${wait})` })
      .from(waitlistEntries)
      .where(and(conditions(currentStart, currentEnd), isNull(waitlistEntries.anonymizedAt)))
      .groupBy(waitlistEntries.customerName),
    db.select({ restaurantId: waitlistEntries.restaurantId, name: waitlistEntries.waiterName, groups: count(), people: sql<number>`sum(${waitlistEntries.partySize})`, totalWait: sql<number>`sum(${wait})` })
      .from(waitlistEntries)
      .where(and(conditions(currentStart, currentEnd), isNotNull(waitlistEntries.waiterName)))
      .groupBy(waitlistEntries.restaurantId, waitlistEntries.waiterName),
  ]);
  const avg = (total: number, n: number) => (n ? Math.round(Number(total) / n) : 0);

  const daily: DailyStat[] = Array.from({ length: DAYS }, (_, index) => {
    const date = addCalendarDays(startDate, index);
    const rows = byDayRows.filter((row) => row.day === date);
    const groups = rows.reduce((sum, row) => sum + Number(row.groups), 0);
    const totalWait = rows.reduce((sum, row) => sum + Number(row.totalWait), 0);
    return { day: hondurasWeekday(date), date, groups, minutes: avg(totalWait, groups) };
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
  const totalGroups = byDayRows.reduce((sum, row) => sum + Number(row.groups), 0);
  const totalWaitAll = byDayRows.reduce((sum, row) => sum + Number(row.totalWait), 0);
  const previousGroups = Number(previousCount[0]?.n ?? 0);
  const changePercent = previousGroups
    ? Math.round(((totalGroups - previousGroups) / previousGroups) * 100)
    : null;

  const restaurantsStats: RestaurantStat[] = scopedRestaurants.map((restaurant) => {
    const rows = byDayRows.filter((row) => row.restaurantId === restaurant.id);
    const groups = rows.reduce((sum, row) => sum + Number(row.groups), 0);
    return {
      id: restaurant.id,
      name: restaurant.name,
      brand: restaurant.brand,
      city: restaurant.city,
      groups,
      minutes: avg(rows.reduce((sum, row) => sum + Number(row.totalWait), 0), groups),
    };
  });

  const topCustomers = customerRows
    .map((row) => ({ name: row.name, groups: Number(row.groups), minutes: avg(row.totalWait, Number(row.groups)) }))
    .sort((a, b) => b.groups - a.groups || a.name.localeCompare(b.name, "es-HN"))
    .slice(0, 10);

  const restaurantNames = new Map(restaurantsWithBrand.map((r) => [r.id, r.name]));
  const waiters: WaiterStat[] = waiterRows
    .map((row) => ({
      name: row.name!,
      restaurantId: row.restaurantId,
      restaurantName: restaurantNames.get(row.restaurantId) ?? row.restaurantId,
      groups: Number(row.groups),
      people: Number(row.people),
      minutes: avg(row.totalWait, Number(row.groups)),
    }))
    .sort((a, b) => b.groups - a.groups || a.restaurantName.localeCompare(b.restaurantName, "es-HN") || a.name.localeCompare(b.name, "es-HN"));

  const calledGroups = Number(calledRow[0]?.n ?? 0);
  const averageCallMinutes = avg(calledRow[0]?.totalWait ?? 0, calledGroups);
  const summary = [
    totalGroups
      ? `En los últimos 14 días (hora de Honduras) se sentaron ${totalGroups} ${totalGroups === 1 ? "grupo" : "grupos"}; la espera promedio fue de ${minuteCount(avg(totalWaitAll, totalGroups))}.`
      : "Todavía no hay grupos sentados en los últimos 14 días.",
    slowestDay ? `El día más lento fue ${slowestDay.day}, con ${minuteCount(slowestDay.minutes)} de espera.` : "",
    topCustomers[0] ? `El cliente con más grupos acumuló ${topCustomers[0].groups} ${topCustomers[0].groups === 1 ? "grupo" : "grupos"}.` : "",
    waiters[0]
      ? `El mesero que más grupos atendió fue ${waiters[0].name} (${waiters[0].restaurantName}), con ${waiters[0].groups} ${waiters[0].groups === 1 ? "grupo" : "grupos"}.`
      : "",
    calledGroups
      ? `Se avisó a ${calledGroups} ${calledGroups === 1 ? "grupo" : "grupos"} después de un promedio de ${minuteCount(averageCallMinutes)} desde su llegada.`
      : "Todavía no hay avisos registrados en los últimos 14 días.",
  ].filter(Boolean).join(" ");

  return {
    filters: { restaurantId, brandId, city },
    period: { startDate, endDate: today, timeZone: "America/Tegucigalpa" },
    restaurantsAvailable: restaurantsWithBrand.map(({ id, name, brand, city }) => ({ id, name, brand, city })),
    brandsAvailable: brandRows,
    citiesAvailable: [...new Set(restaurantRows.map((restaurant) => restaurant.city).filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b, "es-HN")),
    totals: {
      groups: totalGroups,
      todayGroups: daily.find((day) => day.date === today)?.groups ?? 0,
      averageWaitMinutes: avg(totalWaitAll, totalGroups),
      calledGroups,
      averageCallMinutes,
      changePercent,
      fastestDay,
      slowestDay,
    },
    daily,
    restaurants: restaurantsStats,
    topCustomers,
    waiters,
    summary,
  };
}

function minuteCount(count: number): string {
  return `${count} ${count === 1 ? "minuto" : "minutos"}`;
}
