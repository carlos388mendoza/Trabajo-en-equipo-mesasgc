// Crea el primer administrador. Pensado para producción, donde el seed NO
// crea usuarios de prueba.
//
//   npm run create-admin
//
// Toma los datos de ADMIN_NAME, ADMIN_EMAIL y ADMIN_PASSWORD si están en el
// entorno; si no, los pregunta (la contraseña sin mostrarla). No hay ninguna
// contraseña escrita en este archivo.
//
// Si el correo ya existe, no toca su contraseña: solo le añade el rol admin y
// lo reactiva. Usa la base de TURSO_DATABASE_URL (.env.local), que tiene que
// tener las migraciones aplicadas.

import { config } from "dotenv";

import { ask } from "./lib/terminal.mts";

config({ path: [".env.local", ".env"], quiet: true });

const { MIN_PASSWORD_LENGTH } = await import("@/lib/auth/auth");
const { createUserWithPassword, findUserIdByEmail, setUserActive } = await import("@/lib/auth/users");
const { db } = await import("@/lib/db");
const { userRoles } = await import("@/lib/db/schema");

async function value(env: string | undefined, question: string, hidden = false): Promise<string> {
  if (env && env.trim()) return env.trim();
  if (!process.stdin.isTTY) {
    throw new Error(`${question.replace(/:\s*$/, "")}: falta, y no hay terminal para preguntarlo.`);
  }
  return ask(question, { hidden });
}

try {
  const email = (await value(process.env.ADMIN_EMAIL, "Correo del admin: ")).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error("Ese correo no es válido.");

  const existing = await findUserIdByEmail(email);
  if (existing) {
    await db.insert(userRoles).values({ userId: existing, role: "admin" }).onConflictDoNothing();
    await setUserActive(existing, true);
    console.log(`${email} ya existía: ahora tiene el rol admin y está activo. Su contraseña NO cambió (para cambiarla: npm run reset-password).`);
  } else {
    const name = await value(process.env.ADMIN_NAME, "Nombre: ");
    const password = await value(process.env.ADMIN_PASSWORD, "Contraseña (no se muestra): ", true);
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`La contraseña necesita al menos ${MIN_PASSWORD_LENGTH} caracteres.`);
    }
    await createUserWithPassword({
      name: name || "Administrador",
      email,
      password,
      roles: ["admin"],
      restaurantIds: [],
    });
    console.log(`Admin creado: ${email}. Ya puede entrar en /login.`);
  }
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
