"use server";

// Acciones de /admin → «Configuración». Cada una vuelve a comprobar que quien
// la llama es admin («configuracion:gestionar»): una server action se puede
// invocar a mano sin pasar por la página. Capa fina: Zod → permiso →
// `lib/settings/privacy.ts` → revalidar.

import { revalidatePath } from "next/cache";

import { guardAction } from "@/lib/auth/session";
import {
  RETENTION_LABELS,
  anonymizeExpiredEntries,
  privacySettingsSchema,
  savePrivacySettings,
} from "@/lib/settings/privacy";

export type SettingsResult = { ok: true; message: string } | { ok: false; error: string };

export async function savePrivacySettingsAction(raw: unknown): Promise<SettingsResult> {
  const guard = await guardAction("configuracion:gestionar");
  if (!guard.ok) return guard;
  const parsed = privacySettingsSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: "Alguna opción no es válida." };
  try {
    await savePrivacySettings(parsed.data, guard.user.id);
    revalidatePath("/admin");
    return { ok: true, message: `Configuración guardada. Historial: ${RETENTION_LABELS[parsed.data.retention].toLowerCase()}.` };
  } catch (error) {
    console.error("[admin] configuración", error);
    return { ok: false, error: "No se pudo guardar. Inténtalo de nuevo." };
  }
}

/** Aplica la retención ahora mismo (también corre sola una vez al día). */
export async function runRetentionNowAction(): Promise<SettingsResult> {
  const guard = await guardAction("configuracion:gestionar");
  if (!guard.ok) return guard;
  try {
    const run = await anonymizeExpiredEntries();
    revalidatePath("/admin");
    return {
      ok: true,
      message:
        run.retention === "siempre"
          ? "El historial se guarda siempre: no hay nada que anonimizar."
          : `Listo: ${run.anonymized} cliente(s) anonimizado(s).`,
    };
  } catch (error) {
    console.error("[admin] retención", error);
    return { ok: false, error: "No se pudo aplicar. Inténtalo de nuevo." };
  }
}
