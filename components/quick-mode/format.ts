// Textos y colores compartidos por las cartas del modo rápido: el montón, el
// abanico y «Ver clientes». Siempre con singular y plural.

import { HONDURAS_TIME_ZONE, hondurasDateKey } from "@/lib/time/honduras";

export function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export function people(count: number): string {
  return plural(count, "persona", "personas");
}

export function minutes(count: number): string {
  return plural(count, "minuto", "minutos");
}

/** Minutos enteros entre dos instantes, nunca negativos. */
export function minutesBetween(from: number, to: number): number {
  return Math.max(0, Math.floor((to - from) / 60_000));
}

/** Verde hasta 10 min, ámbar hasta 20 y rojo después: los colores de estado del tema. */
export function waitColor(waitingMinutes: number): string {
  return waitingMinutes < 10
    ? "text-estado-libre"
    : waitingMinutes <= 20
      ? "text-estado-reservada"
      : "text-estado-ocupada";
}

const timeFormatter = new Intl.DateTimeFormat("es-HN", {
  timeZone: HONDURAS_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

const dayFormatter = new Intl.DateTimeFormat("es-HN", {
  timeZone: HONDURAS_TIME_ZONE,
  weekday: "short",
  day: "numeric",
});

/** «14:32» si es de hoy; «lun 28, 14:32» si es de otro día (hora de Honduras). */
export function arrivalLabel(at: number, now: number): string {
  const time = timeFormatter.format(at);
  return hondurasDateKey(at) === hondurasDateKey(now) ? time : `${dayFormatter.format(at)}, ${time}`;
}
