// Validación de lo que llega de /admin. Sin Next ni base de datos: la usan
// las server actions y `verify:auth`.

import { z } from "zod";

import { ROLES, ROLE_VALUES, type Role } from "@/lib/db/enums";

import { MIN_PASSWORD_LENGTH } from "./auth";

const roleSchema = z.enum(ROLE_VALUES as [Role, ...Role[]]);
const idSchema = z.string().min(1).max(64);

export const passwordSchema = z
  .string()
  .min(MIN_PASSWORD_LENGTH, `La contraseña necesita al menos ${MIN_PASSWORD_LENGTH} caracteres.`)
  .max(128, "La contraseña es demasiado larga.");

const accessSchema = z
  .object({
    roles: z.array(roleSchema).min(1, "Elige al menos un rol."),
    restaurantIds: z.array(idSchema).max(200),
  })
  // Un host sin restaurante no podría entrar a ningún sitio.
  .refine((v) => !v.roles.includes(ROLES.RESTAURANTE) || v.restaurantIds.length > 0, {
    message: "Un usuario de restaurante necesita al menos un restaurante.",
    path: ["restaurantIds"],
  })
  // Los restaurantes solo cuentan con el rol restaurante: sin él se descartan
  // para no dejar asignaciones que no significan nada.
  .transform((v) => ({
    roles: [...new Set(v.roles)],
    restaurantIds: v.roles.includes(ROLES.RESTAURANTE) ? [...new Set(v.restaurantIds)] : [],
  }));

export const createUserSchema = z
  .object({
    name: z.string().trim().min(1, "Escribe el nombre.").max(100),
    email: z.string().trim().toLowerCase().email("Ese correo no es válido.").max(200),
    password: passwordSchema,
    roles: z.array(z.string()),
    restaurantIds: z.array(z.string()),
  })
  .transform((v, ctx) => {
    const access = accessSchema.safeParse({ roles: v.roles, restaurantIds: v.restaurantIds });
    if (!access.success) {
      for (const issue of access.error.issues) ctx.addIssue({ ...issue, code: "custom" });
      return z.NEVER;
    }
    return { name: v.name, email: v.email, password: v.password, ...access.data };
  });

export const updateAccessSchema = z
  .object({ userId: idSchema, roles: z.array(z.string()), restaurantIds: z.array(z.string()) })
  .transform((v, ctx) => {
    const access = accessSchema.safeParse({ roles: v.roles, restaurantIds: v.restaurantIds });
    if (!access.success) {
      for (const issue of access.error.issues) ctx.addIssue({ ...issue, code: "custom" });
      return z.NEVER;
    }
    return { userId: v.userId, ...access.data };
  });

export const resetPasswordSchema = z.object({ userId: idSchema, password: passwordSchema });

export const setActiveSchema = z.object({ userId: idSchema, active: z.boolean() });

/** El primer mensaje de error de Zod, para mostrarlo tal cual. */
export function firstError(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Los datos no son válidos.";
}
