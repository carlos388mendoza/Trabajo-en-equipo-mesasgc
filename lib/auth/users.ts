// Usuarios de la app: leerlos con sus roles y restaurantes, y crearlos o
// modificarlos.
//
// No importa nada de Next: lo usan igual las actions de /admin, el seed,
// `create-admin`, el handshake de Socket.IO y los `verify:*`.
//
// Las contraseñas se hashean con la misma función que usa Better Auth al
// iniciar sesión (`better-auth/crypto`), y se guardan en `account` con el
// proveedor "credential", que es donde Better Auth las busca.

import { and, asc, eq, inArray, notInArray } from "drizzle-orm";
import { hashPassword } from "better-auth/crypto";

import { db } from "@/lib/db";
import { type Role, ROLE_VALUES } from "@/lib/db/enums";
import {
  account,
  brands,
  restaurants,
  session,
  user,
  userRestaurants,
  userRoles,
} from "@/lib/db/schema";

/** Lo que el resto de la app sabe de quien tiene la sesión. */
export type AuthUser = {
  id: string;
  name: string;
  email: string;
  active: boolean;
  roles: Role[];
  /**
   * Restaurantes asignados y ACTIVOS (solo cuentan con el rol restaurante).
   * Un restaurante desactivado no sale aquí: así su host pierde el acceso en
   * todas partes (páginas, API y socket), que pasan por `can()`.
   */
  restaurantIds: string[];
};

const CREDENTIAL_PROVIDER = "credential";

function asRoles(values: string[]): Role[] {
  // Un valor desconocido en la base (editado a mano) no da permisos.
  return values.filter((v): v is Role => (ROLE_VALUES as string[]).includes(v));
}

/** El usuario con sus roles y restaurantes, o null si no existe. */
export async function loadAuthUser(userId: string): Promise<AuthUser | null> {
  const [row] = await db
    .select({ id: user.id, name: user.name, email: user.email, active: user.active })
    .from(user)
    .where(eq(user.id, userId))
    .limit(1);
  if (!row) return null;

  const [roleRows, restaurantRows] = await Promise.all([
    db.select({ role: userRoles.role }).from(userRoles).where(eq(userRoles.userId, userId)),
    db
      .select({ restaurantId: userRestaurants.restaurantId })
      .from(userRestaurants)
      .innerJoin(restaurants, eq(restaurants.id, userRestaurants.restaurantId))
      .where(and(eq(userRestaurants.userId, userId), eq(restaurants.active, true))),
  ]);

  return {
    ...row,
    roles: asRoles(roleRows.map((r) => r.role)),
    restaurantIds: restaurantRows.map((r) => r.restaurantId),
  };
}

export async function findUserIdByEmail(email: string): Promise<string | null> {
  const [row] = await db
    .select({ id: user.id })
    .from(user)
    .where(eq(user.email, email.trim().toLowerCase()))
    .limit(1);
  return row?.id ?? null;
}

/** Todos los usuarios, para /admin. */
export async function listUsers(): Promise<AuthUser[]> {
  const rows = await db
    .select({ id: user.id, name: user.name, email: user.email, active: user.active })
    .from(user)
    .orderBy(asc(user.name));
  const [roleRows, restaurantRows] = await Promise.all([
    db.select().from(userRoles),
    db.select().from(userRestaurants),
  ]);
  return rows.map((u) => ({
    ...u,
    roles: asRoles(roleRows.filter((r) => r.userId === u.id).map((r) => r.role)),
    restaurantIds: restaurantRows.filter((r) => r.userId === u.id).map((r) => r.restaurantId),
  }));
}

export type NewUser = {
  name: string;
  email: string;
  password: string;
  roles: Role[];
  restaurantIds: string[];
};

export class UserInputError extends Error {}

async function assertRestaurantsExist(ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const found = await db
    .select({ id: restaurants.id })
    .from(restaurants)
    .where(and(inArray(restaurants.id, ids), eq(restaurants.active, true)));
  if (found.length !== new Set(ids).size) {
    throw new UserInputError("Alguno de los restaurantes elegidos no existe o está desactivado.");
  }
}

/** Crea un usuario con contraseña. Falla si el correo ya existe. */
export async function createUserWithPassword(input: NewUser): Promise<string> {
  const email = input.email.trim().toLowerCase();
  if (await findUserIdByEmail(email)) {
    throw new UserInputError("Ya existe un usuario con ese correo.");
  }
  await assertRestaurantsExist(input.restaurantIds);

  const id = crypto.randomUUID();
  const passwordHash = await hashPassword(input.password);
  const now = new Date();

  await db.transaction(async (tx) => {
    await tx.insert(user).values({
      id,
      name: input.name.trim(),
      email,
      // Lo da de alta un admin: no hay verificación por correo.
      emailVerified: true,
      active: true,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(account).values({
      id: crypto.randomUUID(),
      accountId: id,
      providerId: CREDENTIAL_PROVIDER,
      userId: id,
      password: passwordHash,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(userRoles).values([...new Set(input.roles)].map((role) => ({ userId: id, role })));
    if (input.restaurantIds.length > 0) {
      await tx
        .insert(userRestaurants)
        .values([...new Set(input.restaurantIds)].map((restaurantId) => ({ userId: id, restaurantId })));
    }
  });
  return id;
}

/** Sustituye los roles y restaurantes de un usuario. */
export async function setUserAccess(
  userId: string,
  roles: Role[],
  restaurantIds: string[],
): Promise<void> {
  await assertRestaurantsExist(restaurantIds);
  // Las asignaciones a restaurantes DESACTIVADOS no se tocan: /admin no los
  // ofrece, así que no vienen en `restaurantIds`, y borrarlas haría que al
  // reactivar el restaurante su host no recuperara el acceso.
  const inactive = db
    .select({ id: restaurants.id })
    .from(restaurants)
    .where(eq(restaurants.active, false));
  await db.transaction(async (tx) => {
    await tx.delete(userRoles).where(eq(userRoles.userId, userId));
    await tx
      .delete(userRestaurants)
      .where(and(eq(userRestaurants.userId, userId), notInArray(userRestaurants.restaurantId, inactive)));
    await tx.insert(userRoles).values([...new Set(roles)].map((role) => ({ userId, role })));
    if (restaurantIds.length > 0) {
      await tx
        .insert(userRestaurants)
        .values([...new Set(restaurantIds)].map((restaurantId) => ({ userId, restaurantId })))
        .onConflictDoNothing();
    }
    await tx.update(user).set({ updatedAt: new Date() }).where(eq(user.id, userId));
  });
}

/** Cierra todas las sesiones abiertas de un usuario. */
export async function revokeSessions(userId: string): Promise<void> {
  await db.delete(session).where(eq(session.userId, userId));
}

/**
 * Cambia la contraseña y cierra sus sesiones: quien tuviera la vieja
 * abierta tiene que volver a entrar.
 */
export async function setUserPassword(userId: string, password: string): Promise<void> {
  const passwordHash = await hashPassword(password);
  const updated = await db
    .update(account)
    .set({ password: passwordHash, updatedAt: new Date() })
    .where(and(eq(account.userId, userId), eq(account.providerId, CREDENTIAL_PROVIDER)))
    .returning({ id: account.id });
  if (updated.length === 0) {
    // Usuario sin cuenta de contraseña (no debería pasar): se le crea.
    await db.insert(account).values({
      id: crypto.randomUUID(),
      accountId: userId,
      providerId: CREDENTIAL_PROVIDER,
      userId,
      password: passwordHash,
    });
  }
  await revokeSessions(userId);
}

/** Activa o desactiva. Desactivar también cierra sus sesiones. */
export async function setUserActive(userId: string, active: boolean): Promise<void> {
  await db.update(user).set({ active, updatedAt: new Date() }).where(eq(user.id, userId));
  if (!active) await revokeSessions(userId);
}

export type RestaurantOption = {
  id: string;
  name: string;
  city: string | null;
  active: boolean;
  brand: { id: string; name: string; accentColor: string } | null;
};

/**
 * Restaurantes con su marca, para elegir accesos, /inicio y el selector de
 * restaurante. Por defecto solo los activos: uno desactivado no se ofrece.
 */
export async function listRestaurants({ includeInactive = false } = {}): Promise<RestaurantOption[]> {
  const rows = await db
    .select({
      id: restaurants.id,
      name: restaurants.name,
      city: restaurants.city,
      active: restaurants.active,
      brandId: brands.id,
      brandName: brands.name,
      brandColor: brands.accentColor,
    })
    .from(restaurants)
    .leftJoin(brands, eq(brands.id, restaurants.brandId))
    .where(includeInactive ? undefined : eq(restaurants.active, true))
    .orderBy(asc(restaurants.name));
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    city: r.city,
    active: r.active,
    brand: r.brandId && r.brandName && r.brandColor ? { id: r.brandId, name: r.brandName, accentColor: r.brandColor } : null,
  }));
}
