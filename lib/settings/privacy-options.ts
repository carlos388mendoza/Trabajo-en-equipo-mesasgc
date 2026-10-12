// Las opciones de privacidad (/admin → «Configuración»): valores, etiquetas,
// valores por defecto y el enmascarado del top 10. Sin base de datos: se puede
// importar desde el navegador (el formulario de /admin). Lo que lee y escribe
// la base está en `lib/settings/privacy.ts`.

import { z } from "zod";

export const RETENTION_OPTIONS = ["90d", "180d", "1y", "siempre"] as const;
export type Retention = (typeof RETENTION_OPTIONS)[number];

export const RETENTION_LABELS: Record<Retention, string> = {
  "90d": "90 días",
  "180d": "180 días",
  "1y": "1 año",
  siempre: "Siempre",
};

const RETENTION_DAYS: Record<Retention, number | null> = { "90d": 90, "180d": 180, "1y": 365, siempre: null };

/** Días que se guardan los datos personales; null si se guardan siempre. */
export function retentionDays(retention: Retention): number | null {
  return RETENTION_DAYS[retention];
}

/** Lo que se guarda en vez del nombre de un cliente anonimizado. */
export const ANONYMOUS_NAME = "Cliente anónimo";

export const privacySettingsSchema = z.object({
  aiAliases: z.boolean(),
  analyticsSeesTopNames: z.boolean(),
  retention: z.enum(RETENTION_OPTIONS),
  /** La retención también anonimiza los datos de demostración (`is_demo`). */
  retentionIncludesDemo: z.boolean(),
});
export type PrivacySettings = z.infer<typeof privacySettingsSchema>;

export const DEFAULT_PRIVACY_SETTINGS: PrivacySettings = {
  aiAliases: true,
  analyticsSeesTopNames: false,
  retention: "1y",
  retentionIncludesDemo: false,
};

export type RetentionRun = { at: number; anonymized: number; retention: Retention; includesDemo: boolean };

/** «Ana García» → «A. G.». Nada más: no es un dato que identifique solo. */
export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map((p) => `${p.charAt(0).toLocaleUpperCase("es-HN")}.`).join(" ");
}

/**
 * El top de clientes sin nombres: «Cliente 1 (A. G.)», en el mismo orden. Lo
 * ve analítica si la dirección no le deja ver los nombres. Se aplica en el
 * SERVIDOR, antes de responder y antes de hablar con la IA: ocultarlo en el
 * navegador no protegería nada.
 */
export function maskTopCustomers<T extends { name: string }>(customers: readonly T[]): T[] {
  return customers.map((customer, index) => ({ ...customer, name: `Cliente ${index + 1} (${initials(customer.name)})` }));
}
