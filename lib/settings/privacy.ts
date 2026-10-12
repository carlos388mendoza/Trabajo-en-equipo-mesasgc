// Opciones de privacidad que decide la dirección (/admin → «Configuración»).
//
// Tres decisiones, cada una con un valor por defecto SEGURO: sin fila en
// `app_settings`, la app ya se comporta así.
//
//  1. «La IA usa alias en lugar de nombres de clientes» (por defecto, sí): el
//     top de clientes viaja a OpenRouter como «Cliente 1», «Cliente 2»…
//  2. «Analítica puede ver los nombres del top 10» (por defecto, no): el rol
//     analítica ve «Cliente 1 (A. G.)»; el admin ve siempre los nombres.
//  3. «Guardar el historial de clientes por» 90 días, 180 días, 1 año
//     (por defecto) o siempre. Al vencer, los datos personales (nombre,
//     teléfono y nota) se ANONIMIZAN; la fila y sus cifras se quedan para las
//     estadísticas. Los datos de demostración no se tocan salvo que se elija.
//
// Sin nada de Next: lo usan las server actions de /admin, las API de
// estadísticas y del asistente, el servidor (una vez al día) y `verify:auth`.

import { and, eq, inArray, isNull, lt, notInArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { ACTIVE_WAITLIST_STATUSES, ROLES } from "@/lib/db/enums";
import { appSettings, tables, waitlistEntries } from "@/lib/db/schema";
import {
  ANONYMOUS_NAME,
  DEFAULT_PRIVACY_SETTINGS,
  RETENTION_OPTIONS,
  retentionDays,
  type PrivacySettings,
  type Retention,
  type RetentionRun,
} from "@/lib/settings/privacy-options";

export * from "@/lib/settings/privacy-options";

type Key = keyof PrivacySettings;
const KEYS: Record<Key, string> = {
  aiAliases: "privacidad:ia_alias",
  analyticsSeesTopNames: "privacidad:analitica_nombres_top",
  retention: "retencion:historial",
  retentionIncludesDemo: "retencion:incluye_demo",
};
const LAST_RUN_KEY = "retencion:ultima_ejecucion";

/**
 * Las opciones guardadas, con los valores por defecto donde no hay fila o la
 * fila no es válida (nunca se cae a una opción menos segura por un dato raro).
 */
export async function getPrivacySettings(): Promise<PrivacySettings> {
  const rows = await db.select().from(appSettings).where(inArray(appSettings.key, Object.values(KEYS)));
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const out: PrivacySettings = { ...DEFAULT_PRIVACY_SETTINGS };
  const bool = (key: Key) => {
    const raw = byKey.get(KEYS[key]);
    return raw === "true" ? true : raw === "false" ? false : (DEFAULT_PRIVACY_SETTINGS[key] as boolean);
  };
  out.aiAliases = bool("aiAliases");
  out.analyticsSeesTopNames = bool("analyticsSeesTopNames");
  out.retentionIncludesDemo = bool("retentionIncludesDemo");
  const retention = byKey.get(KEYS.retention);
  if ((RETENTION_OPTIONS as readonly string[]).includes(retention ?? "")) out.retention = retention as Retention;
  return out;
}

/** Guarda las opciones (las cuatro, ya validadas por quien llama). */
export async function savePrivacySettings(input: PrivacySettings, userId: string | null): Promise<void> {
  const now = new Date();
  const values = (Object.keys(KEYS) as Key[]).map((key) => ({
    key: KEYS[key],
    value: String(input[key]),
    updatedAt: now,
    updatedByUserId: userId,
  }));
  for (const row of values) {
    await db
      .insert(appSettings)
      .values(row)
      .onConflictDoUpdate({ target: appSettings.key, set: { value: row.value, updatedAt: row.updatedAt, updatedByUserId: row.updatedByUserId } });
  }
}

/** Desde cuándo se conservan los datos personales; null si se guardan siempre. */
export function retentionCutoff(retention: Retention, now: Date): Date | null {
  const days = retentionDays(retention);
  return days === null ? null : new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * Anonimiza los clientes que llegaron antes del corte de la retención.
 *
 * Reglas, todas en el mismo UPDATE (no hay lectura previa que pueda quedarse
 * vieja):
 *  - nunca borra filas: solo cambia el nombre a «Cliente anónimo» y vacía el
 *    teléfono y la nota. Personas, horas, estado, mesa y mesero se quedan, así
 *    que las estadísticas no cambian;
 *  - nunca toca a quien sigue en la fila (en espera o listo) ni a quien está
 *    sentado ahora en una mesa;
 *  - los datos de demostración (`is_demo`) solo si `retentionIncludesDemo`;
 *  - lo ya anonimizado no se vuelve a tocar: correrla dos veces da lo mismo.
 *
 * Devuelve cuántas filas anonimizó y deja apuntada la última ejecución.
 */
export async function anonymizeExpiredEntries(now = new Date(), settings?: PrivacySettings): Promise<RetentionRun> {
  const current = settings ?? (await getPrivacySettings());
  const cutoff = retentionCutoff(current.retention, now);
  let anonymized = 0;
  if (cutoff) {
    const seated = db.select({ id: tables.currentEntryId }).from(tables).where(sql`${tables.currentEntryId} is not null`);
    const result = await db
      .update(waitlistEntries)
      .set({ customerName: ANONYMOUS_NAME, phone: null, notes: null, anonymizedAt: now })
      .where(
        and(
          isNull(waitlistEntries.anonymizedAt),
          lt(waitlistEntries.arrivedAt, cutoff),
          notInArray(waitlistEntries.status, [...ACTIVE_WAITLIST_STATUSES]),
          notInArray(waitlistEntries.id, seated),
          current.retentionIncludesDemo ? undefined : eq(waitlistEntries.isDemo, false),
        ),
      );
    anonymized = result.rowsAffected;
  }
  const run: RetentionRun = { at: now.getTime(), anonymized, retention: current.retention, includesDemo: current.retentionIncludesDemo };
  await db
    .insert(appSettings)
    .values({ key: LAST_RUN_KEY, value: JSON.stringify(run), updatedAt: now, updatedByUserId: null })
    .onConflictDoUpdate({ target: appSettings.key, set: { value: JSON.stringify(run), updatedAt: now } });
  return run;
}

/** La última vez que corrió la retención (para enseñarlo en /admin), o null. */
export async function getLastRetentionRun(): Promise<RetentionRun | null> {
  const [row] = await db.select().from(appSettings).where(eq(appSettings.key, LAST_RUN_KEY));
  if (!row) return null;
  try {
    return JSON.parse(row.value) as RetentionRun;
  } catch {
    return null;
  }
}


/**
 * ¿Este usuario ve los nombres del top 10 de clientes? El admin, siempre; el
 * resto (analítica), solo si la dirección lo activó en «Configuración».
 */
export async function canSeeTopCustomerNames(user: { roles: readonly string[] }): Promise<boolean> {
  if (user.roles.includes(ROLES.ADMIN)) return true;
  return (await getPrivacySettings()).analyticsSeesTopNames;
}
