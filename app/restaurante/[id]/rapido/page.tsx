"use client";

import { use, useEffect, useMemo, useRef, useState, type FormEvent } from "react";

type Guest = {
  id: string;
  name: string;
  party: number;
  arrived: number;
  note: string;
  status: "waiting" | "seated" | "absent";
};

type ApiEntry = {
  id: string;
  customerName: string;
  partySize: number;
  arrivedAt: number;
  notes: string | null;
  status: string;
};

export default function ModoRapidoPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: restaurantId } = use(params);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [name, setName] = useState("");
  const [party, setParty] = useState("2");
  const [note, setNote] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const touchStart = useRef<number | null>(null);
  const waiting = useMemo(
    () => guests.filter((guest) => guest.status === "waiting"),
    [guests],
  );
  const current = waiting[0];

  async function loadGuests() {
    try {
      const response = await fetch(`/api/restaurante/${restaurantId}/clientes`, {
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo leer la lista.");
      setGuests(
        (data.entries as ApiEntry[]).map((entry) => ({
          id: entry.id,
          name: entry.customerName,
          party: entry.partySize,
          arrived: entry.arrivedAt,
          note: entry.notes ?? "",
          status:
            entry.status === "esperando" || entry.status === "listo"
              ? "waiting"
              : entry.status === "sentado"
                ? "seated"
                : "absent",
        })),
      );
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error al conectar con Turso.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void loadGuests(), 0);
    // The restaurant id scopes this list; reload when navigation changes it.
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [restaurantId]);

  async function addGuest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/restaurante/${restaurantId}/clientes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerName: name.trim(),
          partySize: Number(party),
          notes: note.trim(),
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo guardar el cliente.");
      const entry = data.entry as ApiEntry;
      setGuests((items) => [
        ...items,
        {
          id: entry.id,
          name: entry.customerName,
          party: entry.partySize,
          arrived: entry.arrivedAt,
          note: entry.notes ?? "",
          status: "waiting",
        },
      ]);
      setName("");
      setParty("2");
      setNote("");
      setMessage("Cliente agregado a la fila");
      window.setTimeout(() => setMessage(""), 2500);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Error al guardar en Turso.");
    } finally {
      setSaving(false);
    }
  }

  async function mark(status: "seated" | "absent") {
    if (!current) return;
    const previous = guests;
    setError("");
    setGuests((items) =>
      items.map((guest) =>
        guest.id === current.id ? { ...guest, status } : guest,
      ),
    );
    try {
      const response = await fetch(
        `/api/restaurante/${restaurantId}/clientes/${current.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ status: status === "seated" ? "sentado" : "ausente" }),
        },
      );
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "No se pudo actualizar el cliente.");
    } catch (cause) {
      setGuests(previous);
      setError(cause instanceof Error ? cause.message : "Error al actualizar Turso.");
    }
  }

  return (
    <main className="mx-auto max-w-6xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[.18em] text-emerald-700">
            Servicio en vivo · Local {restaurantId}
          </p>
          <h1 className="mt-2 text-3xl font-bold tracking-tight text-slate-900">
            Modo sencillo
          </h1>
          <p className="mt-1 text-slate-500">Gestiona la fila en unos pocos toques.</p>
        </div>
        <div className="rounded-2xl bg-white px-5 py-3 shadow-sm ring-1 ring-slate-200">
          <span className="text-2xl font-bold text-slate-900">{waiting.length}</span>
          <span className="ml-2 text-sm text-slate-500">grupos esperando</span>
        </div>
      </div>

      {error && (
        <p role="alert" className="mt-4 rounded-xl bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </p>
      )}

      <div className="mt-8 grid gap-6 lg:grid-cols-[1.15fr_.85fr]">
        <section className="rounded-3xl bg-slate-900 p-6 text-white shadow-xl sm:p-8">
          <div className="flex items-center justify-between">
            <span className="rounded-full bg-white/10 px-3 py-1.5 text-xs font-semibold tracking-wide">
              SIGUIENTE EN LA FILA
            </span>
            <span className="text-sm text-slate-300">
              {current ? `#${guests.filter((guest) => guest.status !== "waiting").length + 1}` : "—"}
            </span>
          </div>
          {loading ? (
            <div className="py-14 text-center text-slate-300">Cargando lista…</div>
          ) : current ? (
            <article
              onTouchStart={(event) => {
                touchStart.current = event.touches[0]?.clientX ?? null;
              }}
              onTouchEnd={(event) => {
                if (touchStart.current === null) return;
                const delta = event.changedTouches[0].clientX - touchStart.current;
                if (delta > 65) void mark("seated");
                else if (delta < -65) void mark("absent");
                touchStart.current = null;
              }}
              className="mt-8 touch-pan-y"
            >
              <h2 className="text-3xl font-bold">{current.name}</h2>
              <p className="mt-2 text-slate-300">
                {current.party} personas <span className="mx-2">·</span> Llegó a las{" "}
                {new Date(current.arrived).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" })}
              </p>
              {current.note && (
                <p className="mt-4 inline-flex rounded-xl bg-white/10 px-3 py-2 text-sm">
                  {current.note}
                </p>
              )}
              <div className="mt-10 grid grid-cols-2 gap-3">
                <button
                  onClick={() => void mark("seated")}
                  className="rounded-2xl bg-emerald-400 px-4 py-4 font-bold text-emerald-950 transition hover:bg-emerald-300"
                >
                  ✓ Sentar grupo
                </button>
                <button
                  onClick={() => void mark("absent")}
                  className="rounded-2xl border border-white/20 px-4 py-4 font-semibold text-white transition hover:bg-white/10"
                >
                  Marcar ausente
                </button>
              </div>
              <p className="mt-4 text-center text-xs text-slate-400">
                Desliza a la derecha para sentar · a la izquierda para marcar ausente.
              </p>
            </article>
          ) : (
            <div className="py-14 text-center">
              <p className="text-xl font-semibold">La fila está vacía</p>
              <p className="mt-2 text-sm text-slate-400">Agrega el siguiente grupo para comenzar.</p>
            </div>
          )}
          <div className="mt-5 flex gap-2 overflow-x-auto pb-1">
            {waiting.slice(1).map((guest, index) => (
              <div key={guest.id} className="min-w-44 rounded-xl bg-white/10 p-3">
                <p className="text-xs text-slate-400">Después · #{index + 2}</p>
                <p className="mt-1 font-semibold">{guest.name}</p>
                <p className="text-xs text-slate-300">{guest.party} personas</p>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-3xl bg-white p-6 shadow-sm ring-1 ring-slate-200 sm:p-8">
          <div className="flex items-center gap-3">
            <span className="grid h-10 w-10 place-items-center rounded-2xl bg-emerald-50 text-xl">＋</span>
            <div>
              <h2 className="font-bold text-slate-900">Agregar cliente</h2>
              <p className="text-sm text-slate-500">Registro rápido, sin pasos extra</p>
            </div>
          </div>
          <form className="mt-6 space-y-4" onSubmit={addGuest}>
            <label className="block text-sm font-medium text-slate-700">
              Nombre
              <input
                required
                maxLength={100}
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Ej. Ana García"
                className="mt-1.5 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none transition focus:border-emerald-500 focus:ring-2 focus:ring-emerald-100"
              />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block text-sm font-medium text-slate-700">
                Personas
                <select
                  value={party}
                  onChange={(event) => setParty(event.target.value)}
                  className="mt-1.5 w-full rounded-xl border border-slate-200 bg-white px-4 py-3 outline-none focus:border-emerald-500"
                >
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((count) => (
                    <option key={count} value={count}>{count} personas</option>
                  ))}
                </select>
              </label>
              <label className="block text-sm font-medium text-slate-700">
                Nota (opcional)
                <input
                  maxLength={500}
                  value={note}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="Silla para bebé"
                  className="mt-1.5 w-full rounded-xl border border-slate-200 px-4 py-3 outline-none focus:border-emerald-500"
                />
              </label>
            </div>
            <button
              disabled={saving}
              className="w-full rounded-xl bg-emerald-700 px-4 py-3.5 font-semibold text-white transition hover:bg-emerald-800 disabled:opacity-60"
            >
              {saving ? "Guardando…" : "Agregar a la fila"}
            </button>
            {message && <p role="status" className="text-center text-sm font-medium text-emerald-700">{message}</p>}
          </form>
          <div className="mt-7 border-t border-slate-100 pt-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-800">Actividad de hoy</h3>
              <button onClick={() => void loadGuests()} className="text-xs font-medium text-emerald-700 hover:underline">
                Actualizar
              </button>
            </div>
            <div className="mt-3 flex gap-3 text-sm text-slate-500">
              <span className="text-emerald-600">●</span>
              <p>
                {guests.filter((guest) => guest.status === "seated").length} grupos sentados
                <span className="mx-1">·</span>
                {guests.filter((guest) => guest.status === "absent").length} ausentes
              </p>
            </div>
          </div>
        </section>
      </div>
      <p className="mt-5 text-center text-xs text-slate-400">La lista se guarda en Turso para este restaurante.</p>
    </main>
  );
}
