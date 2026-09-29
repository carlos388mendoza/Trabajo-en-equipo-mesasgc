export const HONDURAS_TIME_ZONE = "America/Tegucigalpa";

const dateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: HONDURAS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export function hondurasDateKey(value: Date | number): string {
  return dateFormatter.format(value instanceof Date ? value : new Date(value)).replaceAll("/", "-");
}

export function addCalendarDays(dateKey: string, amount: number): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + amount));
  return shifted.toISOString().slice(0, 10);
}

/** Devuelve el instante UTC que corresponde a la medianoche hondureña local. */
export function hondurasMidnightUtc(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number);
  const targetAsUtc = Date.UTC(year, month - 1, day);
  let guess = targetAsUtc;
  const localParts = new Intl.DateTimeFormat("en-US", {
    timeZone: HONDURAS_TIME_ZONE,
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });

  // Itera para resolver el offset real de la zona en esa fecha (sin asumir
  // que Tegucigalpa siempre tendrá el mismo offset si cambian sus reglas).
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = Object.fromEntries(
      localParts.formatToParts(new Date(guess)).map((part) => [part.type, part.value]),
    );
    const representedAsUtc = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    const correction = targetAsUtc - representedAsUtc;
    guess += correction;
    if (correction === 0) break;
  }
  return new Date(guess);
}

export function hondurasToday(now = new Date()): string {
  return hondurasDateKey(now);
}

export function hondurasWeekday(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Intl.DateTimeFormat("es-HN", {
    timeZone: HONDURAS_TIME_ZONE,
    weekday: "short",
  }).format(new Date(Date.UTC(year, month - 1, day, 12)));
}
