// Rangos, filtros y tamaño de página de «Ver clientes». Sin base de datos: lo
// importan la consulta del servidor (`cards.ts`), la API y la pantalla.

export const CARD_RANGES = ["hoy", "7dias", "30dias", "todos"] as const;
export type CardRange = (typeof CARD_RANGES)[number];

export const CARD_RANGE_LABELS: Record<CardRange, string> = {
  hoy: "Hoy",
  "7dias": "Últimos 7 días",
  "30dias": "Últimos 30 días",
  todos: "Todos",
};

/** Filtros de la lista: por estado, o los que ocupan una mesa ahora mismo. */
export const CARD_FILTERS = ["todas", "esperando", "listo", "ausente", "ocupando"] as const;
export type CardFilter = (typeof CARD_FILTERS)[number];

export const CARD_FILTER_LABELS: Record<CardFilter, string> = {
  todas: "Todos los estados",
  esperando: "En espera",
  listo: "Listo",
  ausente: "Ausente",
  ocupando: "Ocupando mesa",
};

/** Clientes por página: los primeros 50 y luego «Ver más». */
export const CARD_PAGE_SIZE = 50;
export const CARD_PAGE_MAX = 100;

export type CardCounts = Record<CardFilter, number>;

/** «Cursor» de la página siguiente: la hora de llegada y el id del último. */
export function encodeCardCursor(entry: { arrivedAt: number; id: string }): string {
  return `${entry.arrivedAt}_${entry.id}`;
}

export function decodeCardCursor(raw: string | null | undefined): { arrivedAt: number; id: string } | null {
  if (!raw) return null;
  const cut = raw.indexOf("_");
  const arrivedAt = Number(raw.slice(0, cut));
  const id = raw.slice(cut + 1);
  return cut > 0 && Number.isFinite(arrivedAt) && id ? { arrivedAt, id } : null;
}

/** Sin mayúsculas ni tildes: «jose» encuentra a «José». */
export function normalizeName(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/**
 * «Ver clientes»: lo más reciente arriba. El servidor devuelve la página en
 * este mismo orden (`arrivedAt` descendente y luego `id` descendente); la tablet
 * lo conserva así después de aplicar los cambios pendientes de la cola sin
 * conexión (issue #87). El montón del modo sencillo NO usa esto: sigue por orden
 * de llegada (ascendente).
 */
export function newestFirst(a: { arrivedAt: number; id: string }, b: { arrivedAt: number; id: string }): number {
  if (b.arrivedAt !== a.arrivedAt) return b.arrivedAt - a.arrivedAt;
  return b.id.localeCompare(a.id);
}
