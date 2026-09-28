// TODO(auth): validar sesión Better Auth y filtrar estadísticas por permisos del usuario.
import { asc } from "drizzle-orm";
import { NextResponse } from "next/server";

import { db } from "@/lib/db";
import { restaurants, waitlistEntries } from "@/lib/db/schema";

export const dynamic = "force-dynamic";

const DAY_MS = 24 * 60 * 60 * 1000;
const dateKey = (date: Date) => date.toISOString().slice(0, 10);

export async function GET() {
  try {
    const [entries, restaurantRows] = await Promise.all([
      db.select().from(waitlistEntries).orderBy(asc(waitlistEntries.arrivedAt)),
      db.select({ id: restaurants.id, name: restaurants.name }).from(restaurants),
    ]);
    const now = new Date();
    const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const start = today.getTime() - 6 * DAY_MS;
    const previousStart = start - 7 * DAY_MS;
    const served = entries.filter((entry) => entry.status === "sentado" && entry.seatedAt);
    const currentServed = served.filter((entry) => entry.seatedAt!.getTime() >= start);
    const previousServed = served.filter((entry) => {
      const time = entry.seatedAt!.getTime();
      return time >= previousStart && time < start;
    });
    const daily = Array.from({ length: 7 }, (_, index) => {
      const day = new Date(start + index * DAY_MS);
      const dayEntries = currentServed.filter((entry) => dateKey(entry.seatedAt!) === dateKey(day));
      const waits = dayEntries.map((entry) => Math.max(0, (entry.seatedAt!.getTime() - entry.arrivedAt.getTime()) / 60000));
      return {
        day: new Intl.DateTimeFormat("es", { weekday: "short", timeZone: "UTC" }).format(day),
        date: dateKey(day),
        groups: dayEntries.length,
        minutes: waits.length ? Math.round(waits.reduce((sum, value) => sum + value, 0) / waits.length) : 0,
      };
    });
    const waits = currentServed.map((entry) => Math.max(0, (entry.seatedAt!.getTime() - entry.arrivedAt.getTime()) / 60000));
    const fastestDay = daily.filter((day) => day.groups > 0).sort((a, b) => a.minutes - b.minutes)[0] ?? null;
    const changePercent = previousServed.length
      ? Math.round(((currentServed.length - previousServed.length) / previousServed.length) * 100)
      : null;
    const restaurantStats = restaurantRows.map((restaurant) => {
      const items = currentServed.filter((entry) => entry.restaurantId === restaurant.id);
      const restaurantWaits = items.map((entry) => Math.max(0, (entry.seatedAt!.getTime() - entry.arrivedAt.getTime()) / 60000));
      return {
        name: restaurant.name,
        groups: items.length,
        minutes: restaurantWaits.length ? Math.round(restaurantWaits.reduce((sum, value) => sum + value, 0) / restaurantWaits.length) : 0,
      };
    }).filter((restaurant) => restaurant.groups > 0);
    const averageWaitMinutes = waits.length ? Math.round(waits.reduce((sum, value) => sum + value, 0) / waits.length) : 0;
    const summary = currentServed.length
      ? `En los últimos 7 días se sentaron ${currentServed.length} grupos. La espera promedio fue de ${averageWaitMinutes} minutos${fastestDay ? `; el día más rápido fue ${fastestDay.day} con ${fastestDay.minutes} minutos` : ""}.`
      : "Todavía no hay grupos sentados en los últimos 7 días. Cuando registres actividad, aquí aparecerá un resumen real del servicio.";

    return NextResponse.json({
      totals: { groups: currentServed.length, averageWaitMinutes, changePercent, fastestDay },
      daily,
      restaurants: restaurantStats,
      summary,
    });
  } catch (error) {
    console.error("Failed to load analytics", error);
    return NextResponse.json({ error: "No se pudieron cargar las estadísticas." }, { status: 500 });
  }
}
