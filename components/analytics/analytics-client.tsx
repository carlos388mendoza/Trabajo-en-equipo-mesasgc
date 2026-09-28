"use client";

import { useEffect, useState, type FormEvent } from "react";

type Analytics = {
  totals: {
    groups: number;
    averageWaitMinutes: number;
    changePercent: number | null;
    fastestDay: { day: string; minutes: number } | null;
  };
  daily: { day: string; date: string; groups: number; minutes: number }[];
  restaurants: { name: string; groups: number; minutes: number }[];
  summary: string;
};

// Movido desde `app/analiticas/page.tsx` sin cambiar la lógica: la page ahora
// es de servidor y comprueba el permiso antes de montar esto.
export function AnalyticsClient() {
  const [analytics, setAnalytics] = useState<Analytics | null>(null);
  const [loadError, setLoadError] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [loading, setLoading] = useState(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => {
    let active = true;
    fetch("/api/analiticas", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "No se pudieron cargar las estadísticas.");
        if (active) setAnalytics(data as Analytics);
      })
      .catch((cause: unknown) => {
        if (active) setLoadError(cause instanceof Error ? cause.message : "Error al cargar las estadísticas.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  async function ask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!question.trim() || !analytics || asking) return;
    setAsking(true);
    setAnswer("");
    try {
      const response = await fetch("/api/assistant", {
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

  const change = analytics?.totals.changePercent;
  const cards = analytics ? [
    { label: "Grupos sentados", value: String(analytics.totals.groups), detail: change == null ? "Sin semana anterior para comparar" : `${change >= 0 ? "↑" : "↓"} ${Math.abs(change)}% vs. semana anterior`, icon: "♧" },
    { label: "Espera promedio", value: `${analytics.totals.averageWaitMinutes} min`, detail: "Desde llegada hasta sentarse", icon: "◷" },
    { label: "Día más rápido", value: analytics.totals.fastestDay?.day ?? "—", detail: analytics.totals.fastestDay ? `${analytics.totals.fastestDay.minutes} min de espera` : "Sin datos todavía", icon: "↗" },
    { label: "Días con actividad", value: String(analytics.daily.filter((day) => day.groups > 0).length), detail: "De los últimos 7 días", icon: "▦" },
  ] : [];

  return <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="text-sm font-semibold uppercase tracking-[.18em] text-accent">Panel de rendimiento</p><h1 className="mt-2 text-3xl font-bold tracking-tight text-app-text">Estadísticas</h1><p className="mt-1 text-app-muted">Una vista clara de cómo va tu servicio.</p></div><span className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-700">Últimos 7 días</span></div>
    {loadError && <p role="alert" className="mt-5 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">{loadError}</p>}
    {loading && <p className="mt-5 text-sm text-slate-500">Cargando datos de Turso…</p>}
    {analytics && <>
      <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">{cards.map((card) => <article key={card.label} className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200"><div className="flex items-center justify-between"><span className="text-sm font-medium text-slate-500">{card.label}</span><span className="grid h-9 w-9 place-items-center rounded-xl bg-emerald-50 text-lg text-emerald-700">{card.icon}</span></div><p className="mt-4 text-3xl font-bold text-slate-900">{card.value}</p><p className="mt-1 text-xs font-medium text-emerald-700">{card.detail}</p></article>)}</div>
      <div className="mt-5 grid gap-5 lg:grid-cols-[1.4fr_.8fr]">
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200"><div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="font-bold text-slate-900">Volumen y tiempo de espera</h2><p className="mt-1 text-sm text-slate-500">Grupos sentados y minutos promedio por día</p></div><div className="flex gap-4 text-xs text-slate-500"><span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-emerald-600"/>Grupos</span><span><i className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full bg-amber-400"/>Espera (min)</span></div></div>
          <div className="mt-7 flex h-52 items-end justify-between gap-2 border-b border-l border-slate-100 px-3">{analytics.daily.map((day) => <div key={day.date} className="flex h-full flex-1 flex-col items-center justify-end gap-2"><div className="flex h-[85%] items-end gap-1"><div title={`${day.groups} grupos`} className="w-3 rounded-t-md bg-emerald-600 sm:w-6" style={{ height: `${Math.max(day.groups ? 5 : 0, day.groups / Math.max(1, ...analytics.daily.map((item) => item.groups)) * 100)}%` }}/><div title={`${day.minutes} minutos`} className="w-3 rounded-t-md bg-amber-400 sm:w-6" style={{ height: `${Math.max(day.minutes ? 5 : 0, day.minutes / Math.max(1, ...analytics.daily.map((item) => item.minutes)) * 100)}%` }}/></div><span className="-mb-6 text-xs text-slate-400">{day.day}</span></div>)}</div>
          <p className="mt-9 rounded-xl bg-emerald-50 px-4 py-3 text-sm text-emerald-900">{analytics.summary}</p>
        </section>
        <section className="rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200"><h2 className="font-bold text-slate-900">Por restaurante</h2><p className="mt-1 text-sm text-slate-500">Comparativa de esta semana</p>{analytics.restaurants.length ? <div className="mt-5 space-y-5">{analytics.restaurants.map((restaurant) => <div key={restaurant.name}><div className="flex justify-between text-sm"><span className="font-semibold text-slate-800">{restaurant.name}</span><span className="text-emerald-700">{restaurant.groups} grupos</span></div><div className="mt-2 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-emerald-600" style={{ width: `${restaurant.groups / Math.max(1, ...analytics.restaurants.map((item) => item.groups)) * 100}%` }}/></div><p className="mt-1.5 text-xs text-slate-500">{restaurant.minutes} min promedio de espera</p></div>)}</div> : <p className="mt-5 text-sm text-slate-500">Todavía no hay grupos sentados esta semana.</p>}</section>
      </div>
      <section className="mt-5 overflow-hidden rounded-2xl bg-slate-900 text-white shadow-sm"><div className="grid gap-5 p-6 md:grid-cols-[.8fr_1.2fr] md:p-7"><div><span className="inline-flex rounded-full bg-emerald-400/15 px-3 py-1 text-xs font-semibold text-emerald-300">✦ ASISTENTE IA</span><h2 className="mt-3 text-xl font-bold">Pregunta sobre tu servicio</h2><p className="mt-1 text-sm leading-6 text-slate-300">Consulta tus números en lenguaje natural y recibe respuestas basadas en estas estadísticas.</p><div className="mt-5 rounded-xl bg-white/5 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Resumen de la semana</p><p className="mt-2 text-sm leading-6 text-slate-200">{analytics.summary}</p></div></div>
        <div><form onSubmit={ask} className="flex flex-col gap-2 sm:flex-row"><input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="¿Qué día tuvimos menos espera?" className="min-w-0 flex-1 rounded-xl border border-white/10 bg-white/10 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-400 focus:border-emerald-400"/><button disabled={asking || !analytics} className="rounded-xl bg-emerald-400 px-5 py-3 text-sm font-bold text-emerald-950 transition hover:bg-emerald-300 disabled:opacity-60">{asking ? "Consultando…" : "Preguntar"}</button></form><div className="mt-4 flex flex-wrap gap-2">{["Compara viernes y sábado", "¿Cuál fue el día más rápido?"].map((suggestion) => <button key={suggestion} type="button" onClick={() => setQuestion(suggestion)} className="rounded-full border border-white/15 px-3 py-1.5 text-xs text-slate-300 hover:bg-white/10">{suggestion}</button>)}</div>{answer && <div aria-live="polite" className="mt-5 rounded-xl border border-white/10 bg-white/10 p-4"><p className="text-xs font-semibold text-emerald-300">RESPUESTA</p><p className="mt-2 text-sm leading-6 text-slate-100">{answer}</p></div>}</div>
      </div></section>
      <p className="mt-4 text-center text-xs text-app-muted">Datos calculados desde la lista de espera de Turso.</p>
    </>}
  </main>;
}
