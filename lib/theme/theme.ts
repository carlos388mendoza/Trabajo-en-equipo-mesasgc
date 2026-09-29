// Tema de la app: el ÚNICO sitio donde se definen colores.
//
// Todo sale de aquí por dos caminos, con los mismos valores:
//
//  - La interfaz (Tailwind) usa variables CSS (`--c-panel`, `--c-accent`...).
//    `tailwind.config.ts` solo dice qué variable usa cada nombre de clase; los
//    valores los pone `applyTheme` (o el script de arranque del layout, que se
//    genera a partir de este archivo).
//  - El lienzo de Konva no puede leer clases, así que recibe el objeto `Theme`
//    directamente (ver `useResolvedTheme`).
//
// Este archivo no importa nada de React ni del navegador: lo usan el servidor
// (para generar el script), el cliente y los scripts de verificación.

export type ThemeMode = "claro" | "oscuro" | "sistema" | "personalizado";

export const THEME_MODES: readonly ThemeMode[] = ["claro", "oscuro", "sistema", "personalizado"];

/** Lo que el usuario elige en Personalizado. Todo lo demás se deriva. */
export type CustomColors = {
  /** Fondo del mapa. */
  mapBg: string;
  /** Líneas, paredes y bordes de las zonas. */
  line: string;
  /** Botones y selección. */
  accent: string;
  /** Paneles flotantes (barra, leyenda, minimapa). */
  panel: string;
};

export type ThemeSetting = { mode: ThemeMode; custom: CustomColors };

export type StatusKey = "libre" | "ocupada" | "reservada";

export type StatusTone = {
  /** Borde y marcador: el color "del estado". */
  stroke: string;
  /** Relleno translúcido del cuerpo. */
  fill: string;
  /** Sillas y bancos. */
  seat: string;
  /** Texto que se lee encima de `stroke` (la etiqueta del cliente). */
  onStroke: string;
};

/** Todos los colores, ya resueltos (hex o rgba). */
export type Theme = {
  name: "claro" | "oscuro" | "personalizado";
  dark: boolean;
  appBg: string;
  appText: string;
  appMuted: string;
  border: string;
  panel: string;
  panelText: string;
  panelMuted: string;
  mapBg: string;
  grid: string;
  gridMajor: string;
  line: string;
  /** Brillo suave de líneas y marcadores. */
  glow: string;
  accent: string;
  accentText: string;
  status: Record<StatusKey, StatusTone>;
  /** Alerta de espera del mapa general: más de 20 min (alerta) y de 40 (crítica). */
  alert: Record<AlertKey, string>;
};

export type AlertKey = "alerta" | "critica";

// ---------------------------------------------------------------------------
// Utilidades de color
// ---------------------------------------------------------------------------

export function normalizeHex(hex: string): string {
  const clean = hex.trim().replace("#", "");
  const full =
    clean.length === 3
      ? clean
          .split("")
          .map((c) => c + c)
          .join("")
      : clean;
  const valid = /^[0-9a-fA-F]{6}$/.test(full) ? full : "000000";
  return `#${valid.toLowerCase()}`;
}

export function isHex(value: unknown): value is string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
}

function rgb(hex: string): [number, number, number] {
  const n = parseInt(normalizeHex(hex).slice(1), 16);
  return [(n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
}

function toHex([r, g, b]: [number, number, number]): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return `#${((c(r) << 16) | (c(g) << 8) | c(b)).toString(16).padStart(6, "0")}`;
}

/** `amount` de `b` sobre `a` (0 = a, 1 = b). */
export function mix(a: string, b: string, amount: number): string {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  return toHex([ar + (br - ar) * amount, ag + (bg - ag) * amount, ab + (bb - ab) * amount]);
}

export function withAlpha(hex: string, alpha: number): string {
  const [r, g, b] = rgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/** Luminancia relativa (WCAG 2.x). */
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Contraste WCAG entre dos colores: de 1 (igual) a 21 (negro sobre blanco). */
export function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const INK = "#0f172a";
const PAPER = "#f8fafc";

/** Texto oscuro o claro, el que más se lea sobre `bg`. */
export function readableOn(bg: string): string {
  return contrast(bg, INK) >= contrast(bg, PAPER) ? INK : PAPER;
}

function isDarkColor(bg: string): boolean {
  return readableOn(bg) === PAPER;
}

// ---------------------------------------------------------------------------
// Colores de estado
//
// No los elige el usuario: se ajustan solos al fondo. Sobre fondo claro, tonos
// medios (verde 600, rojo 600); sobre fondo oscuro, los mismos tonos más
// brillantes (verde 400, rojo 400), que es lo que hace que se lean de noche.
// ---------------------------------------------------------------------------

function tone(stroke: string, fillAlpha: number): StatusTone {
  return {
    stroke,
    fill: withAlpha(stroke, fillAlpha),
    seat: withAlpha(stroke, 0.5),
    onStroke: readableOn(stroke),
  };
}

function statusFor(dark: boolean): Record<StatusKey, StatusTone> {
  return dark
    ? {
        libre: tone("#4ade80", 0.2),
        ocupada: tone("#f87171", 0.26),
        reservada: tone("#94a3b8", 0.2),
      }
    : {
        libre: tone("#16a34a", 0.16),
        ocupada: tone("#dc2626", 0.2),
        reservada: tone("#64748b", 0.16),
      };
}

/**
 * Amarillo y rojo de la alerta de espera. Igual que los estados, no los elige
 * el usuario: tonos 600 sobre fondo claro y 400 sobre oscuro. El mapa no se
 * fía solo del color: la alerta también cambia de forma (anillo más grueso e
 * ícono).
 */
function alertFor(dark: boolean): Record<AlertKey, string> {
  return dark ? { alerta: "#facc15", critica: "#f87171" } : { alerta: "#ca8a04", critica: "#dc2626" };
}

// ---------------------------------------------------------------------------
// Temas
// ---------------------------------------------------------------------------

export const LIGHT_THEME: Theme = {
  name: "claro",
  dark: false,
  appBg: "#f1f5f9",
  appText: "#0f172a",
  appMuted: "#64748b",
  border: "#e2e8f0",
  panel: "#ffffff",
  panelText: "#0f172a",
  panelMuted: "#64748b",
  mapBg: "#f8fafc",
  grid: "#e9eff6",
  gridMajor: "#d6e0ec",
  line: "#334155",
  glow: "#94a3b8",
  accent: "#2563eb",
  accentText: "#ffffff",
  status: statusFor(false),
  alert: alertFor(false),
};

export const DARK_THEME: Theme = {
  name: "oscuro",
  dark: true,
  appBg: "#060c18",
  appText: "#e2e8f0",
  appMuted: "#8b9bb4",
  border: "#1f2c47",
  panel: "#0f1a2f",
  panelText: "#e2e8f0",
  panelMuted: "#8b9bb4",
  mapBg: "#0a1428",
  grid: "#122039",
  gridMajor: "#1b2e50",
  line: "#7dd3fc",
  glow: "#38bdf8",
  accent: "#38bdf8",
  accentText: "#04111f",
  status: statusFor(true),
  alert: alertFor(true),
};

/** Los colores con los que arranca Personalizado y a los que vuelve "Restablecer". */
export const DEFAULT_CUSTOM: CustomColors = {
  mapBg: "#0d1b2a",
  line: "#5eead4",
  accent: "#f59e0b",
  // 1,4:1 contra el fondo: sigue siendo oscuro, pero los paneles se separan
  // del mapa. Con #13263b (1,13:1) la propia paleta de fábrica daba aviso.
  panel: "#1b3553",
};

export const DEFAULT_SETTING: ThemeSetting = { mode: "claro", custom: DEFAULT_CUSTOM };

/** Tema completo a partir de los cuatro colores de Personalizado. */
export function customTheme(c: CustomColors): Theme {
  const mapBg = normalizeHex(c.mapBg);
  const line = normalizeHex(c.line);
  const accent = normalizeHex(c.accent);
  const panel = normalizeHex(c.panel);
  const dark = isDarkColor(mapBg);
  const appText = readableOn(mapBg);
  const panelText = readableOn(panel);
  return {
    name: "personalizado",
    dark,
    appBg: mix(mapBg, dark ? "#000000" : "#ffffff", 0.35),
    appText,
    appMuted: mix(appText, mapBg, 0.4),
    border: mix(panel, panelText, 0.16),
    panel,
    panelText,
    panelMuted: mix(panelText, panel, 0.4),
    mapBg,
    grid: mix(mapBg, line, 0.09),
    gridMajor: mix(mapBg, line, 0.18),
    line,
    glow: line,
    accent,
    accentText: readableOn(accent),
    status: statusFor(dark),
    alert: alertFor(dark),
  };
}

/** El tema que se ve, según lo elegido y el modo del sistema. */
export function resolveTheme(setting: ThemeSetting, systemDark: boolean): Theme {
  switch (setting.mode) {
    case "oscuro":
      return DARK_THEME;
    case "sistema":
      return systemDark ? DARK_THEME : LIGHT_THEME;
    case "personalizado":
      return customTheme(setting.custom);
    default:
      return LIGHT_THEME;
  }
}

// ---------------------------------------------------------------------------
// Avisos de contraste (Personalizado)
// ---------------------------------------------------------------------------

/**
 * 3:1 es el mínimo de WCAG para elementos gráficos (bordes, marcadores): por
 * debajo, una mesa se confunde con el fondo.
 */
export const MIN_GRAPHIC_CONTRAST = 3;

export function contrastWarnings(theme: Theme): string[] {
  const warnings: string[] = [];
  const low = (a: string, b: string) => contrast(a, b) < MIN_GRAPHIC_CONTRAST;
  if (low(theme.line, theme.mapBg)) {
    warnings.push("Las líneas y paredes casi no se distinguen del fondo del mapa.");
  }
  if (low(theme.accent, theme.mapBg)) {
    warnings.push("El color de acento se ve poco sobre el mapa: costará ver qué está seleccionado.");
  }
  if (low(theme.accent, theme.panel)) {
    warnings.push("El color de acento se ve poco sobre los paneles.");
  }
  const labels: Record<StatusKey, string> = { libre: "Libre", ocupada: "Ocupada", reservada: "Reservada" };
  for (const key of Object.keys(labels) as StatusKey[]) {
    if (low(theme.status[key].stroke, theme.mapBg)) {
      warnings.push(`El estado «${labels[key]}» se lee poco sobre este fondo.`);
    }
  }
  if (low(theme.panel, theme.mapBg) && contrast(theme.panel, theme.mapBg) < 1.15) {
    warnings.push("Los paneles son casi del mismo color que el mapa y no se distinguirán.");
  }
  return warnings;
}

// ---------------------------------------------------------------------------
// Variables CSS
// ---------------------------------------------------------------------------

/**
 * Qué variable CSS lleva cada color. Van como "r g b" para que Tailwind pueda
 * añadir transparencia (`bg-panel/80`).
 */
export function themeVars(theme: Theme): Record<string, string> {
  const t = (hex: string) => rgb(hex).join(" ");
  return {
    "--c-app-bg": t(theme.appBg),
    "--c-app-text": t(theme.appText),
    "--c-app-muted": t(theme.appMuted),
    "--c-border": t(theme.border),
    "--c-panel": t(theme.panel),
    "--c-panel-text": t(theme.panelText),
    "--c-panel-muted": t(theme.panelMuted),
    "--c-map-bg": t(theme.mapBg),
    "--c-grid": t(theme.grid),
    "--c-line": t(theme.line),
    "--c-accent": t(theme.accent),
    "--c-accent-text": t(theme.accentText),
    "--c-libre": t(theme.status.libre.stroke),
    "--c-ocupada": t(theme.status.ocupada.stroke),
    "--c-reservada": t(theme.status.reservada.stroke),
    "--c-alerta": t(theme.alert.alerta),
    "--c-critica": t(theme.alert.critica),
  };
}

// ---------------------------------------------------------------------------
// Guardado (navegador)
//
// TODO (Better Auth): guardar la preferencia por usuario (una columna o tabla
// de preferencias) y usar localStorage solo como caché para el arranque. Hoy
// vive solo en este navegador. Coordinarlo con quien lleva el esquema: no se
// ha tocado `lib/db/schema.ts`.
// ---------------------------------------------------------------------------

export const THEME_STORAGE_KEY = "tw-apariencia";

type Stored = ThemeSetting & {
  /**
   * Variables ya resueltas de Personalizado. Las guarda quien elige el tema
   * para que el script de arranque no tenga que saber derivar colores.
   */
  vars?: Record<string, string>;
  /** Si Personalizado es oscuro: fija `color-scheme` (controles del navegador). */
  dark?: boolean;
};

/** Lee lo guardado y lo valida: un valor roto vuelve a lo de por defecto. */
export function parseStoredSetting(raw: string | null): ThemeSetting {
  if (!raw) return DEFAULT_SETTING;
  try {
    const data = JSON.parse(raw) as Partial<Stored>;
    const mode = THEME_MODES.includes(data.mode as ThemeMode)
      ? (data.mode as ThemeMode)
      : DEFAULT_SETTING.mode;
    const c = (data.custom ?? {}) as Partial<CustomColors>;
    const pick = (k: keyof CustomColors) => (isHex(c[k]) ? c[k] : DEFAULT_CUSTOM[k]);
    return {
      mode,
      custom: { mapBg: pick("mapBg"), line: pick("line"), accent: pick("accent"), panel: pick("panel") },
    };
  } catch {
    return DEFAULT_SETTING;
  }
}

export function serializeSetting(setting: ThemeSetting): string {
  const custom = setting.mode === "personalizado" ? customTheme(setting.custom) : null;
  const stored: Stored = {
    ...setting,
    vars: custom ? themeVars(custom) : undefined,
    dark: custom ? custom.dark : undefined,
  };
  return JSON.stringify(stored);
}

/**
 * Las variables de Claro como regla `:root`. Es el respaldo si el script de
 * arranque fallara: sin él, la página se quedaría sin colores.
 */
export function themeFallbackCss(): string {
  const body = Object.entries(themeVars(LIGHT_THEME))
    .map(([k, v]) => `${k}:${v}`)
    .join(";");
  return `:root{${body}}`;
}

/**
 * Script que va en el `<head>` y aplica el tema ANTES del primer pintado, para
 * que al recargar no se vea un destello del tema claro. Se genera desde aquí:
 * los temas Claro y Oscuro viajan dentro como datos.
 */
export function themeBootScript(): string {
  const presets = JSON.stringify({ claro: themeVars(LIGHT_THEME), oscuro: themeVars(DARK_THEME) });
  return (
    `(function(){try{var P=${presets},v,n="claro",d=false,` +
    `s=JSON.parse(localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})||"null")||{};` +
    `var m=s.mode||"claro";` +
    `if(m==="personalizado"&&s.vars){v=s.vars;n="personalizado";}` +
    `else{if(m==="sistema")m=matchMedia("(prefers-color-scheme: dark)").matches?"oscuro":"claro";` +
    `if(m!=="oscuro")m="claro";v=P[m];n=m;}` +
    `var e=document.documentElement;for(var k in v)e.style.setProperty(k,v[k]);` +
    `d=n==="oscuro"||(n==="personalizado"&&s.dark===true);` +
    `e.dataset.theme=n;e.style.colorScheme=d?"dark":"light";}catch(x){}})()`
  );
}
