// Configuración de Better Auth: correo y contraseña sobre Drizzle (libSQL).
//
// Se crea al primer uso y no al importar, igual que `db`: así `next build`
// no exige BETTER_AUTH_SECRET ni la base de datos para compilar.
//
// No hay registro público (`disableSignUp`): los usuarios los crea un admin
// desde /admin, el seed (solo en desarrollo) o `npm run create-admin`.
//
// Quién puede hacer qué NO está aquí: eso es `lib/auth/rbac.ts`. Este archivo
// solo responde "¿quién es?".

import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError } from "better-auth/api";
import { nextCookies } from "better-auth/next-js";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { account, session, user, verification } from "@/lib/db/schema";

export const MIN_PASSWORD_LENGTH = 8;
export const INACTIVE_USER_MESSAGE = "Usuario desactivado";

function createAuth() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) {
    throw new Error(
      "Falta BETTER_AUTH_SECRET. Genera uno con `openssl rand -base64 32` y ponlo en .env.local.",
    );
  }

  const baseURL =
    process.env.BETTER_AUTH_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined);
  const trustedOrigins = [
    baseURL,
    process.env.VERCEL_BRANCH_URL ? `https://${process.env.VERCEL_BRANCH_URL}` : undefined,
    process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : undefined,
  ].filter((o): o is string => Boolean(o));

  return betterAuth({
    secret,
    baseURL,
    trustedOrigins: trustedOrigins.length > 0 ? trustedOrigins : undefined,
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: { user, session, account, verification },
    }),
    emailAndPassword: {
      enabled: true,
      disableSignUp: true,
      minPasswordLength: MIN_PASSWORD_LENGTH,
      autoSignIn: false,
    },
    user: {
      // `active` es nuestro. `input: false`: nadie lo cambia desde el API de
      // Better Auth, solo el admin con sus propias actions.
      additionalFields: {
        active: { type: "boolean", required: false, defaultValue: true, input: false },
      },
    },
    session: {
      // Caché firmada en una cookie: durante 60 s el sondeo no consulta la sesión
      // en la base (ahorra 2 de ~10 consultas por pregunta). Costo en seguridad:
      // lo que revoca la base (cerrar sesión desde otro dispositivo, cambiar o
      // eliminar la contraseña) puede tardar hasta 60 s en cortar una cookie ya
      // copiada. Desactivar o eliminar la cuenta corta al instante, porque `active`
      // y el usuario se leen de la base en cada petición (`identifyRequest`,
      // `getCurrentUser`). Tope acordado: 5 minutos; no subir de ahí.
      cookieCache: { enabled: true, maxAge: 60 },
    },
    databaseHooks: {
      session: {
        create: {
          // Un usuario desactivado no puede abrir sesión, aunque la
          // contraseña sea correcta. Es el único punto por el que pasan todos
          // los inicios de sesión.
          before: async (newSession) => {
            const [row] = await db
              .select({ active: user.active })
              .from(user)
              .where(eq(user.id, newSession.userId))
              .limit(1);
            if (!row || !row.active) {
              throw new APIError("FORBIDDEN", {
                message: INACTIVE_USER_MESSAGE,
                code: "USER_INACTIVE",
              });
            }
          },
        },
      },
    },
    // Cookie de sesión `httpOnly` y `SameSite=Lax` (lo que pone Better Auth
    // por defecto); además `Secure` cuando BETTER_AUTH_URL es https.
    // `nextCookies` deja que las server actions (el login) pongan la cookie.
    // Tiene que ser el último plugin.
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;

let instance: Auth | null = null;

export function getAuth(): Auth {
  if (!instance) instance = createAuth();
  return instance;
}
