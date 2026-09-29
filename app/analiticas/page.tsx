"use client";

import {
  Building2,
  CalendarDays,
  ChartNoAxesCombined,
  Clock3,
  Search,
  Sparkles,
  Turtle,
  UsersRound,
  Zap,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import type { AnalyticsData, DailyStat } from "@/lib/analytics/data";

const HONDURAS_DATE = new Intl.DateTimeFormat("es-HN", {
  day: "numeric",
  month: "short",
  timeZone: "America/Tegucigalpa",
});

export default function AnaliticasPage() {
  const [analytics, setAnalytics] = useState<AnalyticsData | null>(null);
  const [loadError, setLoadError] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(true);
  const [asking, setAsking] = useState(false);
  const [restaurantId, setRestaurantId] = useState("");
  const [brandInput, setBrandInput] = useState("");
  const [brandFilter, setBrandFilter] = useState("");

  useEffect(() => {
    let active = true;
    const timer = window.setTimeout(() => {
      if (active) setLoading(true);
    }, 0);
    const query = new URLSearchParams();
    if (restaurantId) query.set("restaurantId", restaurantId);
    if (brandFilter) query.set("brand", brandFilter);
    fetch(`/api/analiticas?${query.toString()}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se pudieron cargar las estadísticas.");
        if (active) setAnalytics(data as AnalyticsData);
      })
      .catch((cause: unknown) => {
        if (active) setLoadError(cause instanceof Error ? cause.message : "Error al cargar las estadísticas.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; window.clearTimeout(timer); };
  }, [restaurantId, brandFilter]);

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!question.trim() || !analytics || asking) return;
    setAsking(true);
    setAnswer("");
    try {
      const query = new URLSearchParams();
      if (restaurantId) query.set("restaurantId", restaurantId);
      if (brandFilter) query.set("brand", brandFilter);
      const response = await fetch(`/api/assistant?${query.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No pude generar una respuesta.");
      setAnswer(data.answer || "No pude generar una respuesta.");
    } catch (cause) {
      setAnswer(cause instanceof Error ? cause.message : "No se pudo conectar con el asistente.");
    } finally {
      setAsking(false);
    }
  }

  function applyBrand(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBrandFilter(brandInput.trim());
  }

  const totals = analytics?.totals;
  const cards = analytics ? [
    {
      label: "Grupos sentados",
      value: String(analytics.totals.groups),
      detail: analytics.totals.changePercent == null
        ? "Últimos 14 días"
        : `${analytics.totals.changePercent >= 0 ? "+" : "−"}${Math.abs(analytics.totals.changePercent)}% frente a los 14 días anteriores`,
      Icon: UsersRound,
    },
    {
      label: "Espera promedio",
      value: `${analytics.totals.averageWaitMinutes} min`,
      detail: "Llegada hasta sentarse",
      Icon: Clock3,
    },
    {
      label: "Día más rápido",
      value: analytics.totals.fastestDay?.day ?? "—",
      detail: analytics.totals.fastestDay ? `${analytics.totals.fastestDay.minutes} min de espera` : "Sin datos todavía",
      Icon: Zap,
    },
    {
      label: "Día más lento",
      value: analytics.totals.slowestDay?.day ?? "—",
      detail: analytics.totals.slowestDay ? `${analytics.totals.slowestDay.minutes} min de espera` : "Sin datos todavía",
      Icon: Turtle,
    },
    {
      label: "Tiempo hasta avisar",
      value: "Pendiente",
      detail: "Se medirá cuando llegue called_at a testing",
      Icon: CalendarDays,
    },
  ] : [];

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[.18em] text-accent">Panel de rendimiento</p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-app-text">Estadísticas</h1>
          <p className="mt-1 text-app-muted">Últimos 14 días · hora de Honduras</p>
        </div>
        <div className="rounded-xl border border-app-border bg-panel px-4 py-2.5 text-sm font-medium text-panel-text">
          Actividad de hoy: {totals?.todayGroups ?? 0} grupos sentados
        </div>
      </header>

      <form onSubmit={applyBrand} className="mt-6 grid gap-3 rounded-2xl border border-app-border bg-panel p-4 text-panel-text sm:grid-cols-[1fr_1fr_auto]">
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Restaurante
          <select
            value={restaurantId}
            onChange={(event) => setRestaurantId(event.target.value)}
            className="h-11 rounded-xl border border-app-border bg-panel px-3 text-panel-text outline-none focus:border-accent"
          >
            <option value="">Todos los restaurantes</option>
            {analytics?.restaurantsAvailable.map((restaurant) => (
              <option key={restaurant.id} value={restaurant.id}>{restaurant.name}</option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm font-medium">
          Marca o nombre comercial
          <span className="flex h-11 items-center gap-2 rounded-xl border border-app-border px-3 focus-within:border-accent">
            <Search aria-hidden size={17} className="shrink-0 text-panel-muted" />
            <input
              value={brandInput}
              onChange={(event) => setBrandInput(event.target.value)}
              placeholder="Buscar por marca"
              className="min-w-0 flex-1 bg-transparent text-panel-text outline-none placeholder:text-panel-muted"
            />
          </span>
        </label>
        <button className="min-h-11 self-end rounded-xl bg-accent px-4 font-semibold text-accent-text transition hover:bg-accent/85">
          Filtrar
        </button>
      </form>

      {loadError && (
        <p role="alert" className="mt-5 rounded-xl border border-app-border bg-panel px-4 py-3 text-sm text-panel-text">
          {loadError}
        </p>
      )}
      {loading && <p role="status" className="mt-5 text-sm text-app-muted">Cargando…</p>}

      {analytics && !loading && (
        <>
          <section aria-label="Resumen del período" className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
            {cards.map(({ label, value, detail, Icon }) => (
              <article key={label} className="rounded-2xl border border-app-border bg-panel p-5 text-panel-text shadow-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-panel-muted">{label}</span>
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-accent/10 text-accent">
                    <Icon aria-hidden size={18} />
                  </span>
                </div>
                <p className="mt-4 text-2xl font-bold">{value}</p>
                <p className="mt-1 text-xs text-panel-muted">{detail}</p>
              </article>
            ))}
          </section>

          <div className="mt-5 grid gap-5 lg:grid-cols-[1.35fr_.85fr]">
            <section className="rounded-2xl border border-app-border bg-panel p-5 text-panel-text shadow-sm sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="font-bold">Volumen y tiempo de espera</h2>
                  <p className="mt-1 text-sm text-panel-muted">Grupos sentados y minutos promedio por día</p>
                </div>
                <div className="flex flex-wrap gap-3 text-xs text-panel-muted">
                  <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-accent" />Grupos</span>
                  <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-full bg-estado-ocupada" />Espera</span>
                </div>
              </div>
              <DailyChart daily={analytics.daily} />
              <p className="mt-9 rounded-xl bg-accent/10 px-4 py-3 text-sm text-panel-text">{analytics.summary}</p>
            </section>

            <section className="rounded-2xl border border-app-border bg-panel p-5 text-panel-text shadow-sm sm:p-6">
              <div className="flex items-center gap-2">
                <Building2 aria-hidden size={19} className="text-accent" />
                <h2 className="font-bold">Comparación por restaurante</h2>
              </div>
              <p className="mt-1 text-sm text-panel-muted">Grupos y espera promedio del período</p>
              {analytics.restaurants.length ? (
                <ul className="mt-5 space-y-4">
                  {analytics.restaurants.map((restaurant) => (
                    <li key={restaurant.id}>
                      <div className="flex justify-between gap-3 text-sm">
                        <span className="font-semibold">{restaurant.name}</span>
                        <span className="text-panel-muted">{restaurant.groups} grupos · {restaurant.minutes} min</span>
                      </div>
                      <div className="mt-2 h-2 rounded-full bg-app-border">
                        <div
                          className="h-2 rounded-full bg-accent"
                          style={{ width: `${Math.max(restaurant.groups ? 4 : 0, (restaurant.groups / Math.max(1, ...analytics.restaurants.map((item) => item.groups))) * 100)}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-5 text-sm text-panel-muted">No hay actividad en los filtros seleccionados.</p>}
            </section>
          </div>

          <section className="mt-5 rounded-2xl border border-app-border bg-panel p-5 text-panel-text shadow-sm sm:p-6">
            <div className="flex items-center gap-2">
              <ChartNoAxesCombined aria-hidden size={19} className="text-accent" />
              <h2 className="font-bold">Top 10 de clientes</h2>
            </div>
            <p className="mt-1 text-sm text-panel-muted">Agrupados por nombre y cantidad de grupos sentados</p>
            {analytics.topCustomers.length ? (
              <ol className="mt-4 grid gap-2 sm:grid-cols-2">
                {analytics.topCustomers.map((customer, index) => (
                  <li key={customer.name} className="flex items-center justify-between gap-3 rounded-xl border border-app-border px-3 py-2.5 text-sm">
                    <span className="min-w-0 truncate"><span className="mr-2 text-panel-muted">{index + 1}.</span>{customer.name}</span>
                    <span className="shrink-0 font-semibold">{customer.groups} grupos</span>
                  </li>
                ))}
              </ol>
            ) : <p className="mt-4 text-sm text-panel-muted">No hay clientes con grupos sentados durante estos 14 días.</p>}
          </section>

          <section className="mt-5 rounded-2xl border border-app-border bg-panel p-5 text-panel-text shadow-sm sm:p-6">
            <div className="grid gap-5 md:grid-cols-[.8fr_1.2fr] md:items-start">
              <div>
                <span className="inline-flex items-center gap-2 rounded-full bg-accent/10 px-3 py-1 text-xs font-semibold text-accent">
                  <Sparkles aria-hidden size={14} /> ASISTENTE IA
                </span>
                <h2 className="mt-3 text-xl font-bold">Pregunta sobre tu servicio</h2>
                <p className="mt-1 text-sm leading-6 text-panel-muted">Consulta el día más lento, tus clientes frecuentes o compara restaurantes con los filtros actuales.</p>
                <div className="mt-5 rounded-xl border border-app-border bg-app-bg p-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-app-muted">Resumen de 14 días</p>
                  <p className="mt-2 text-sm leading-6">{analytics.summary}</p>
                </div>
              </div>
              <div>
                <form onSubmit={ask} className="flex flex-col gap-2 sm:flex-row">
                  <input
                    value={question}
                    onChange={(event) => setQuestion(event.target.value)}
                    maxLength={500}
                    placeholder="¿Qué día tuvimos la espera más larga?"
                    className="min-h-11 min-w-0 flex-1 rounded-xl border border-app-border bg-app-bg px-4 py-3 text-sm text-app-text outline-none placeholder:text-app-muted focus:border-accent"
                  />
                  <button disabled={asking || loading} className="min-h-11 rounded-xl bg-accent px-5 py-3 text-sm font-bold text-accent-text transition hover:bg-accent/85 disabled:opacity-60">
                    {asking ? "Consultando…" : "Preguntar"}
                  </button>
                </form>
                <div className="mt-4 flex flex-wrap gap-2">
                  {["¿Cuál fue el día más lento?", "Dame el top de clientes", "Compara restaurantes"].map((suggestion) => (
                    <button
                      key={suggestion}
                      type="button"
                      onClick={() => setQuestion(suggestion)}
                      className="min-h-10 rounded-full border border-app-border px-3 py-1.5 text-xs text-panel-muted transition hover:bg-app-border/40 hover:text-panel-text"
                    >
                      {suggestion}
                    </button>
                  ))}
                </div>
                {answer && (
                  <div aria-live="polite" className="mt-5 rounded-xl border border-app-border bg-app-bg p-4">
                    <p className="text-xs font-semibold text-accent">RESPUESTA</p>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6">{answer}</p>
                  </div>
                )}
              </div>
            </div>
          </section>
          <p className="mt-4 text-center text-xs text-app-muted">Las métricas cubren del {formatDate(analytics.period.startDate)} al {formatDate(analytics.period.endDate)} · {analytics.period.timeZone}.</p>
        </>
      )}
    </div>
  );
}

function DailyChart({ daily }: { daily: DailyStat[] }) {
  const maxGroups = Math.max(1, ...daily.map((day) => day.groups));
  const maxMinutes = Math.max(1, ...daily.map((day) => day.minutes));
  return (
    <div className="mt-6 overflow-x-auto pb-7">
      <div className="flex h-52 min-w-[680px] items-end justify-between gap-2 border-b border-l border-app-border px-3">
        {daily.map((day) => (
          <div key={day.date} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2">
            <div className="flex h-[85%] items-end gap-1">
              <div title={`${day.groups} grupos`} className="w-4 rounded-t-md bg-accent sm:w-6" style={{ height: `${Math.max(day.groups ? 5 : 0, day.groups / maxGroups * 100)}%` }} />
              <div title={`${day.minutes} minutos`} className="w-4 rounded-t-md bg-estado-ocupada sm:w-6" style={{ height: `${Math.max(day.minutes ? 5 : 0, day.minutes / maxMinutes * 100)}%` }} />
            </div>
            <span className="-mb-6 text-xs text-app-muted">{day.day}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function formatDate(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return HONDURAS_DATE.format(new Date(Date.UTC(year, month - 1, day, 12)));
}
