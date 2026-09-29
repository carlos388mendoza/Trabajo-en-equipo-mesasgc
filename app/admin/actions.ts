"use server";

// Acciones de /admin. Cada una vuelve a comprobar que quien la llama es admin
// ("usuarios:gestionar"): una server action se puede invocar a mano sin pasar
// por la página.
//
// Dos reglas de seguridad propias:
//  - El admin no puede quitarse a sí mismo el rol de admin ni desactivarse
//    (se quedaría fuera, y quizá sin nadie que pueda volver a entrar).
//  - Cambiar la contraseña o desactivar cierra las sesiones abiertas de ese
//    usuario (lo hace `lib/auth/users.ts`).

import { revalidatePath } from "next/cache";

import {
  createUserSchema,
  firstError,
  resetPasswordSchema,
  setActiveSchema,
  updateAccessSchema,
} from "@/lib/auth/admin-input";
import { guardAction } from "@/lib/auth/session";
import {
  UserInputError,
  createUserWithPassword,
  setUserAccess,
  setUserActive,
  setUserPassword,
} from "@/lib/auth/users";
import { ROLES } from "@/lib/db/enums";

export type AdminResult = { ok: true; message: string } | { ok: false; error: string };

async function run(work: () => Promise<string>): Promise<AdminResult> {
  try {
    const message = await work();
    revalidatePath("/admin");
    return { ok: true, message };
  } catch (error) {
    if (error instanceof UserInputError) return { ok: false, error: error.message };
    console.error("[admin] error", error);
    return { ok: false, error: "No se pudo guardar. Inténtalo de nuevo." };
  }
}

export async function createUserAction(raw: unknown): Promise<AdminResult> {
  const guard = await guardAction("usuarios:gestionar");
  if (!guard.ok) return guard;
  const parsed = createUserSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  return run(async () => {
    await createUserWithPassword(parsed.data);
    return `Usuario ${parsed.data.email} creado.`;
  });
}

export async function updateAccessAction(raw: unknown): Promise<AdminResult> {
  const guard = await guardAction("usuarios:gestionar");
  if (!guard.ok) return guard;
  const parsed = updateAccessSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  const { userId, roles, restaurantIds } = parsed.data;
  if (userId === guard.user.id && !roles.includes(ROLES.ADMIN)) {
    return { ok: false, error: "No puedes quitarte a ti mismo el rol de administrador." };
  }
  return run(async () => {
    await setUserAccess(userId, roles, restaurantIds);
    return "Roles y restaurantes actualizados.";
  });
}

export async function resetPasswordAction(raw: unknown): Promise<AdminResult> {
  const guard = await guardAction("usuarios:gestionar");
  if (!guard.ok) return guard;
  const parsed = resetPasswordSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  return run(async () => {
    await setUserPassword(parsed.data.userId, parsed.data.password);
    return parsed.data.userId === guard.user.id
      ? "Contraseña cambiada. Vuelve a entrar con la nueva."
      : "Contraseña restablecida. Sus sesiones abiertas se cerraron.";
  });
}

export async function setActiveAction(raw: unknown): Promise<AdminResult> {
  const guard = await guardAction("usuarios:gestionar");
  if (!guard.ok) return guard;
  const parsed = setActiveSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  if (parsed.data.userId === guard.user.id && !parsed.data.active) {
    return { ok: false, error: "No puedes desactivarte a ti mismo." };
  }
  return run(async () => {
    await setUserActive(parsed.data.userId, parsed.data.active);
    return parsed.data.active ? "Usuario activado." : "Usuario desactivado. Sus sesiones se cerraron.";
  });
}
