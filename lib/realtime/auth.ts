// Permisos de las conexiones de tiempo real.
//
// Es el ÚNICO sitio que hay que cambiar cuando Better Auth esté montado. Todo
// lo demás (join, asignar, liberar) pasa por aquí.
//
// TODO (Ambos / Better Auth): en `identifySocket`, leer la sesión desde la
// cookie del handshake, algo como
// `await auth.api.getSession({ headers: new Headers(handshake.headers) })`,
// y devolver `null` si no hay sesión (la conexión se rechaza). En
// `canJoinRestaurant`, usar `canAccessRestaurant(role, user.restaurantId, id)`
// de `lib/db/enums.ts`. Hasta entonces es un placeholder deliberado, igual
// que `assertCanEditRestaurant` en las actions del editor: deja pasar a todos,
// y la integridad la dan las reglas de `lib/tables/assign.ts`.

import type { IncomingHttpHeaders } from "node:http";

export type SocketIdentity = {
  userId: string | null;
};

/** Quién abre la conexión. `null` = rechazarla. */
export async function identifySocket(handshake: {
  headers: IncomingHttpHeaders;
}): Promise<SocketIdentity | null> {
  void handshake;
  return { userId: null };
}

/** ¿Puede este usuario entrar en la room de este restaurante? */
export async function canJoinRestaurant(
  identity: SocketIdentity,
  restaurantId: string,
): Promise<boolean> {
  void identity;
  void restaurantId;
  return true;
}
