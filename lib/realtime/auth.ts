// Permisos de las conexiones de tiempo real.
//
// El handshake lee la sesión de Better Auth desde la cookie que el navegador
// manda al abrir el socket (mismo origen, así que viaja sola). Sin sesión
// válida, o con el usuario desactivado, la conexión se rechaza.
//
// Cada evento vuelve a leer al usuario de la base: si un admin le quita un
// restaurante o lo desactiva con el socket abierto, el siguiente evento ya se
// rechaza. Las reglas son las de `lib/auth/rbac.ts`, como en el resto de la
// app.

import type { IncomingHttpHeaders } from "node:http";

import { getAuth } from "@/lib/auth/auth";
import { can } from "@/lib/auth/rbac";
import { loadAuthUser } from "@/lib/auth/users";

export type SocketIdentity = {
  userId: string;
};

function toHeaders(incoming: IncomingHttpHeaders): Headers {
  const headers = new Headers();
  for (const [name, value] of Object.entries(incoming)) {
    if (typeof value === "string") headers.set(name, value);
    else if (Array.isArray(value)) headers.set(name, value.join(", "));
  }
  return headers;
}

/** Quién abre la conexión. `null` = rechazarla. */
export async function identifySocket(handshake: {
  headers: IncomingHttpHeaders;
}): Promise<SocketIdentity | null> {
  const result = await getAuth().api.getSession({ headers: toHeaders(handshake.headers) });
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
