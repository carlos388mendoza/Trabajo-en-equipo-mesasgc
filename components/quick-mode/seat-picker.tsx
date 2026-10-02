"use client";

// «Sentar» desde el modo sencillo: elegir una mesa para un cliente.
//
// Las mesas son las que la tablet conoce (con red, las del servidor; sin red,
// las últimas que vio más los cambios en cola). Elegir una NO la ocupa en
// pantalla de inmediato: la ocupa el servidor con su UPDATE condicional
// (`assignTable`), y si otro dispositivo se adelantó, el ack trae «Esta mesa
// ya fue asignada». Sin conexión, la elección queda en la cola y se resuelve
// al sincronizar, con el mismo rechazo si hace falta.

import { Armchair, UsersRound } from "lucide-react";

import { people } from "@/components/quick-mode/format";
import { Overlay } from "@/components/quick-mode/overlay";
import type { SeatableTable } from "@/lib/tables/list";
import type { WaitlistEntrySnapshot } from "@/lib/waitlist/quick-actions";

type SeatPickerProps = {
  entry: WaitlistEntrySnapshot | null;
  tables: SeatableTable[];
  /** Mesas aún sin cargar (primera vez, sin conexión): se dice. */
  loaded: boolean;
  busy: boolean;
  onPick: (tableId: string) => void;
  onClose: () => void;
};

export function SeatPicker({ entry, tables, loaded, busy, onPick, onClose }: SeatPickerProps) {
  const zones = new Map<string, SeatableTable[]>();
  for (const table of tables) zones.set(table.layoutName, [...(zones.get(table.layoutName) ?? []), table]);
  const free = tables.filter((table) => table.currentEntryId === null).length;

  return (
    <Overlay open={entry !== null} onClose={onClose} labelledBy="sentar-titulo" size="list">
      <div className="overflow-y-auto p-5 sm:p-6">
        <h2 id="sentar-titulo" className="text-xl font-bold text-panel-text">Sentar a {entry?.customerName}</h2>
        {entry && (
          <p className="mt-1 flex items-center gap-1.5 text-sm text-panel-muted">
            <UsersRound aria-hidden size={15} />
            {people(entry.partySize)} · {free} {free === 1 ? "mesa libre" : "mesas libres"}
          </p>
        )}
        {!loaded ? (
          <p className="py-10 text-center text-panel-muted">Todavía no se cargaron las mesas de este restaurante.</p>
        ) : tables.length === 0 ? (
          <p className="py-10 text-center text-panel-muted">Este restaurante no tiene mesas en su plano.</p>
        ) : (
          [...zones.entries()].map(([zone, list]) => (
            <section key={zone} className="mt-5">
              <h3 className="text-sm font-semibold text-panel-muted">{zone}</h3>
              <ul className="mt-2 grid grid-cols-[repeat(auto-fill,minmax(7.5rem,1fr))] gap-2">
                {list.map((table) => {
                  const occupied = table.currentEntryId !== null;
                  const small = entry !== null && table.capacity !== null && table.capacity < entry.partySize;
                  return (
                    <li key={table.id}>
                      <button
                        type="button"
                        disabled={occupied || busy}
                        onClick={() => onPick(table.id)}
                        className={`flex min-h-16 w-full flex-col items-start justify-center rounded-xl border px-3 py-2 text-left transition disabled:cursor-not-allowed ${
                          occupied
                            ? "border-app-border bg-app-bg text-panel-muted opacity-60"
                            : "border-estado-libre/50 text-panel-text hover:bg-estado-libre/10"
                        }`}
                      >
                        <span className="inline-flex items-center gap-1.5 font-semibold">
                          <Armchair aria-hidden size={16} />
                          {table.label}
                        </span>
                        <span className="text-xs text-panel-muted">
                          {occupied ? "Ocupada" : table.capacity ? `${table.capacity} lugares${small ? " · pequeña" : ""}` : "Libre"}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))
        )}
        <div className="mt-6 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-12 items-center justify-center rounded-xl border border-app-border px-5 font-semibold text-panel-text transition hover:bg-app-border/50"
          >
            Cancelar
          </button>
        </div>
      </div>
    </Overlay>
  );
}
