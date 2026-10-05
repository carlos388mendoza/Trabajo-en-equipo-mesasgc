// Permiso `asistente:usar`: solo admin y analítica pueden consultar estas estadísticas.
import { NextResponse } from "next/server";

import { getAnalytics, type AnalyticsData } from "@/lib/analytics/data";
import { buildOpenRouterMessages, getAssistantSensitiveValues, restoreCustomerAliases } from "@/lib/analytics/assistant-privacy";
import { guardApi } from "@/lib/auth/session";

export const runtime = "nodejs";

const MAX_REQUEST_BYTES = 20 * 1024;
const MAX_QUESTIONS_PER_MINUTE = 10;
const RATE_WINDOW_MS = 60_000;

const questionRequestsByUser = new Map<string, { count: number; expiresAt: number }>();


export async function POST(request: Request) {
  const guard = await guardApi(request, "asistente:usar");
  if (!guard.ok) return guard.response;

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) {
    return tooLargeResponse();
  }

  let rawBody: string;
  try {
    rawBody = await request.text();
  } catch {
    return NextResponse.json({ error: "La solicitud no tiene un formato válido." }, { status: 400 });
  }
  if (new TextEncoder().encode(rawBody).byteLength > MAX_REQUEST_BYTES) {
    return tooLargeResponse();
  }

  let parsedBody: unknown;
  try {
    parsedBody = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "La solicitud no tiene un formato válido." }, { status: 400 });
  }
  if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
    return NextResponse.json({ error: "La solicitud no tiene un formato válido." }, { status: 400 });
  }

  const body = parsedBody as { question?: unknown };
  if (typeof body.question !== "string" || !body.question.trim()) {
    return NextResponse.json({ error: "Escribe una pregunta." }, { status: 400 });
  }
  if (body.question.length > 500) {
    return NextResponse.json({ error: "La pregunta no puede superar 500 caracteres." }, { status: 400 });
  }

  const url = new URL(request.url);
  const restaurantId = url.searchParams.get("restaurantId")?.trim() ?? "";
  const brandId = url.searchParams.get("brandId")?.trim() ?? "";
  const city = url.searchParams.get("city")?.trim() ?? "";
  if (restaurantId.length > 64 || brandId.length > 64 || city.length > 100) {
    return NextResponse.json({ error: "El filtro no es válido." }, { status: 400 });
  }

  if (!allowQuestion(guard.user.id)) {
    return NextResponse.json(
      { error: "Demasiadas preguntas, espera un minuto" },
      { status: 429 },
    );
  }

  try {
    const statistics = await getAnalytics({ restaurantId: restaurantId || null, brandId, city });
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ answer: localAnswer(body.question, statistics) });
    }

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.BETTER_AUTH_URL || "http://localhost:3000",
        "X-Title": "Table Waitlist",
      },
      body: JSON.stringify({
        model: process.env.OPENROUTER_MODEL || "openai/gpt-4o-mini",
        messages: buildOpenRouterMessages(body.question, statistics, await getAssistantSensitiveValues(statistics)),
        max_tokens: 250,
      }),
    });
    if (!response.ok) {
      return NextResponse.json({ error: "El asistente no está disponible ahora. Inténtalo de nuevo." }, { status: 502 });
    }
    const data = await response.json();
    const answer = data.choices?.[0]?.message?.content;
    if (typeof answer !== "string") throw new Error("Respuesta vacía del proveedor");
    return NextResponse.json({ answer: restoreCustomerAliases(answer, statistics) });
  } catch (error) {
    console.error("Failed to answer analytics question", error);
    return NextResponse.json({ error: "No se pudo consultar el asistente. Inténtalo de nuevo." }, { status: 502 });
  }
}

function tooLargeResponse() {
  return NextResponse.json(
    { error: "La solicitud supera el límite de 20 KB." },
    { status: 413 },
  );
}

function allowQuestion(userId: string, now = Date.now()) {
  for (const [key, limit] of questionRequestsByUser) {
    if (limit.expiresAt <= now) questionRequestsByUser.delete(key);
  }

  const current = questionRequestsByUser.get(userId);
  if (!current || current.expiresAt <= now) {
    questionRequestsByUser.set(userId, { count: 1, expiresAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (current.count >= MAX_QUESTIONS_PER_MINUTE) return false;

  current.count += 1;
  return true;
}

function localAnswer(question: string, statistics: AnalyticsData): string {
  const normalized = question.toLocaleLowerCase("es-HN");
  const activeDays = statistics.daily.filter((item) => item.groups > 0);
  const asksSlow = /más lento|mayor espera|espera más larga|tardó más|peor espera/.test(normalized);
  const asksFast = /más rápido|menor espera|menos espera|espera más corta|tardó menos/.test(normalized);

  if (/meser|camarer|zona de mes/.test(normalized)) {
    if (!statistics.waiters.length) {
      return "Todavía no hay grupos sentados con mesero en el período seleccionado. Se apuntan al sentar a un cliente en una mesa que tenga zona de mesero.";
    }
    const top = statistics.waiters.slice(0, 8)
      .map((waiter) => `${waiter.name} (${waiter.restaurantName}): ${groupCount(waiter.groups)}, ${waiter.people} personas`)
      .join("; ");
    return `Clientes atendidos por mesero en los últimos 14 días: ${top}.`;
  }

  if (/avis|llamar|notificar|tiempo.*listo|listo.*tiempo/.test(normalized)) {
    if (!statistics.totals.calledGroups) return "No hay clientes avisados en el período seleccionado para calcular el tiempo hasta avisar.";
    const groups = statistics.totals.calledGroups;
    return `Se avisó a ${groupCount(groups)}, con un promedio de ${minuteCount(statistics.totals.averageCallMinutes)} desde su llegada hasta marcarlo${groups === 1 ? "" : "s"} como listo${groups === 1 ? "" : "s"}.`;
  }

  if (/marca/.test(normalized) && /espera|lento|tard/.test(normalized)) {
    const brandTotals = new Map<string, { groups: number; totalMinutes: number }>();
    for (const restaurant of statistics.restaurants) {
      if (!restaurant.brand || !restaurant.groups) continue;
      const total = brandTotals.get(restaurant.brand.name) ?? { groups: 0, totalMinutes: 0 };
      total.groups += restaurant.groups;
      total.totalMinutes += restaurant.minutes * restaurant.groups;
      brandTotals.set(restaurant.brand.name, total);
    }
    const slowest = [...brandTotals.entries()]
      .map(([name, total]) => ({ name, ...total, average: total.totalMinutes / total.groups }))
      .sort((a, b) => b.average - a.average)[0];
    return slowest
      ? `${slowest.name} tiene la mayor espera promedio: ${minuteCount(Math.round(slowest.average))} en ${groupCount(slowest.groups)}.`
      : "No hay grupos sentados en el período seleccionado para comparar las marcas.";
  }

  if (/compar|compara/.test(normalized)) {
    const requestedCities = statistics.citiesAvailable.filter((city) => normalized.includes(city.toLocaleLowerCase("es-HN")));
    if (requestedCities.length >= 2) {
      const summaries = requestedCities.slice(0, 2).map((city) => {
        const entries = statistics.restaurants.filter((restaurant) => restaurant.city === city);
        const groups = entries.reduce((total, restaurant) => total + restaurant.groups, 0);
        const minutes = groups
          ? Math.round(entries.reduce((total, restaurant) => total + restaurant.minutes * restaurant.groups, 0) / groups)
          : 0;
        return `${city}: ${groupCount(groups)}, ${minutes} min de espera promedio`;
      });
      return `Comparación de los últimos 14 días: ${summaries.join("; ")}.`;
    }
  }

  if (asksSlow || asksFast) {
    if (!activeDays.length) return "No hay días con actividad en el período seleccionado.";
    if (activeDays.length === 1) {
      const onlyDay = activeDays[0];
      return `Solo hay un día con actividad: ${onlyDay.day}, con ${minuteCount(onlyDay.minutes)} de espera promedio. No hay otros días para comparar y decidir cuál fue más rápido o más lento.`;
    }
    if (asksSlow && asksFast) {
      const slow = statistics.totals.slowestDay;
      const fast = statistics.totals.fastestDay;
      return `El día más lento fue ${slow?.day} con ${minuteCount(slow?.minutes ?? 0)}; el más rápido fue ${fast?.day} con ${minuteCount(fast?.minutes ?? 0)} de espera promedio.`;
    }
    const day = asksSlow ? statistics.totals.slowestDay : statistics.totals.fastestDay;
    return day
      ? `${day.day} fue el día ${asksSlow ? "más lento" : "más rápido"}, con ${minuteCount(day.minutes)} de espera promedio.`
      : "No hay datos suficientes para comparar los días.";
  }

  if (/top|clientes?.*(más|frecuentes)|quién.*más grupos|más grupos.*cliente/.test(normalized)) {
    if (!statistics.topCustomers.length) return "No hay clientes con grupos sentados en el período seleccionado.";
    const top = statistics.topCustomers.slice(0, 5)
      .map((customer, index) => `${index + 1}. ${customer.name}: ${groupCount(customer.groups)}`)
      .join("; ");
    return `Top de clientes por grupos sentados: ${top}.`;
  }

  if (/compar|restaurantes?|locales?/.test(normalized)) {
    const activeRestaurants = statistics.restaurants.filter((item) => item.groups > 0);
    if (activeRestaurants.length < 2) {
      const hasFilters = Boolean(statistics.filters.restaurantId || statistics.filters.brandId || statistics.filters.city);
      return hasFilters
        ? "Hay pocos datos con los filtros actuales; quítalos para comparar más restaurantes."
        : "Todavía no hay suficientes datos de varios restaurantes para compararlos.";
    }
    const comparison = [...activeRestaurants]
      .sort((a, b) => a.minutes - b.minutes)
      .map((restaurant) => {
        const details = [restaurant.brand?.name, restaurant.city].filter(Boolean).join(" · ");
        return `${restaurant.name}${details ? ` (${details})` : ""}: ${groupCount(restaurant.groups)}, ${restaurant.minutes} min de espera`;
      })
      .join("; ");
    return `Comparación de los últimos 14 días: ${comparison}.`;
  }

  if (/grupos|atend|volumen|más clientes/.test(normalized)) {
    if (!activeDays.length) return "No hay datos de grupos sentados en el período seleccionado.";
    const busiest = activeDays.reduce((best, day) => day.groups > best.groups ? day : best);
    return `${busiest.day} fue el día con más grupos sentados: ${groupCount(busiest.groups)}.`;
  }

  return "Puedo resumir el tiempo hasta avisar, el día más rápido o lento, el top de clientes y comparar restaurantes. Para preguntas abiertas, configura OPENROUTER_API_KEY en .env.local.";
}

function groupCount(count: number): string {
  return `${count} ${count === 1 ? "grupo" : "grupos"}`;
}

function minuteCount(count: number): string {
  return `${count} ${count === 1 ? "minuto" : "minutos"}`;
}
