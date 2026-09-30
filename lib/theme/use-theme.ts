"use client";

// El tema en el navegador: leer y guardar la elección, seguir el modo del
// sistema, y aplicar las variables CSS.
//
// Las dos fuentes (localStorage y `prefers-color-scheme`) se leen con
// `useSyncExternalStore`: así todos los componentes ven el mismo tema, y un
// cambio en Ajustes (o en otra pestaña) llega a todos a la vez.

import { useMemo, useSyncExternalStore } from "react";

import {
  DEFAULT_SETTING,
  THEME_STORAGE_KEY,
  type Theme,
  type ThemeSetting,
  parseStoredSetting,
  resolveTheme,
  serializeSetting,
  themeVars,
} from "./theme";

const CHANGE_EVENT = "tw-apariencia-change";
const DARK_QUERY = "(prefers-color-scheme: dark)";

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    // Modo privado estricto o almacenamiento bloqueado: tema por defecto.
    return null;
  }
}

function subscribeSetting(onChange: () => void): () => void {
  // `storage` solo salta en OTRAS pestañas; el evento propio cubre esta.
  window.addEventListener("storage", onChange);
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(CHANGE_EVENT, onChange);
  };
}

function subscribeSystem(onChange: () => void): () => void {
  const query = window.matchMedia(DARK_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Lo que el usuario eligió. En el servidor, lo de por defecto. */
export function useThemeSetting(): ThemeSetting {
  // El snapshot es el texto guardado (un string se compara por valor), y se
  // interpreta aparte: un objeto nuevo en cada lectura haría re-render sin fin.
  const raw = useSyncExternalStore(subscribeSetting, readRaw, () => null);
  return useMemo(() => (raw === null ? DEFAULT_SETTING : parseStoredSetting(raw)), [raw]);
}

/** ¿El sistema (Windows, móvil, tablet) está en modo oscuro? */
export function useSystemDark(): boolean {
  return useSyncExternalStore(
    subscribeSystem,
    () => window.matchMedia(DARK_QUERY).matches,
    () => false,
  );
}

/** El tema que se ve ahora mismo, con todos sus colores. */
export function useResolvedTheme(): Theme {
  const setting = useThemeSetting();
  const systemDark = useSystemDark();
  return useMemo(() => resolveTheme(setting, systemDark), [setting, systemDark]);
}

/**
 * El tema actual leído directamente de las fuentes, sin pasar por React.
 *
 * Durante la hidratación los hooks devuelven primero el valor del servidor
 * (Claro); aplicar ese valor pintaría un destello claro antes del bueno.
 */
export function currentTheme(): Theme {
  return resolveTheme(parseStoredSetting(readRaw()), window.matchMedia(DARK_QUERY).matches);
}

export function saveThemeSetting(setting: ThemeSetting): void {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, serializeSetting(setting));
  } catch {
    // Sin almacenamiento el cambio vale para esta visita y ya.
  }
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

/** Pone las variables CSS del tema en `<html>`. */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(themeVars(theme))) {
    root.style.setProperty(name, value);
  }
  root.dataset.theme = theme.name;
  // Para que los controles nativos (selects, selectores de color, barras de
  // desplazamiento) usen su versión oscura.
  root.style.colorScheme = theme.dark ? "dark" : "light";
}
