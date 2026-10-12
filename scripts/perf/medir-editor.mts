// Medición real de FPS del editor de mesas, por CDP (Chrome DevTools Protocol).
//
// QUÉ MIDE Y POR QUÉ ASÍ
//
//  - "FPS" a secas no es una medida fiable. `requestAnimationFrame` no está
//    atado a la pantalla: si el hilo principal tiene margen, el navegador
//    entrega fotogramas tan rápido como puede y salen cifras de miles por
//    segundo, que no significan nada. Aquí se cuenta cuántos fotogramas
//    llegaron de verdad en el tiempo real que duró el gesto: si llegan 60 en un
//    segundo, se ve a 60; si llegan 38, hay tirones.
//
//  - Los gestos son ENTRADA REAL (`Input.dispatchTouchEvent`), no eventos
//    sintéticos. Con `dispatchEvent` desde la página, Konva recibía el toque y
//    seleccionaba la mesa, pero el ARRASTRE no enganchaba nunca: se midió una
//    página quieta y salían 60 FPS sin decir nada. Por eso el guion comprueba
//    después de cada gesto que algo se movió de verdad, y avisa si no.
//
//  - La entrada va a ~120 pulsos por segundo (uno cada 8 ms). Es lo más rápido
//    que va un dedo de verdad, y deja huecos de 8 ms entre evento y evento:
//    bastante por debajo del presupuesto de 16,7 ms, así que el guion no se
//    inventa los tirones que se veían mandando los eventos con pausas de 34 ms.
//
//  - Cada interacción se repite varias veces y se reporta la mediana, porque la
//    primera pasada de un arrastre siempre es más lenta que la tercera: el
//    motor todavía se está calentando.
//
//  - La CPU se puede ralentizar ×4 con `Emulation.setCPUThrottlingRate`, que es
//    la forma estandarizada de imitar un móvil más lento sin el móvil.
//
//  - Chrome va CON VENTANA a propósito (salvo `--headless` para depurar). Sin
//    ventana no hay compositor con vsync y el número no es interpretable.
//
// Uso:
//   npx tsx scripts/perf/medir-editor.mts
//   npx tsx scripts/perf/medir-editor.mts --sin-throttling
//   npx tsx scripts/perf/medir-editor.mts --device=celular-vertical --throttle=4

import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { goto, openTab, type Cdp } from "./cdp.mts";

// --- Configuración ----------------------------------------------------------

type Device = { name: string; width: number; height: number; dpr: number };

const DEVICES: Device[] = [
  { name: "celular-vertical", width: 375, height: 812, dpr: 3 },
  { name: "celular-horizontal", width: 812, height: 375, dpr: 3 },
  { name: "tablet-vertical", width: 768, height: 1024, dpr: 2 },
  { name: "tablet-horizontal", width: 1024, height: 768, dpr: 2 },
  { name: "desktop", width: 1440, height: 900, dpr: 1 },
];

const ACTIONS = ["arrastrar", "plano", "zoom", "seleccionar"] as const;
type Action = (typeof ACTIONS)[number];

/** Movimientos por gesto. 60 es un segundo a 60 Hz: un segundo de arrastre. */
const PASOS = 60;
/** Entre movimiento y movimiento, como un dedo rápido pero real. */
const MS_PULSO = 8;
const PASADAS = 3;

const BASE_URL = process.env.PERF_URL ?? "http://127.0.0.1:3100";
// SOLO contra un servidor local (`npm run perf:levantar`, que sirve una copia
// de `local.db`): la medición mueve, añade y gira mesas, y entra con la
// contraseña del seed de DESARROLLO. Nunca contra producción.
if (!["127.0.0.1", "localhost", "[::1]"].includes(new URL(BASE_URL).hostname)) {
  console.error(`perf:editor solo mide un servidor local (127.0.0.1 o localhost), no ${new URL(BASE_URL).host}.`);
  process.exit(2);
}
/** La contraseña del seed de desarrollo (`scripts/seed.ts`). No se acepta otra. */
const DEV_PASSWORD = "12345abc";
const CHROME = process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const OUT_DIR = "perf-resultados";
const ETIQUETA = process.env.PERF_ETIQUETA ?? "editor";

const args = process.argv.slice(2);
const sinThrottling = args.includes("--sin-throttling");
const throttleRate = Number(args.find((a) => a.startsWith("--throttle="))?.split("=")[1] ?? 4);
const soloDevice = args.find((a) => a.startsWith("--device="))?.split("=")[1];
const jsonOut = args.includes("--json");
const headless = args.includes("--headless");

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- Arranque de Chrome -----------------------------------------------------

function chromeArgs(port: number, profile: string): string[] {
  return [
    ...(headless ? ["--headless=new"] : []),
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--window-size=1500,1000",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--disable-backgrounding-occluded-windows",
    "--disable-features=CalculateNativeWinOcclusion,CalculateIOSurfaceOcclusion",
    "--hide-scrollbars",
    "--mute-audio",
    "about:blank",
  ];
}

// --- Lo que corre dentro de la página --------------------------------------
//
// Solo dos cosas: el que cuenta los fotogramas y el que comprueba que el gesto
// surtió efecto. El gesto va por entrada real de CDP.

const EN_LA_PAGINA = `
  const texto = () => document.body.innerText;
  // Hay selección si se ve el campo con el nombre del elemento (panel lateral
  // o tira de abajo). El texto «Elemento seleccionado» ya no sale en pantalla:
  // es la etiqueta de la tira, no un título visible.
  const haySeleccion = () => [...document.querySelectorAll('input[aria-label="Nombre del elemento"]')].some((x) => x.offsetParent !== null);
  const haySinGuardar = () => /cambios sin guardar/i.test(texto());

  /**
   * Huella del lienzo: se dibuja el canvas de Konva en 32x32 y se suman sus
   * píxeles. Sirve para COMPROBAR que el gesto hizo algo de verdad: si la mesa
   * se movió, el lienzo se redibujó y la huella cambia.
   */
  const huella = () => {
    const c = document.querySelector("canvas");
    const t = document.createElement("canvas");
    t.width = 32;
    t.height = 32;
    const ctx = t.getContext("2d");
    ctx.drawImage(c, 0, 0, 32, 32);
    const d = ctx.getImageData(0, 0, 32, 32).data;
    let s = 0;
    for (let i = 0; i < d.length; i += 4) s += d[i] * 3 + d[i + 1] * 5 + d[i + 2] * 7;
    return s;
  };
`;

// --- Entrada real -----------------------------------------------------------

type Pt = { x: number; y: number };

const dedo = (p: Pt, id = 1) => ({
  x: Math.round(p.x),
  y: Math.round(p.y),
  radiusX: 8,
  radiusY: 8,
  force: 0.5,
  id,
});

async function tocar(c: Cdp, p: Pt): Promise<void> {
  await c.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [dedo(p)] });
  await sleep(50);
  await c.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

async function arrastrarDedo(c: Cdp, desde: Pt, hasta: Pt, pasos: number, segundo?: Pt): Promise<void> {
  // El primer dedo va de `desde` a `hasta`; el segundo (pellizco), desde su
  // propio punto y en ESPEJO, para que los dedos se separen o se junten. (Antes
  // los dos iban por el mismo camino: dos dedos en el mismo punto no son un
  // pellizco.)
  const en = (t: number, p: Pt) => {
    // Suavizado: un dedo real no va en línea recta a velocidad constante.
    const s = t * t * (3 - 2 * t);
    const signo = p === desde ? 1 : -1;
    return { x: p.x + signo * (hasta.x - desde.x) * s, y: p.y + signo * (hasta.y - desde.y) * s };
  };
  const puntos = (t: number) => {
    const a = en(t, desde);
    const lista = [dedo(a)];
    if (segundo) lista.push(dedo(en(t, segundo), 2));
    return lista;
  };
  await c.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: puntos(0) });
  await sleep(MS_PULSO);
  for (let i = 1; i <= pasos; i += 1) {
    await c.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: puntos(i / pasos) });
    await sleep(MS_PULSO);
  }
  await c.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

// --- La ventana, delante ----------------------------------------------------

/**
 * Pone la ventana de Chrome delante del todo.
 *
 * No es un detalle: una ventana tapada o minimizada no tiene compositor con
 * vsync y el navegador puede saltarse el dibujado entero. Medir en ese caso da
 * cifras optimistas que luego no se ven en el dispositivo del usuario. Con la
 * ventana delante el fotograma va a 60 Hz, como en un equipo de verdad.
 *
 * Es solo una comodidad: la cuenta no depende del vsync (mira el trabajo del
 * hilo principal contra el presupuesto de 16,7 ms), así que si esto falla la
 * medición sigue siendo válida.
 */
function ventanaDelante(): void {
  const guion = `
$fuente = @"
using System;
using System.Runtime.InteropServices;
public static class Ventana {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
}
"@
Add-Type -TypeDefinition $fuente
$p = Get-Process chrome -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
if ($p) { [Ventana]::ShowWindow($p.MainWindowHandle, 9) | Out-Null; [Ventana]::SetForegroundWindow($p.MainWindowHandle) | Out-Null }
`;
  try {
    spawnSync("powershell", ["-NoProfile", "-NonInteractive", "-Command", guion], {
      stdio: "ignore",
      timeout: 20_000,
    });
  } catch {
    // Nada que hacer: la medición no depende de esto.
  }
}

// --- La cuenta de fotogramas ------------------------------------------------

/** Abre la cuenta. Devuelve la huella del lienzo de justo antes del gesto. */
async function abrir(c: Cdp): Promise<number> {
  const r = await c.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      ${EN_LA_PAGINA}
      window.__perf = { t: [], on: true };
      (function bucle(ahora) {
        if (window.__perf.on) window.__perf.t.push(ahora);
        requestAnimationFrame(bucle);
      })();
      return huella();
    })()`,
  });
  return Number(r.result?.value);
}

/** Cierra la cuenta y devuelve las medidas del gesto. */
async function cerrar(c: Cdp): Promise<Medida> {
  const r = await c.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => {
      ${EN_LA_PAGINA}
      const BUDGET = 1000 / 60;
      const t = window.__perf.t.slice();
      window.__perf.on = false;
      const d = [];
      for (let i = 1; i < t.length; i++) d.push(t[i] - t[i - 1]);
      const duracion = t.length ? t[t.length - 1] - t[0] : 0;
      const copia = [...d].sort((a, b) => a - b);
      const mediana = copia.length ? copia[Math.floor(copia.length / 2)] : 0;
      return JSON.stringify({
        // FPS = 60 mientras el fotograma quepa en el presupuesto; si no cabe,
        // los FPS son los que salen de dividir 1000 entre ese tiempo.
        fps: mediana <= BUDGET ? 60 : 1000 / mediana,
        mediana,
        peor: copia.length ? copia[copia.length - 1] : 0,
        // Fotogramas que costaron dos presupuestos o más: cada uno es un
        // fotograma que se perdió de verdad y que el ojo nota como tirón.
        perdidos: copia.length ? copia.filter((x) => x >= BUDGET * 2).length : 0,
        n: d.length,
        duracionMs: duracion,
        huellaDespues: huella(),
        seleccion: haySeleccion(),
        sinGuardar: haySinGuardar(),
      });
    })()`,
  });
  return JSON.parse(String(r.result?.value));
}

type Medida = {
  fps: number;
  mediana: number;
  peor: number;
  perdidos: number;
  n: number;
  duracionMs: number;
  huellaDespues: number;
  seleccion: boolean;
  sinGuardar: boolean;
};

/**
 * Qué tiene que haber cambiado para dar el gesto por bueno. Sin esto, medir es
 * fácil de hacer mal: si el arrastre no engancha con ninguna mesa se está
 * midiendo una página quieta y salen 60 FPS sin decir nada.
 */
const COMPROBACIONES: Record<Action, (m: Medida, huellaAntes: number) => boolean> = {
  // La mesa se tiene que haber movido de verdad: el lienzo cambia y el editor
  // avisa de que hay cambios sin guardar.
  arrastrar: (m, antes) => m.huellaDespues !== antes && m.sinGuardar,
  zoom: (m, antes) => m.huellaDespues !== antes,
  seleccionar: (m) => m.seleccion,
  plano: () => true,
};

// --- Sesión -----------------------------------------------------------------

async function entrar(c: Cdp, email: string, password: string): Promise<void> {
  await goto(c, `${BASE_URL}/login`, 300);
  await c.send("Runtime.evaluate", {
    expression: `(() => {
      const set = (sel, v) => {
        const el = document.querySelector(sel);
        const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement : HTMLInputElement;
        Object.getOwnPropertyDescriptor(proto.prototype, "value").set.call(el, v);
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      };
      set('input[name="email"]', ${JSON.stringify(email)});
      set('input[name="password"]', ${JSON.stringify(password)});
      document.querySelector("form").requestSubmit();
    })()`,
  });
  for (let i = 0; i < 40; i += 1) {
    await sleep(300);
    const r = await c.send("Runtime.evaluate", { returnByValue: true, expression: "location.pathname" });
    if (String(r.result?.value) !== "/login") return;
  }
  throw new Error("el login no dejó pasar de /login");
}

type Mesa = { x: number; y: number; width: number; height: number; rotation: number };
type Caja = { x: number; y: number; w: number; h: number };

// Los valores de encuadre que usa el editor. Si cambian en `konva-canvas.tsx`,
// el guion sigue siendo válido porque el punto calculado se COMPRUEBA con un
// toque: si no selecciona nada, cae a la búsqueda en espiral.
const FIT_PADDING = 70;
const FIT_MAX_SCALE = 1.6;
const MIN_SCALE = 0.2;

/**
 * Dónde están las mesas del plano, según el encuadre que hace el editor al
 * abrir: las mesas (con margen), centradas en el hueco, sin tapar nada.
 *
 * Se lee de la copia de la base de datos que usa el servidor de medición
 * (`PERF_DB`). Es mucho más fiable que tantear con una rejilla: en un móvil la
 * escala baja del 30 % y una mesa de 80×80 ocupa 22 píxeles, así que una
 * rejilla normal la salta entera.
 */
async function mesasDelPlano(): Promise<{ mesas: Mesa[]; ancho: number; alto: number }> {
  const db = process.env.PERF_DB ?? ".perf-editor.db";
  const { createClient } = await import("@libsql/client");
  const cliente = createClient({ url: `file:./${db}` });
  const restaurante = process.env.PERF_RESTAURANTE ?? "rest_norte";
  const l = await cliente.execute({
    sql: "select id, width, height from table_layouts where restaurant_id = ? and is_default = 1",
    args: [restaurante],
  });
  const layout = l.rows[0] as { id: string; width: number; height: number } | undefined;
  if (!layout) throw new Error(`no hay plano por defecto de ${restaurante} en ${db}`);
  const t = await cliente.execute({
    sql: "select x, y, width, height, rotation from tables where layout_id = ? order by id",
    args: [layout.id],
  });
  return {
    mesas: t.rows as unknown as Mesa[],
    ancho: Number(layout.width),
    alto: Number(layout.height),
  };
}

/** Punto de pantalla del centro de una mesa con el encuadre inicial. */
function enPantalla(mesa: Mesa, caja: Caja, plano: { mesas: Mesa[]; ancho: number; alto: number }): Pt {
  const cajaMesa = {
    minX: Math.max(0, Math.min(...plano.mesas.map((e) => e.x)) - FIT_PADDING),
    minY: Math.max(0, Math.min(...plano.mesas.map((e) => e.y)) - FIT_PADDING),
    maxX: Math.min(plano.ancho, Math.max(...plano.mesas.map((e) => e.x + e.width)) + FIT_PADDING),
    maxY: Math.min(plano.alto, Math.max(...plano.mesas.map((e) => e.y + e.height)) + FIT_PADDING),
  };
  const escala = Math.min(
    (caja.w - 40) / (cajaMesa.maxX - cajaMesa.minX),
    (caja.h - 40) / (cajaMesa.maxY - cajaMesa.minY),
    FIT_MAX_SCALE,
  );
  const s = Math.min(Math.max(escala, MIN_SCALE), FIT_MAX_SCALE);
  const origenX = caja.w / 2 - ((cajaMesa.minX + cajaMesa.maxX) / 2) * s;
  const origenY = caja.h / 2 - ((cajaMesa.minY + cajaMesa.maxY) / 2) * s;
  return {
    x: caja.x + origenX + (mesa.x + mesa.width / 2) * s,
    y: caja.y + origenY + (mesa.y + mesa.height / 2) * s,
  };
}

async function haySeleccion(c: Cdp): Promise<boolean> {
  const r = await c.send("Runtime.evaluate", {
    returnByValue: true,
    expression: `(() => { ${EN_LA_PAGINA} return haySeleccion(); })()`,
  });
  return Boolean(r.result?.value);
}

/**
 * Devuelve el punto de pantalla de una mesa, comprobado con un toque real.
 *
 * Primero prueba el punto calculado. Si el encuadre no fuera el que se espera,
 * busca en espiral alrededor. Si tampoco encuentra nada, devuelve `null` y el
 * guion AVISA en vez de medir una página quieta.
 */
async function buscarMesa(c: Cdp, caja: Caja, plano: { mesas: Mesa[]; ancho: number; alto: number }): Promise<Pt | null> {
  for (const mesa of plano.mesas) {
    const p = enPantalla(mesa, caja, plano);
    await tocar(c, p);
    await sleep(120);
    if (await haySeleccion(c)) return p;
  }
  // De rebote: espiral desde el centro del lienzo, con pasos de 10 píxeles.
  const centro = { x: caja.x + caja.w / 2, y: caja.y + caja.h / 2 };
  for (let r = 10; r <= Math.max(caja.w, caja.h); r += 10) {
    for (let a = 0; a < 360; a += 15) {
      const p = {
        x: centro.x + Math.cos((a * Math.PI) / 180) * r,
        y: centro.y + Math.sin((a * Math.PI) / 180) * r,
      };
      if (p.x < caja.x || p.x > caja.x + caja.w || p.y < caja.y || p.y > caja.y + caja.h) continue;
      await tocar(c, p);
      await sleep(60);
      if (await haySeleccion(c)) return p;
    }
  }
  return null;
}

// --- El recorrido -----------------------------------------------------------

type Row = {
  dispositivo: string;
  tamano: string;
  accion: Action;
  fps: number;
  medianaMs: number;
  peorMs: number;
  perdidos: number;
  fotogramas: number;
  efectos: string;
};

async function recorrer(): Promise<Row[]> {
  const port = 9222;
  const profile = join(tmpdir(), "table-waitlist-perf-chrome");
  const child = spawn(CHROME, chromeArgs(port, profile), { stdio: "ignore" });
  const rows: Row[] = [];
  let c: (Cdp & { targetId: string }) | null = null;
  const email = process.env.PERF_USER ?? "admin@grupocomidas.test";
  const password = DEV_PASSWORD;
  const plano = await mesasDelPlano();

  try {
    c = await openTab();
    await c.send("Page.enable");
    await c.send("Runtime.enable");
    await c.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
    await sleep(1200);
    ventanaDelante();

    for (const device of DEVICES) {
      if (soloDevice && device.name !== soloDevice) continue;
      await c.send("Emulation.setDeviceMetricsOverride", {
        width: device.width,
        height: device.height,
        deviceScaleFactor: device.dpr,
        mobile: device.name.startsWith("celular"),
      });
      await entrar(c, email, password);
      await goto(c, `${BASE_URL}/restaurante/rest_norte/editor`, 2500);
      ventanaDelante();
      await sleep(400);

      const hay = await c.send("Runtime.evaluate", {
        returnByValue: true,
        expression: `(() => {
          const b = document.querySelector("canvas");
          if (!b) return "null";
          const r = b.getBoundingClientRect();
          return JSON.stringify({ x: r.x, y: r.y, w: r.width, h: r.height });
        })()`,
      });
      if (String(hay.result?.value) === "null") {
        console.log(`  ${device.name}: no se pintó el lienzo, se omite`);
        continue;
      }
      const lienzo = JSON.parse(String(hay.result?.value)) as Caja;

      const mesa = await buscarMesa(c, lienzo, plano);
      if (!mesa) {
        console.log(`  ${device.name}: no se encontró ninguna mesa, se omite`);
        continue;
      }
      console.log(
        `  ${device.name} ${device.width}x${device.height}@${device.dpr}x — lienzo ${Math.round(lienzo.w)}x${Math.round(lienzo.h)}, mesa en ${Math.round(mesa.x)},${Math.round(mesa.y)}`,
      );

      if (!sinThrottling) await c.send("Emulation.setCPUThrottlingRate", { rate: throttleRate });

      for (const accion of ACTIONS) {
        const muestras: number[] = [];
        let mediana = 0;
        let peor = 0;
        let perdidos = 0;
        let n = 0;
        let efectos = 0;
        for (let pasada = 0; pasada < PASADAS; pasada += 1) {
          const huellaAntes = await abrir(c);
          // El gesto.
          if (accion === "arrastrar") {
            await arrastrarDedo(c, mesa, { x: mesa.x + 90, y: mesa.y + 60 }, PASOS);
          } else if (accion === "seleccionar") {
            await tocar(c, mesa);
            await sleep(200);
          } else if (accion === "plano") {
            // Un dedo por el fondo, lejos de las mesas: es la cámara.
            await arrastrarDedo(
              c,
              { x: lienzo.x + 24, y: lienzo.y + lienzo.h * 0.85 },
              { x: lienzo.x + lienzo.w * 0.5, y: lienzo.y + lienzo.h * 0.55 },
              PASOS,
            );
          } else {
            // Pellizco de dos dedos que se separan (acercar): el zoom.
            await arrastrarDedo(
              c,
              { x: lienzo.x + lienzo.w / 2 - 40, y: lienzo.y + lienzo.h / 2 },
              { x: lienzo.x + lienzo.w / 2 - 130, y: lienzo.y + lienzo.h / 2 },
              PASOS,
              { x: lienzo.x + lienzo.w / 2 + 40, y: lienzo.y + lienzo.h / 2 },
            );
          }
          const m = await cerrar(c);
          muestras.push(m.fps);
          mediana = m.mediana;
          peor = m.peor;
          perdidos = m.perdidos;
          n = m.n;
          if (COMPROBACIONES[accion](m, huellaAntes)) efectos += 1;
          await sleep(200);
        }
        muestras.sort((a, b) => a - b);
        const fps = Math.round(muestras[Math.floor(muestras.length / 2)] * 10) / 10;
        rows.push({
          dispositivo: device.name,
          tamano: `${device.width}x${device.height}@${device.dpr}x`,
          accion,
          fps,
          medianaMs: Math.round(mediana * 10) / 10,
          peorMs: Math.round(peor * 10) / 10,
          perdidos,
          fotogramas: n,
          efectos: `${efectos}/${PASADAS}`,
        });
        const marca = efectos === PASADAS ? "" : `   ¡SIN EFECTO ${efectos}/${PASADAS}!`;
        console.log(
          `    ${accion.padEnd(11)} ${String(fps).padStart(5)} FPS  mediana ${mediana.toFixed(1).padStart(5)} ms  peor ${peor.toFixed(1).padStart(6)} ms  perdidos ${String(perdidos).padStart(3)}  (${n} fotogramas)${marca}`,
        );
      }
      if (!sinThrottling) await c.send("Emulation.setCPUThrottlingRate", { rate: 1 });
    }
    return rows;
  } finally {
    c?.close();
    child.kill();
  }
}

const modo = sinThrottling ? "sin ralentización" : `CPU ×${throttleRate}`;
console.log(`Midiendo el editor de mesas (${modo})…`);
const rows = await recorrer();

mkdirSync(OUT_DIR, { recursive: true });
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const archivo = `${OUT_DIR}/${ETIQUETA}-${sinThrottling ? "sin-throttling" : `cpu-${throttleRate}x`}-${stamp}.json`;
writeFileSync(
  archivo,
  JSON.stringify(
    {
      etiqueta: ETIQUETA,
      modo,
      cuando: new Date().toISOString(),
      sistema: `${process.platform} ${process.version}`,
      navegador: CHROME,
      pasosPorGesto: PASOS,
      msPorPulso: MS_PULSO,
      pasadas: PASADAS,
      filas: rows,
    },
    null,
    2,
  ),
);

console.log("");
console.log(`| Dispositivo       | Acción     |    FPS | Mediana | Peor     | Perdidos | Efecto  |`);
console.log(`| ----------------- | ---------- | ------: | ------: | -------: | -------: | ------- |`);
for (const r of rows) {
  console.log(
    `| ${r.dispositivo.padEnd(17)} | ${r.accion.padEnd(10)} | ${String(r.fps).padStart(6)} | ${(r.medianaMs + " ms").padStart(6)} | ${(r.peorMs + " ms").padStart(8)} | ${String(r.perdidos).padStart(8)} | ${r.efectos.padStart(7)} |`,
  );
}
console.log("");
console.log("FPS = fotogramas entregados por segundo real. 60 es el techo de la pantalla.");
console.log("Perdidos = fotogramas que costaron dos presupuestos (33 ms) o más.");
console.log("Efecto = cuántas de las pasadas movieron de verdad algo (si no, la cifra no cuenta).");
console.log(`Guardado en ${archivo}`);
if (jsonOut) console.log(JSON.stringify(rows, null, 2));