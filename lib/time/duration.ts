// Duraciones y nombres cortos para leer de un vistazo.
//
// Una mesa olvidada o un cliente de hace días puede llevar miles de minutos:
// «11136 min» no se entiende, «7 d» sí. Lo usan el plano en vivo, «Ver
// clientes» y las cartas del modo sencillo, para que digan lo mismo. Sin nada
// de Next ni de la base.

/**
 * «12 min», «1 h», «1 h 20 min» o «2 d». Por debajo de un minuto, «0 min»;
 * desde 24 horas solo días (las horas sueltas ya no importan).
 */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.floor(minutes));
  if (m < 60) return `${m} min`;
  if (m < 24 * 60) {
    const h = Math.floor(m / 60);
    const rest = m % 60;
    return rest ? `${h} h ${rest} min` : `${h} h`;
  }
  return `${Math.floor(m / (24 * 60))} d`;
}

/** Igual que `formatDuration`, desde dos marcas de tiempo en milisegundos. */
export function durationBetween(fromMs: number, toMs: number): string {
  return formatDuration((toMs - fromMs) / 60_000);
}

/**
 * El nombre del cliente en corto para dentro de una mesa: nombre y la
 * inicial del primer apellido («Ana Torres» → «Ana T.»), y como mucho
 * `max` caracteres con «…».
 */
export function shortName(name: string, max = 12): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const short = parts.length > 1 ? `${parts[0]} ${parts[1][0]}.` : parts[0];
  return short.length > max ? `${short.slice(0, max - 1)}…` : short;
}

/** La inicial de un nombre (para la marca del mesero), en mayúscula. */
export function initialOf(name: string): string {
  return (name.trim()[0] ?? "?").toLocaleUpperCase("es");
}
