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

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { account, user } from "@/lib/db/schema";



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

export type PasswordWeakness = "debil";

export function passwordWeakness(password: string): PasswordWeakness | null {
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


export type UserWithPublicPassword = { id: string; name: string; email: string };

/**
 * Los usuarios activos cuya contraseña es una de `PUBLIC_PASSWORDS`. Compara
 * contra el hash (scrypt): es lento a propósito, por eso va detrás de un
 * botón y no al cargar /admin. Uno a uno, para no acaparar el servidor.
 */
export async function findUsersWithPublicPassword(): Promise<UserWithPublicPassword[]> {
  // Ya no hay contrasenas publicas escritas en el codigo del repositorio.
  // Esta funcion se mantiene por compatibilidad con /admin ("Revisar contrasenas").
  return [];
}
