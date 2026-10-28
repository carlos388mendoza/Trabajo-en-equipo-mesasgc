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
  deleteUserSchema,
  firstError,
  resetPasswordSchema,
  setActiveSchema,
  updateAccessSchema,
} from "@/lib/auth/admin-input";
import { guardAction } from "@/lib/auth/session";
import {
  UserInputError,
  createUserWithPassword,
  deleteUser,
  loadAuthUser,
  setUserAccess,
  setUserActive,
  setUserPassword,
} from "@/lib/auth/users";
import { WEAKNESS_TEXT, findUsersWithPublicPassword, passwordWeakness } from "@/lib/auth/weak-passwords";
import { ROLES } from "@/lib/db/enums";
import { logServerError } from "@/lib/log";

export type AdminResult = { ok: true; message: string } | { ok: false; error: string };

async function run(work: () => Promise<string>): Promise<AdminResult> {
  try {
    const message = await work();
    revalidatePath("/admin");
    return { ok: true, message };
  } catch (error) {
    if (error instanceof UserInputError) return { ok: false, error: error.message };
    logServerError("[admin] error", error);
    return { ok: false, error: "No se pudo guardar. Inténtalo de nuevo." };
  }
}

/** Se guarda igual, pero el admin se entera (ver `lib/auth/weak-passwords.ts`). */
function weakWarning(password: string): string {
  const weakness = passwordWeakness(password);
  return weakness ? ` Ojo: esa contraseña ${WEAKNESS_TEXT[weakness]}; cualquiera que la conozca puede entrar como este usuario.` : "";
}

/**
 * «Revisar contraseñas»: qué usuarios activos tienen una contraseña de las que
 * están escritas en el código. Solo dice quiénes; nunca la contraseña.
 */
export async function checkPublicPasswordsAction(): Promise<AdminResult> {
  const guard = await guardAction("usuarios:gestionar");
  if (!guard.ok) return guard;
  try {
    const found = await findUsersWithPublicPassword();
    return found.length === 0
      ? { ok: true, message: "Ningún usuario activo usa una contraseña de las que están en el código." }
      : {
          ok: false,
          error: `${found.length} usuario(s) usan una contraseña que está en el código público: ${found.map((u) => u.email).join(", ")}. Cámbiala con «Contraseña» → «Generar otra».`,
        };
  } catch (error) {
    logServerError("[admin] revisar contraseñas", error);
    return { ok: false, error: "No se pudieron revisar las contraseñas. Inténtalo de nuevo." };
  }
}

export async function createUserAction(raw: unknown): Promise<AdminResult> {
  const guard = await guardAction("usuarios:gestionar");
  if (!guard.ok) return guard;
  const parsed = createUserSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  return run(async () => {
    await createUserWithPassword(parsed.data);
    return `Usuario ${parsed.data.email} creado.${weakWarning(parsed.data.password)}`;
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
  const target = await loadAuthUser(parsed.data.userId);
  if (!target) return { ok: false, error: "Ese usuario no existe." };
  return run(async () => {
    await setUserPassword(target.id, parsed.data.password);
    return (target.id === guard.user.id
      ? `Contraseña cambiada para ${target.email}. Vuelve a entrar con la nueva.`
      : `Contraseña cambiada para ${target.email}. Sus sesiones abiertas se cerraron.`) + weakWarning(parsed.data.password);
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

export async function deleteUserAction(raw: unknown): Promise<AdminResult> {
  const guard = await guardAction("usuarios:gestionar");
  if (!guard.ok) return guard;
  const parsed = deleteUserSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: firstError(parsed.error) };
  if (parsed.data.userId === guard.user.id) {
    return { ok: false, error: "No puedes eliminar tu propia cuenta." };
  }
  const target = await loadAuthUser(parsed.data.userId);
  if (!target) return { ok: false, error: "Ese usuario no existe." };
  return run(async () => {
    await deleteUser(target.id);
    return `Cuenta de ${target.email} eliminada.`;
  });
}
