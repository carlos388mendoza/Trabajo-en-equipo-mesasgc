// Crea un usuario, o actualiza uno que ya existe, desde la terminal. Pensado
// para producción, para dar de alta a los usuarios del piloto sin entrar a
// /admin:
//
//   npm run create-user -- --correo dennys@grupocomidas.test --nombre "Denny's" --rol restaurante --marca "Denny's"
//   railway run npm run create-user -- ...   (contra la base de producción)
//
// Argumentos (se pueden repetir o separar con comas):
//   --correo      correo del usuario (obligatorio)
//   --nombre      nombre que se ve en la cabecera (obligatorio)
//   --rol         admin, restaurante o analitica (al menos uno)
//   --restaurante slug del restaurante, p. ej. pizza-hut-norte
//   --marca       todos los restaurantes activos de esa marca, p. ej. "Denny's"
//
// La contraseña se pregunta DOS veces, oculta, en la terminal de quien lo
// corre. A propósito NO se acepta por argumentos ni por variables de entorno:
// así no queda en el historial ni en los logs. Sin terminal, no hace nada.
//
// Si el correo ya existe no lo duplica: solo cambia su nombre, roles y
// restaurantes, y NO pregunta ni toca la contraseña (para eso está
// `npm run reset-password`). Usa las mismas validaciones y funciones que
// /admin (`lib/auth/user-upsert.ts`).

import { parseArgs } from "node:util";

import { config } from "dotenv";

import { ask, requireTerminal } from "./lib/terminal.mts";

config({ path: [".env.local", ".env"], quiet: true });

const { MIN_PASSWORD_LENGTH } = await import("@/lib/auth/auth");
const { existingUser, resolveRestaurants, upsertUser, validateUpsert } = await import("@/lib/auth/user-upsert");

/** Solo el host de la base, para saber dónde se va a escribir (nunca el token). */
function databaseHost(): string {
  const url = process.env.TURSO_DATABASE_URL ?? "";
  try {
    return url.startsWith("file:") ? url : new URL(url).host;
  } catch {
    return "(TURSO_DATABASE_URL no válida)";
  }
}

/** `--rol a --rol b` o `--rol a,b`: lo mismo. */
function list(values: string[] | undefined): string[] {
  return (values ?? []).flatMap((v) => v.split(",")).map((v) => v.trim()).filter(Boolean);
}

try {
  const { values } = parseArgs({
    options: {
      correo: { type: "string" },
      nombre: { type: "string" },
      rol: { type: "string", multiple: true },
      restaurante: { type: "string", multiple: true },
      marca: { type: "string", multiple: true },
      // Por si alguien intenta pasarla: se rechaza con un mensaje claro.
      contrasena: { type: "string" },
      password: { type: "string" },
    },
    strict: true,
  });
  if (values.contrasena !== undefined || values.password !== undefined) {
    throw new Error("La contraseña no se acepta por argumentos: se pregunta en la terminal. No se cambió nada.");
  }
  // Antes de leer la base: sin terminal no se puede preguntar ni confirmar.
  requireTerminal("La contraseña y la confirmación");

  const email = (values.correo ?? "").trim().toLowerCase();
  const name = (values.nombre ?? "").trim();
  const roles = list(values.rol);
  if (!email || !name || roles.length === 0) {
    throw new Error("Faltan datos: usa --correo, --nombre y al menos un --rol. No se cambió nada.");
  }

  console.log(`Base de datos: ${databaseHost()}`);
  const found = await resolveRestaurants({ slugs: list(values.restaurante), brands: list(values.marca) });
  const input = { email, name, roles, restaurantIds: found.map((r) => r.id) };
  const problem = validateUpsert(input);
  if (problem) throw new Error(`${problem} No se cambió nada.`);

  const current = await existingUser(email);
  console.log("");
  console.log(current ? `Ya existe: se ACTUALIZA (la contraseña no se toca).` : "No existe: se CREA.");
  console.log(`  Correo:        ${email}`);
  console.log(`  Nombre:        ${name}${current && current.name !== name ? ` (antes: ${current.name})` : ""}`);
  console.log(`  Roles:         ${roles.join(", ")}`);
  console.log(`  Restaurantes:  ${found.length ? found.map((r) => `${r.name} (${r.slug})`).join(", ") : "ninguno"}`);
  console.log("");

  let password: string | undefined;
  if (!current) {
    password = await ask(`Contraseña (mínimo ${MIN_PASSWORD_LENGTH} caracteres, no se muestra): `, { hidden: true, trim: false });
    if (password.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`La contraseña necesita al menos ${MIN_PASSWORD_LENGTH} caracteres. No se cambió nada.`);
    }
    if (password !== password.trim()) {
      throw new Error("La contraseña no puede empezar ni terminar con espacios. No se cambió nada.");
    }
    const repeated = await ask("Repítela: ", { hidden: true, trim: false });
    if (repeated !== password) throw new Error("Las dos contraseñas no coinciden. No se cambió nada.");
  }

  const confirm = await ask(`¿${current ? "Actualizar" : "Crear"} a ${email} en ${databaseHost()}? Escribe «si» para confirmar: `);
  if (confirm.toLowerCase() !== "si" && confirm.toLowerCase() !== "sí") {
    console.log("Cancelado. No se cambió nada.");
    process.exit(0);
  }

  const result = await upsertUser({ ...input, password });
  console.log(`Usuario ${email} ${result.action}.`);
  process.exit(0);
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
