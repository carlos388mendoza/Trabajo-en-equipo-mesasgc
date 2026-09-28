// Permisos: el ÚNICO sitio que decide quién puede hacer qué.
//
// Todo pasa por `can(usuario, acción, restaurantId?)`: páginas, server
// actions, API routes y Socket.IO. Si cambia una regla, cambia aquí y en
// ningún otro sitio. La tabla legible está en `docs/rbac.md`.
//
// Funciones puras, sin base de datos ni Next: se pueden probar solas y las
// usa igual el servidor de Socket.IO.
//
// Un usuario puede tener varios roles: sus permisos SE SUMAN. Por ejemplo,
// "restaurante + analitica" edita solo sus restaurantes y ve las
// estadísticas de todos.

import { ROLES, type Role } from "@/lib/db/enums";

import type { AuthUser } from "./users";

export type Action =
  /** Crear, editar y desactivar usuarios (/admin). */
  | "usuarios:gestionar"
  /** Ver el editor de mesas (modo completo). */
  | "editor:ver"
  /** Guardar o copiar la estructura del local. */
  | "editor:guardar"
  /** Ver el modo rápido (modo sencillo). */
  | "rapido:ver"
  /** Añadir clientes y marcarlos listos o ausentes. */
  | "rapido:modificar"
  /** Sentar o liberar mesas (Socket.IO). */
  | "mesas:asignar"
  /** Estadísticas, vista global y por restaurante. */
  | "analiticas:ver"
  /** Asistente IA sobre las estadísticas. */
  | "asistente:usar";

export const ALL_ACTIONS: readonly Action[] = [
  "usuarios:gestionar",
  "editor:ver",
  "editor:guardar",
  "rapido:ver",
  "rapido:modificar",
  "mesas:asignar",
  "analiticas:ver",
  "asistente:usar",
];

/**
 * Acciones que son "de un restaurante": piden `restaurantId`, y el rol
 * restaurante solo las tiene en los suyos. El resto son globales.
 */
const RESTAURANT_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  "editor:ver",
  "editor:guardar",
  "rapido:ver",
  "rapido:modificar",
  "mesas:asignar",
]);

export function isRestaurantAction(action: Action): boolean {
  return RESTAURANT_ACTIONS.has(action);
}

/** Qué acciones da cada rol. */
export const ROLE_PERMISSIONS: Record<Role, readonly Action[]> = {
  // Todo, en todos los restaurantes.
  [ROLES.ADMIN]: ALL_ACTIONS,
  // Modo sencillo y completo, solo en SUS restaurantes.
  [ROLES.RESTAURANTE]: [
    "editor:ver",
    "editor:guardar",
    "rapido:ver",
    "rapido:modificar",
    "mesas:asignar",
  ],
  // Solo lectura: estadísticas de todos y el asistente. No edita nada.
  [ROLES.ANALITICA]: ["analiticas:ver", "asistente:usar"],
};

export const ROLE_LABELS: Record<Role, string> = {
  [ROLES.ADMIN]: "Administrador",
  [ROLES.RESTAURANTE]: "Restaurante",
  [ROLES.ANALITICA]: "Analítica",
};

type Subject = Pick<AuthUser, "active" | "roles" | "restaurantIds">;

/**
 * ¿Puede este usuario hacer esto (en este restaurante)?
 *
 * Cerrado por defecto: sin usuario, desactivado, sin roles, o una acción de
 * restaurante sin `restaurantId`, es que no.
 */
export function can(
  subject: Subject | null | undefined,
  action: Action,
  restaurantId?: string | null,
): boolean {
  if (!subject || !subject.active) return false;
  return subject.roles.some((role) => {
    if (!ROLE_PERMISSIONS[role]?.includes(action)) return false;
    if (!isRestaurantAction(action)) return true;
    if (role === ROLES.ADMIN) return true;
    return Boolean(restaurantId) && subject.restaurantIds.includes(restaurantId as string);
  });
}

/** De una lista de restaurantes, los que este usuario puede ver con `action`. */
export function restaurantsAllowed<T extends { id: string }>(
  subject: Subject | null | undefined,
  action: Action,
  list: T[],
): T[] {
  return list.filter((r) => can(subject, action, r.id));
}

export type Destination = {
  href: string;
  label: string;
  description: string;
  kind: "admin" | "restaurante" | "analiticas";
};

/**
 * A dónde puede entrar después del login. Con un solo destino se le lleva
 * directo; con varios, se le deja elegir.
 */
export function destinationsFor(
  subject: (Subject & { roles: Role[] }) | null | undefined,
  allRestaurants: { id: string; name: string }[],
): Destination[] {
  if (!subject || !subject.active) return [];
  const out: Destination[] = [];
  if (can(subject, "usuarios:gestionar")) {
    out.push({
      href: "/admin",
      label: "Administración",
      description: "Usuarios, roles y todos los restaurantes.",
      kind: "admin",
    });
  }
  // El admin ya llega a cada restaurante desde /admin: aquí solo los que
  // tiene asignados alguien con el rol restaurante.
  if (subject.roles.includes(ROLES.RESTAURANTE)) {
    for (const r of allRestaurants) {
      if (subject.restaurantIds.includes(r.id) && can(subject, "rapido:ver", r.id)) {
        out.push({
          href: `/restaurante/${r.id}/rapido`,
          label: r.name,
          description: "Modo sencillo y plano del restaurante.",
          kind: "restaurante",
        });
      }
    }
  }
  // Por ROL, no por permiso: el admin también puede ver estadísticas, pero su
  // destino es /admin. Solo quien tiene el rol analitica entra aquí directo
  // (o lo elige, si además tiene otros roles).
  if (subject.roles.includes(ROLES.ANALITICA) && can(subject, "analiticas:ver")) {
    out.push({
      href: "/analiticas",
      label: "Estadísticas",
      description: "Todos los restaurantes, con el asistente IA.",
      kind: "analiticas",
    });
  }
  return out;
}
