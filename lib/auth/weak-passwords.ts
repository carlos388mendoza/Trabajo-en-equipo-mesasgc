// Contraseñas públicas o muy débiles (revisión de seguridad del 27 de octubre
// de 2026).
//
// El repositorio es PÚBLICO: la contraseña de desarrollo del seed y de las
// pruebas se lee en GitHub, igual que los correos de los usuarios de ejemplo.
// Si un usuario de producción la usa, cualquiera que lea el código puede entrar
// con sus permisos. No se prohíbe (lo decide el admin), pero se avisa en tres
// sitios: al guardarla en /admin, al entrar a producción con ella (aviso en el
// encabezado y una línea en el log, sin el correo) y con «Revisar contraseñas»
// en /admin, que las comprueba contra el hash guardado.

import { verifyPassword } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { account, user } from "@/lib/db/schema";

/** Las que aparecen escritas en el código del repositorio (seed, pruebas, guiones). */
export const PUBLIC_PASSWORDS: readonly string[] = ["12345abc", "12345abcd"];

/** Las de siempre: las primeras que prueba cualquiera. */
const COMMON_PASSWORDS = new Set([
  "12345678",
  "123456789",
  "1234567890",
  "password",
  "contraseña",
  "contrasena",
  "qwerty123",
  "admin123",
  "abc12345",
  "abcd1234",
  "grupocomidas",
]);

export type PasswordWeakness = "publica" | "debil";

export function passwordWeakness(password: string): PasswordWeakness | null {
  if (PUBLIC_PASSWORDS.includes(password)) return "publica";
  if (
    COMMON_PASSWORDS.has(password.toLowerCase()) ||
    password.length < 10 ||
    /^\d+$/.test(password) ||
    /^[a-záéíóúñ]+$/i.test(password) ||
    /^(.)\1+$/.test(password)
  ) {
    return "debil";
  }
  return null;
}

export const WEAKNESS_TEXT: Record<PasswordWeakness, string> = {
  publica: "está escrita en el código del repositorio, que es público",
  debil: "es muy fácil de adivinar (menos de 10 caracteres, solo números o solo letras, o de las más usadas)",
};

/**
 * ¿Es la app de verdad, en internet? Producción con una URL https. En local y
 * en el CI (http://localhost) no se avisa: ahí la contraseña de desarrollo es
 * la normal y el aviso solo movería las pantallas que se miden.
 */
export function isPublicDeployment(): boolean {
  return process.env.NODE_ENV === "production" && (process.env.BETTER_AUTH_URL ?? "").startsWith("https://");
}

/** Cookie que deja el login para el aviso del encabezado (solo dice el tipo, nada más). */
export const WEAK_PASSWORD_COOKIE = "tw-clave-debil";

export type UserWithPublicPassword = { id: string; name: string; email: string };

/**
 * Los usuarios activos cuya contraseña es una de `PUBLIC_PASSWORDS`. Compara
 * contra el hash (scrypt): es lento a propósito, por eso va detrás de un
 * botón y no al cargar /admin. Uno a uno, para no acaparar el servidor.
 */
export async function findUsersWithPublicPassword(): Promise<UserWithPublicPassword[]> {
  const rows = await db
    .select({ id: user.id, name: user.name, email: user.email, hash: account.password })
    .from(user)
    .innerJoin(account, and(eq(account.userId, user.id), eq(account.providerId, "credential")))
    .where(eq(user.active, true));
  const found: UserWithPublicPassword[] = [];
  for (const row of rows) {
    if (!row.hash) continue;
    for (const password of PUBLIC_PASSWORDS) {
      if (await verifyPassword({ hash: row.hash, password })) {
        found.push({ id: row.id, name: row.name, email: row.email });
        break;
      }
    }
  }
  return found;
}
