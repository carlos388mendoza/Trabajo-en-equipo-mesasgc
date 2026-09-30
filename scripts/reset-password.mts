// Cambia la contraseña de UN usuario que ya existe. Pensado para producción,
// cuando nadie puede entrar a /admin para restablecerla (por ejemplo, el
// propio admin olvidó la suya).
//
//   npm run reset-password
//   railway run npm run reset-password   (contra la base de producción)
//
// Pregunta el correo y la contraseña nueva (dos veces, sin mostrarla) en la
// terminal de quien lo corre. A propósito NO la acepta por variables de
// entorno ni por argumentos: así no queda en el historial ni en los logs.
//
// Solo toca la contraseña de ese usuario (la misma función que el botón
// «Contraseña» de /admin) y cierra sus sesiones abiertas. No crea usuarios, no
// cambia roles ni restaurantes, y no reactiva a un usuario desactivado.

import { config } from "dotenv";

import { ask, requireTerminal } from "./lib/terminal.mts";

config({ path: [".env.local", ".env"], quiet: true });

const { MIN_PASSWORD_LENGTH } = await import("@/lib/auth/auth");
const { findUserIdByEmail, setUserPassword } = await import("@/lib/auth/users");
const { db } = await import("@/lib/db");
const { user } = await import("@/lib/db/schema");
const { eq } = await import("drizzle-orm");

/** Solo el host de la base, para saber dónde se va a cambiar (nunca el token). */
function databaseHost(): string {
  const url = process.env.TURSO_DATABASE_URL ?? "";
  try {
    return url.startsWith("file:") ? url : new URL(url).host;
  } catch {
    return "(TURSO_DATABASE_URL no válida)";
  }
}

try {
  requireTerminal("La contraseña nueva");
  console.log(`Base de datos: ${databaseHost()}`);

  const email = (await ask("Correo del usuario: ")).toLowerCase();
  const userId = email ? await findUserIdByEmail(email) : null;
  if (!userId) throw new Error(`No hay ningún usuario con el correo «${email}». No se cambió nada.`);
  const [found] = await db.select({ name: user.name, active: user.active }).from(user).where(eq(user.id, userId));

  const password = await ask(`Contraseña nueva (mínimo ${MIN_PASSWORD_LENGTH} caracteres, no se muestra): `, { hidden: true, trim: false });
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`La contraseña necesita al menos ${MIN_PASSWORD_LENGTH} caracteres. No se cambió nada.`);
  }
  if (password !== password.trim()) {
    throw new Error("La contraseña no puede empezar ni terminar con espacios. No se cambió nada.");
  }
  const repeated = await ask("Repítela: ", { hidden: true, trim: false });
  if (repeated !== password) throw new Error("Las dos contraseñas no coinciden. No se cambió nada.");

  const confirm = await ask(`¿Cambiar la contraseña de ${found?.name ?? email} (${email}) en ${databaseHost()}? Escribe «si» para confirmar: `);
  if (confirm.toLowerCase() !== "si" && confirm.toLowerCase() !== "sí") {
    console.log("Cancelado. No se cambió nada.");
    process.exit(0);
  }

  await setUserPassword(userId, password);
  console.log(`Contraseña cambiada para ${email}. Sus sesiones abiertas se cerraron: ya puede entrar con la nueva.`);
  if (found && !found.active) {
    console.log("Ojo: este usuario está DESACTIVADO, así que no podrá entrar hasta que un admin lo active en /admin.");
  }
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
