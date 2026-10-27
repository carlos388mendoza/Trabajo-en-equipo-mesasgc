// Permisos de las conexiones de tiempo real.
//
// Cada petición de tiempo real (`/api/tiempo-real`) lee la sesión de Better
// Auth desde la cookie (mismo origen, así que viaja sola). Sin sesión válida,
// o con el usuario desactivado, se rechaza.
//
// Cada evento vuelve a leer al usuario de la base: si un admin le quita un
// restaurante o lo desactiva con la pantalla abierta, el siguiente evento ya
// se rechaza. Las reglas son las de `lib/auth/rbac.ts`, como en el resto de la
// app.

import { getAuth } from "@/lib/auth/auth";
import { can } from "@/lib/auth/rbac";
import { loadAuthUser } from "@/lib/auth/users";

export type SocketIdentity = {
  userId: string;
};

/**
 * Quién hace una petición de tiempo real (`app/api/tiempo-real`): la misma
 * sesión de Better Auth, leída de la cookie. `null` = sin sesión o desactivado.
 */
export async function identifyRequest(headers: Headers): Promise<SocketIdentity | null> {
  const result = await getAuth().api.getSession({ headers });
  if (!result) return null;
  const current = await loadAuthUser(result.user.id);
  if (!current || !current.active) return null;
  return { userId: current.id };
}

/**
 * ¿Puede entrar en la room de este restaurante? Quien ve el editor o el modo
 * rápido de ese restaurante; analitica no, porque no edita en vivo.
 */
export async function canJoinRestaurant(
  identity: SocketIdentity,
  restaurantId: string,
): Promise<boolean> {
  const current = await loadAuthUser(identity.userId);
  return can(current, "editor:ver", restaurantId) || can(current, "rapido:ver", restaurantId);
}

/** ¿Puede sentar o liberar mesas en este restaurante? */
export async function canAssignTables(
  identity: SocketIdentity,
  restaurantId: string,
): Promise<boolean> {
  return can(await loadAuthUser(identity.userId), "mesas:asignar", restaurantId);
}

/**
 * ¿Puede entrar en la sala `overview` (mapa general)? Quien tiene
 * `mapa:ver`: admin y analitica. El rol restaurante no, aunque la sala solo
 * lleve números: son los de TODOS los restaurantes.
 */
export async function canJoinOverview(identity: SocketIdentity): Promise<boolean> {
  return can(await loadAuthUser(identity.userId), "mapa:ver");
}

/** ¿Puede modificar la lista de espera de este restaurante? */
export async function canModifyWaitlist(
  identity: SocketIdentity,
  restaurantId: string,
): Promise<boolean> {
  return can(await loadAuthUser(identity.userId), "rapido:modificar", restaurantId);
}
