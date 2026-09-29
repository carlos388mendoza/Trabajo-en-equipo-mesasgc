/**
 * Conjuntos cerrados de valores de la base de datos.
 *
 * Los valores (lo que se guarda en SQLite) se mantienen en español, tal como
 * estaban en el schema de arranque, para no romper lo que el equipo ya leyó o
 * Tiene anotado. Este archivo es la única fuente de verdad: el schema de
 * Drizzle solo usa tipos, y la UI debe comparar contra estas constantes, nunca
 * contra strings sueltos.
 *
 * Patrón: cada conjunto es un `const` + su tipo derivado. Así un string
 * cualquiera no compila donde se espera un valor del conjunto, y no hace falta
 * `enum` de TypeScript (que no compila bien con `isolatedModules`).
 */

// ---------------------------------------------------------------------------
// Roles
// ---------------------------------------------------------------------------

export const ROLES = {
  ADMIN: "admin",
  RESTAURANTE: "restaurante",
  ANALITICA: "analitica",
} as const;

export type Role = (typeof ROLES)[keyof typeof ROLES];

export const ROLE_VALUES = Object.values(ROLES) as Role[];

/**
 * Un valor de rol desconocido (BD editada a mano, dato viejo) se degrada a
 * `restaurante`, que es el rol con menos permisos. Ante la duda, cerramos
 * permisos en vez de abrirlos.
 */
export function asRole(value: unknown): Role {
  return ROLE_VALUES.includes(value as Role) ? (value as Role) : ROLES.RESTAURANTE;
}

/** Un usuario de restaurante solo puede tocar su propio restaurante. */
export function canAccessRestaurant(
  role: Role,
  userRestaurantId: string | null,
  targetRestaurantId: string,
): boolean {
  if (role === ROLES.ADMIN || role === ROLES.ANALITICA) return true;
  return userRestaurantId !== null && userRestaurantId === targetRestaurantId;
}

// ---------------------------------------------------------------------------
// Tipos de elemento del mapa
// ---------------------------------------------------------------------------

/**
 * Clave estable del catálogo `element_types`. Es la que se usa en el seed y en
 * la lógica; la etiqueta visible ("Mesas con sillas") y el color salen de la
 * fila de la tabla, para poder editarlos sin tocar código.
 */
export const ELEMENT_TYPE_KEYS = [
  "mesa-sillas",
  "mesa-butacas",
  "area-juegos",
  "bano",
  "caja",
  // Estructura del local: se dibujan, pero no se sienta a nadie en ellas.
  "barra",
  "puerta",
  "pared",
] as const;

export type ElementTypeKey = (typeof ELEMENT_TYPE_KEYS)[number];

export const ELEMENT_TYPE_VALUES = [...ELEMENT_TYPE_KEYS] as ElementTypeKey[];

export function asElementTypeKey(value: unknown): ElementTypeKey | null {
  return ELEMENT_TYPE_VALUES.includes(value as ElementTypeKey)
    ? (value as ElementTypeKey)
    : null;
}

/** Solo estos tipos son mesas y por lo tanto pueden recibir clientes. */
export const SEATABLE_ELEMENT_KEYS: readonly ElementTypeKey[] = [
  "mesa-sillas",
  "mesa-butacas",
];

export function isSeatableElement(key: string): boolean {
  return (SEATABLE_ELEMENT_KEYS as readonly string[]).includes(key);
}

// ---------------------------------------------------------------------------
// Giro del plano completo
// ---------------------------------------------------------------------------

/**
 * Cómo está girada una zona entera (`table_layouts.rotation`), en grados. Solo
 * cuartos de vuelta: es "girar la foto", como en una galería, no mover mesas.
 */
export const LAYOUT_ROTATIONS = [0, 90, 180, 270] as const;
export type LayoutRotation = (typeof LAYOUT_ROTATIONS)[number];

/** Cualquier otro valor (dato viejo, BD editada a mano) se lee como 0. */
export function asLayoutRotation(value: unknown): LayoutRotation {
  return LAYOUT_ROTATIONS.includes(value as LayoutRotation) ? (value as LayoutRotation) : 0;
}

// ---------------------------------------------------------------------------
// Estado de una mesa
// ---------------------------------------------------------------------------

/**
 * Estado pintado en el mapa. Se deriva de la asignación real
 * (`tables.current_entry_id`), pero se materializa en una columna porque el
 * editor lo lee en cada render y no queremos recalcularlo todo el tiempo.
 *
 * `sentado` no aplica a mesas: es el estado terminal de un cliente en la lista
 * de espera.
 */
export const TABLE_STATUSES = ["libre", "ocupada", "reservada"] as const;
export type TableStatus = (typeof TABLE_STATUSES)[number];

// ---------------------------------------------------------------------------
// Estado de un cliente en la lista de espera
// ---------------------------------------------------------------------------

export const WAITLIST_STATUSES = ["esperando", "listo", "ausente", "sentado"] as const;
export type WaitlistStatus = (typeof WAITLIST_STATUSES)[number];

/** Los que siguen en la sala: los que el host aún puede sentar. */
export const ACTIVE_WAITLIST_STATUSES: readonly WaitlistStatus[] = [
  "esperando",
  "listo",
];

/** Los que ya no se pueden sentar: la lista se los quitó de encima. */
export const CLOSED_WAITLIST_STATUSES: readonly WaitlistStatus[] = ["ausente", "sentado"];

export function isActiveWaitlistStatus(status: string): boolean {
  return (ACTIVE_WAITLIST_STATUSES as readonly string[]).includes(status);
}
