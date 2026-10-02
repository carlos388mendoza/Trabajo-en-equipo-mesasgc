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
  /** Crear, editar y desactivar marcas y restaurantes (/admin). */
  | "catalogo:gestionar"
  /** Ver el editor de mesas (modo completo). */
  | "editor:ver"
  /** Guardar o copiar la estructura del local, y elegir su plano por defecto. */
  | "editor:guardar"
  /**
   * Crear, editar, borrar y ACTIVAR las configuraciones de zonas de meseros
   * («2 meseros», «3 meseros»…). Verlas en el plano solo pide `plano:ver`.
   */
  | "meseros:gestionar"
  /** Ver el modo rápido (modo sencillo). */
  | "rapido:ver"
  /** Añadir clientes y marcarlos listos o ausentes. */
  | "rapido:modificar"
  /** Sentar o liberar mesas (Socket.IO). */
  | "mesas:asignar"
  /** Estadísticas, vista global y por restaurante. */
  | "analiticas:ver"
  /** Asistente IA sobre las estadísticas. */
  | "asistente:usar"
  /** Mapa general (/mapa) y la sala `overview` de Socket.IO. */
  | "mapa:ver"
  /** Plano en vivo de un restaurante, en solo lectura: estados y ocupación. */
  | "plano:ver"
  /** Nombre del cliente sentado en cada mesa, dentro del plano en vivo. */
  | "plano:clientes"
  /**
   * Ver que hay datos de demostración cargados y cuántos son (/admin/datos-demo
   * y el aviso global). Admin y analítica.
   */
  | "demo:ver"
  /**
   * BORRAR los datos de demostración (todos, o los de un restaurante). Solo
   * admin, a propósito: es la operación que más filas elimina de golpe, así
   * que no se delega a nadie más.
   */
  | "demo:borrar";

export const ALL_ACTIONS: readonly Action[] = [
  "usuarios:gestionar",
  "catalogo:gestionar",
  "editor:ver",
  "editor:guardar",
  "meseros:gestionar",
  "rapido:ver",
  "rapido:modificar",
  "mesas:asignar",
  "analiticas:ver",
  "asistente:usar",
  "mapa:ver",
  "plano:ver",
  "plano:clientes",
  "demo:ver",
  "demo:borrar",
];

/**
 * Acciones que son "de un restaurante": piden `restaurantId`, y el rol
 * restaurante solo las tiene en los suyos. El resto son globales.
 */
const RESTAURANT_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  "editor:ver",
  "editor:guardar",
  "meseros:gestionar",
  "rapido:ver",
  "rapido:modificar",
  "mesas:asignar",
  "plano:ver",
  "plano:clientes",
]);

export function isRestaurantAction(action: Action): boolean {
  return RESTAURANT_ACTIONS.has(action);
}

/** Qué acciones da cada rol. */
export const ROLE_PERMISSIONS: Record<Role, readonly Action[]> = {
  // Todo, en todos los restaurantes.
  [ROLES.ADMIN]: ALL_ACTIONS,
  // Modo sencillo y completo, solo en SUS restaurantes. Sin `demo:ver` (desde
  // el 2 de octubre, pedido de la dirección): el aviso de datos demo es para
  // admin y analítica; el host distingue cada carta de demostración por su
  // etiqueta «Demo» en el modo sencillo.
  [ROLES.RESTAURANTE]: [
    "editor:ver",
    "editor:guardar",
    "meseros:gestionar",
    "rapido:ver",
    "rapido:modificar",
    "mesas:asignar",
    "plano:ver",
    "plano:clientes",
  ],
  // Solo lectura: estadísticas de todos, el asistente y el mapa general. En
  // el plano en vivo ve estados y ocupación, pero NO los nombres de los
  // clientes (`plano:clientes`): son datos personales que no necesita.
  //
  // `demo:ver` sí lo tiene y `demo:borrar` NO: aunque ya no queda ninguna pantalla
  // que administer la demostración, ambas acciones se conservan porque el sistema
  // de datos demo (`lib/demo`) sigue vivo y las usa su comprobación de permisos.
  [ROLES.ANALITICA]: ["analiticas:ver", "asistente:usar", "mapa:ver", "plano:ver", "demo:ver"],
};

/**
 * En qué restaurantes vale cada rol para las acciones de restaurante: en
 * todos o solo en los suyos (`user_restaurants`). Analitica es "todos"
 * porque su única acción de restaurante es mirar el plano (`plano:ver`).
 */
const ROLE_SCOPE: Record<Role, "todos" | "suyos"> = {
  [ROLES.ADMIN]: "todos",
  [ROLES.RESTAURANTE]: "suyos",
  [ROLES.ANALITICA]: "todos",
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
    if (!restaurantId) return false;
    if (ROLE_SCOPE[role] === "todos") return true;
    return subject.restaurantIds.includes(restaurantId);
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
  kind: "admin" | "restaurante" | "analiticas" | "mapa";
};

/**
 * A dónde puede entrar después del login: las tarjetas de /inicio. Si se le
 * lleva directo o elige lo decide `landingFor`.
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
  // Mapa general: admin y analitica.
  if (can(subject, "mapa:ver")) {
    out.push({
      href: "/mapa",
      label: "Mapa general",
      description: "Todos los restaurantes en vivo: ocupación y espera por marca y ciudad.",
      kind: "mapa",
    });
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

/**
 * A dónde se le lleva directo desde /inicio, o null para dejarle elegir.
 *
 * Con un solo rol, cada uno entra a su pantalla principal aunque tenga más
 * destinos: el admin al mapa general (llega a /admin por el encabezado) y
 * analitica a las estadísticas (y al mapa, por el encabezado). Un host entra
 * directo solo si tiene un único restaurante. Con varios roles distintos
 * (el gerente), elige.
 */
export function landingFor(
  subject: (Subject & { roles: Role[] }) | null | undefined,
  destinations: Destination[],
): string | null {
  if (!subject || !subject.active) return null;
  const roles = [...new Set(subject.roles)];
  if (roles.length === 1) {
    const [only] = roles;
    const preferred: Destination["kind"] | null =
      only === ROLES.ADMIN ? "mapa" : only === ROLES.ANALITICA ? "analiticas" : null;
    const match = preferred ? destinations.find((d) => d.kind === preferred) : undefined;
    if (match) return match.href;
  }
  return destinations.length === 1 ? destinations[0].href : null;
}
