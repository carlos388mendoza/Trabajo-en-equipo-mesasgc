"use client";

// Sección "Apariencia" de Ajustes: tema, colores personalizados, vista previa.
//
// Cada cambio se guarda al momento (no hay botón de guardar): así la vista
// previa y la app entera cambian a la vez que el selector de color.

import type { LucideIcon } from "lucide-react";
import { Monitor, Moon, Palette, RotateCcw, Sun, TriangleAlert } from "lucide-react";

import { ThemePreview } from "./theme-preview";
import { ICON_STROKE } from "@/components/editor/icons";
import {
  type CustomColors,
  DEFAULT_SETTING,
  type ThemeMode,
  contrastWarnings,
  resolveTheme,
} from "@/lib/theme/theme";
import { saveThemeSetting, useSystemDark, useThemeSetting } from "@/lib/theme/use-theme";

const MODES: { mode: ThemeMode; label: string; description: string; icon: LucideIcon }[] = [
  { mode: "claro", label: "Claro", description: "Fondo claro, como siempre.", icon: Sun },
  {
    mode: "oscuro",
    label: "Oscuro",
    description: "Azul marino, con estados más brillantes.",
    icon: Moon,
  },
  {
    mode: "sistema",
    label: "Sistema",
    description: "Sigue el modo claro u oscuro del dispositivo.",
    icon: Monitor,
  },
  {
    mode: "personalizado",
    label: "Personalizado",
    description: "Elige tú los colores del mapa.",
    icon: Palette,
  },
];

const CUSTOM_FIELDS: { key: keyof CustomColors; label: string; hint: string }[] = [
  { key: "mapBg", label: "Fondo del mapa", hint: "Detrás de las mesas." },
  { key: "line", label: "Líneas y paredes", hint: "Bordes del local y de las zonas." },
  { key: "accent", label: "Acento", hint: "Botones y selección." },
  { key: "panel", label: "Paneles", hint: "Barra, leyenda y minimapa." },
];

export function AppearanceSettings() {
  const setting = useThemeSetting();
  const systemDark = useSystemDark();
  const theme = resolveTheme(setting, systemDark);
  const warnings = setting.mode === "personalizado" ? contrastWarnings(theme) : [];

  const setMode = (mode: ThemeMode) => saveThemeSetting({ ...setting, mode });
  const setColor = (key: keyof CustomColors, value: string) =>
    saveThemeSetting({ mode: "personalizado", custom: { ...setting.custom, [key]: value } });

  return (
    <section aria-labelledby="apariencia" className="space-y-6">
      <div>
        <h2 id="apariencia" className="text-lg font-semibold">
          Apariencia
        </h2>
        <p className="text-sm text-panel-muted">
          Cómo se ven el mapa y los paneles. Se guarda en este navegador.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,24rem)]">
        <div className="space-y-6">
          {/* Tema */}
          <div role="radiogroup" aria-label="Tema" className="grid gap-3 sm:grid-cols-2">
            {MODES.map(({ mode, label, description, icon: Icon }) => {
              const active = setting.mode === mode;
              return (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  onClick={() => setMode(mode)}
                  className={`flex min-h-20 items-start gap-3 rounded-2xl border p-4 text-left transition active:scale-[0.99] ${
                    active
                      ? "border-accent bg-accent/10 ring-2 ring-accent"
                      : "border-app-border bg-panel hover:border-accent/50"
                  }`}
                >
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${
                      active ? "bg-accent text-accent-text" : "bg-app-border/60 text-panel-text"
                    }`}
                  >
                    <Icon aria-hidden size={22} strokeWidth={ICON_STROKE} />
                  </span>
                  <span>
                    <span className="block font-semibold">{label}</span>
                    <span className="block text-sm text-panel-muted">
                      {mode === "sistema" && active
                        ? `Ahora: ${systemDark ? "oscuro" : "claro"}, según tu dispositivo.`
                        : description}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          {/* Colores de Personalizado */}
          {setting.mode === "personalizado" ? (
            <div className="space-y-3 rounded-2xl border border-app-border bg-panel p-4">
              <p className="text-sm font-semibold">Colores</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {CUSTOM_FIELDS.map(({ key, label, hint }) => (
                  <label
                    key={key}
                    className="flex items-center gap-3 rounded-xl border border-app-border p-3"
                  >
                    <input
                      type="color"
                      value={setting.custom[key]}
                      onChange={(e) => setColor(key, e.target.value)}
                      className="h-11 w-14 shrink-0 cursor-pointer rounded-lg border border-app-border bg-transparent p-1"
                      aria-label={label}
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">{label}</span>
                      <span className="block text-xs text-panel-muted">
                        {hint} <span className="font-mono uppercase">{setting.custom[key]}</span>
                      </span>
                    </span>
                  </label>
                ))}
              </div>
              <p className="text-xs text-panel-muted">
                Los colores de Libre, Ocupada y Reservada se ajustan solos al fondo para
                que siempre se lean.
              </p>
            </div>
          ) : null}

          {warnings.length > 0 ? (
            <div
              role="status"
              className="flex gap-3 rounded-2xl border border-estado-ocupada/40 bg-estado-ocupada/10 p-4 text-sm"
            >
              <TriangleAlert
                aria-hidden
                size={20}
                strokeWidth={ICON_STROKE}
                className="mt-0.5 shrink-0 text-estado-ocupada"
              />
              <div>
                <p className="font-semibold">Contraste bajo</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-4">
                  {warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => saveThemeSetting(DEFAULT_SETTING)}
              className="flex h-11 items-center gap-2 rounded-xl border border-app-border bg-panel px-4 text-sm font-medium hover:bg-app-border/50"
            >
              <RotateCcw aria-hidden size={18} strokeWidth={ICON_STROKE} />
              Restablecer
            </button>
            <span className="text-xs text-panel-muted">
              Vuelve al tema Claro y a los colores de Personalizado por defecto.
            </span>
          </div>
        </div>

        {/* Vista previa */}
        <figure className="space-y-2 self-start lg:sticky lg:top-4">
          <ThemePreview theme={theme} />
          <figcaption className="text-xs text-panel-muted">
            Vista previa: cambia en vivo al elegir colores.
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
