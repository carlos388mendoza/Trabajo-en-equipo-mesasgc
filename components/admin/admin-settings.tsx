"use client";

// /admin → «Configuración»: las tres decisiones de privacidad de la dirección,
// con su valor por defecto seguro, y la retención del historial. Solo la ve el
// admin (la página entera es suya) y cada acción vuelve a comprobar
// «configuracion:gestionar» en el servidor (`app/admin/settings-actions.ts`).
//
// Las frases de cada opción son las mismas de `docs/configuracion.md`, que es
// lo que se le enseña a la dirección.

import { useState, useTransition } from "react";
import { CircleAlert, CircleCheck, Eraser, Save } from "lucide-react";

import { runRetentionNowAction, savePrivacySettingsAction, type SettingsResult } from "@/app/admin/settings-actions";
import { Button } from "@/components/admin/ui";
import { ICON_STROKE } from "@/components/editor/icons";
import {
  DEFAULT_PRIVACY_SETTINGS,
  RETENTION_LABELS,
  RETENTION_OPTIONS,
  type PrivacySettings,
  type RetentionRun,
} from "@/lib/settings/privacy-options";

type Props = { settings: PrivacySettings; lastRun: RetentionRun | null };

export function AdminSettings({ settings, lastRun }: Props) {
  const [draft, setDraft] = useState<PrivacySettings>(settings);
  const [feedback, setFeedback] = useState<SettingsResult | null>(null);
  const [pending, startTransition] = useTransition();
  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  const submit = (work: () => Promise<SettingsResult>) =>
    startTransition(async () => {
      setFeedback(await work());
    });

  const set = <K extends keyof PrivacySettings>(key: K, value: PrivacySettings[K]) => setDraft((d) => ({ ...d, [key]: value }));

  return (
    <section className="space-y-5 rounded-2xl border border-app-border bg-panel p-5 text-panel-text shadow-sm" aria-labelledby="configuracion-titulo">
      <div>
        <h2 id="configuracion-titulo" className="text-lg font-semibold">Configuración</h2>
        <p className="text-sm text-panel-muted">
          Privacidad de los clientes. Cada opción viene con el valor más seguro; cámbiala solo si la dirección lo decide.
        </p>
      </div>

      {feedback ? (
        <p
          role="status"
          className={`flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${
            feedback.ok ? "bg-estado-libre/10 text-estado-libre" : "bg-estado-ocupada/10 text-estado-ocupada"
          }`}
        >
          {feedback.ok ? <CircleCheck aria-hidden size={18} strokeWidth={ICON_STROKE} /> : <CircleAlert aria-hidden size={18} strokeWidth={ICON_STROKE} />}
          {feedback.ok ? feedback.message : feedback.error}
        </p>
      ) : null}

      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          submit(() => savePrivacySettingsAction(draft));
        }}
      >
        <Toggle
          id="cfg-ia-alias"
          checked={draft.aiAliases}
          onChange={(v) => set("aiAliases", v)}
          title="La IA usa alias en lugar de nombres de clientes"
          help="Activado: al asistente de IA le llegan «Cliente 1», «Cliente 2»… y nunca un nombre de cliente. Los nombres solo se ponen de vuelta en tu pantalla."
          byDefault={DEFAULT_PRIVACY_SETTINGS.aiAliases}
        />
        <Toggle
          id="cfg-analitica-nombres"
          checked={draft.analyticsSeesTopNames}
          onChange={(v) => set("analyticsSeesTopNames", v)}
          title="Analítica puede ver los nombres del top 10 de clientes"
          help="Desactivado: el rol analítica ve «Cliente 1 (A. G.)», con las iniciales. El administrador ve siempre los nombres."
          byDefault={DEFAULT_PRIVACY_SETTINGS.analyticsSeesTopNames}
        />

        <fieldset className="space-y-2 rounded-xl border border-app-border p-4">
          <legend className="px-1 text-sm font-semibold">Guardar el historial de clientes por</legend>
          <p className="text-sm text-panel-muted">
            Al vencer, el nombre pasa a «Cliente anónimo» y se borran el teléfono y la nota. Las cifras (personas, horas de
            llegada y de mesa, mesero) se quedan para las estadísticas. Nunca se toca a quien sigue en la fila o está en una
            mesa. Por defecto: {RETENTION_LABELS[DEFAULT_PRIVACY_SETTINGS.retention].toLowerCase()}.
          </p>
          <div role="radiogroup" aria-label="Guardar el historial de clientes por" className="flex flex-wrap gap-2">
            {RETENTION_OPTIONS.map((option) => (
              <label
                key={option}
                className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-xl border px-3.5 text-sm font-medium ${
                  draft.retention === option ? "border-accent bg-accent/10 text-panel-text" : "border-app-border text-panel-muted hover:bg-app-border/40"
                }`}
              >
                <input
                  type="radio"
                  name="retencion"
                  value={option}
                  checked={draft.retention === option}
                  onChange={() => set("retention", option)}
                  className="h-4 w-4 accent-[rgb(var(--c-accent))]"
                />
                {RETENTION_LABELS[option]}
              </label>
            ))}
          </div>
          <label className="flex min-h-11 items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.retentionIncludesDemo}
              onChange={(e) => set("retentionIncludesDemo", e.target.checked)}
              className="h-4 w-4 accent-[rgb(var(--c-accent))]"
            />
            Aplicar también a los datos de demostración (por defecto, no)
          </label>
        </fieldset>

        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-xs text-panel-muted">
            {lastRun
              ? `Última revisión del historial: ${new Date(lastRun.at).toLocaleString("es-HN", { timeZone: "America/Tegucigalpa" })} · ${lastRun.anonymized} cliente(s) anonimizado(s). Se revisa sola una vez al día.`
              : "El historial se revisa solo una vez al día."}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button icon={Eraser} onClick={() => submit(runRetentionNowAction)} disabled={pending || dirty} title={dirty ? "Guarda antes los cambios" : "Anonimizar ahora lo que ya venció"}>
              Aplicar ahora
            </Button>
            <button
              type="submit"
              disabled={pending || !dirty}
              className="flex h-11 items-center gap-1.5 rounded-xl bg-accent px-4 text-sm font-semibold text-accent-text hover:bg-accent/85 disabled:opacity-60"
            >
              <Save aria-hidden size={18} strokeWidth={ICON_STROKE} />
              {pending ? "Guardando…" : "Guardar configuración"}
            </button>
          </div>
        </div>
      </form>
    </section>
  );
}

function Toggle({
  id,
  checked,
  onChange,
  title,
  help,
  byDefault,
}: {
  id: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  title: string;
  help: string;
  byDefault: boolean;
}) {
  return (
    <div className="flex items-start justify-between gap-4 rounded-xl border border-app-border p-4">
      <div className="min-w-0">
        <label htmlFor={id} className="text-sm font-semibold">
          {title}
        </label>
        <p className="mt-1 text-sm text-panel-muted">
          {help} Por defecto: {byDefault ? "activado" : "desactivado"}.
        </p>
      </div>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={`relative mt-0.5 h-8 w-14 shrink-0 rounded-full transition ${checked ? "bg-accent" : "bg-app-border"}`}
      >
        <span className="sr-only">{checked ? "Activado" : "Desactivado"}</span>
        <span
          aria-hidden
          className={`absolute top-1 h-6 w-6 rounded-full bg-panel shadow transition-all ${checked ? "left-7" : "left-1"}`}
        />
      </button>
    </div>
  );
}
