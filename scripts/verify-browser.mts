// Verificación de /analiticas en un navegador real (Chrome por CDP).
//
// Sirve para dos cosas que ningún `verify:*` puede ver:
//
//  - #60: que el gráfico «Volumen y tiempo de espera» lleva sus ejes
//    etiquetados («Clientes (grupos)» a la izquierda, «Minutos de espera» a
//    la derecha, «Día» debajo), la leyenda de series y tooltips con unidades.
//  - El botón «Lista de espera» del plano en vivo: que se vea en TODOS los
//    tamaños (celular y tablet, de pie y acostados, y computadora), con el
//    usuario de restaurante y con el admin; que mida 44×44 o más, que nada lo
//    tape, que abra el panel y que Esc lo cierre. Analítica no lo tiene.
//  - Los textos de las mesas del plano en vivo, con la tablet acostada: que
//    ninguno (nombre de la mesa y cliente) se salga del sitio de su mesa (la
//    mesa con sus sillas) ni se encime con los de otra mesa. Se informa
//    también la letra más pequeña en pantalla.
//  - #86: el select de «Personas» de «Agregar cliente», en «Uno» y en «Varios»:
//    que la lista abierta se vea entera (o con su scroll) y no la corte el
//    panel, que Esc cierre solo la lista, que el teclado elija, que Tab la
//    cierre, que no se repitan ids y que todo mida 44 px o más.
//  - #88: que tocar una sugerencia del asistente pregunta de una vez (una
//    sola petición) y que mientras responde no se puede mandar otra.
//  - #61: que la página NO tiene scroll horizontal en 320, 375, 414, 768,
//    1024 ni escritorio, midiendo en cada tamaño
//    `document.documentElement.scrollWidth` contra `window.innerWidth` (lo
//    que pide la issue) y contra `documentElement.clientWidth` (más exigente;
//    aquí da igual porque Chrome arranca con `--hide-scrollbars`, pero se
//    comprueba por si acaso). Si algo se sale, lista los elementos que se
//    desbordan.
//
// No añade dependencias: el cliente de Chrome DevTools Protocol va dentro
// (WebSocket nativo de Node) y Chrome se lanza con `--remote-debugging-port`.
// NO corre en el CI. Uso:
//
//   npx tsx scripts/verify-browser.mts
//
// Capturas y resultado en `.verify-browser/` (ignorado por git).

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";

const ROOT = process.cwd();
const DIR = resolve(ROOT, ".verify-browser");
const DB_FILE = resolve(ROOT, ".verify-browser.db");
// Dist dir propio: si usara el mismo que `verify:auth` (`.next-verify`), Next
// se niega a levantar dos dev servers a la vez y el script se queda sin arrancar.
const DIST_DIR = process.env.VERIFY_BROWSER_DIST_DIR ?? ".next-browser";
const PASSWORD = process.env.VERIFY_BROWSER_PASSWORD ?? "12345abc";
const SHOTS = join(DIR, "shots");
const PERFIL = join(DIR, "chrome-profile");

/** Los tamaños que pide la issue #61. */
const ANCHOS = [320, 375, 414, 768, 1024, 1440];
const ALTOS: Record<number, number> = { 320: 640, 375: 667, 414: 780, 768: 1024, 1024: 800, 1440: 900 };

const CHROME = [
  join(process.env["ProgramFiles"] ?? "C:\\Program Files", "Google", "Chrome", "Application", "chrome.exe"),
  join(process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)", "Google", "Chrome", "Application", "chrome.exe"),
  join(process.env.LOCALAPPDATA ?? "", "Google", "Chrome", "Application", "chrome.exe"),
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].find((candidate) => candidate && existsSync(candidate));

if (!CHROME) {
  console.log("verify:browser — no hay Chrome instalado; se omite.");
  process.exit(0);
}

// Se declaran aquí (y no junto a cada `spawn`) para que la limpieza pueda
// apagarlos aunque el script reviente antes de arrancar uno de los dos: sin
// esto, un fallo a mitad deja un dev server de Next y un Chrome huérfanos
// bloqueando la siguiente ejecución.
let server: ChildProcess | null = null;
let chrome: ChildProcess | null = null;
let serverLog = "";

/** Apaga Chrome y la app si siguen vivos. Registrada en `exit`. */
function cerrarTodo(): void {
  if (chrome && !chrome.killed) {
    try {
      chrome.kill();
    } catch {
      // ya estaba fuera
    }
  }
  chrome = null;
  if (server?.pid) {
    const pid = server.pid;
    try {
      if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
      else spawnSync("kill", ["-9", String(pid)], { stdio: "ignore" });
    } catch {
      // ya estaba fuera
    }
  }
  server = null;
}
process.on("exit", cerrarTodo);

// ---------------------------------------------------------------------------
// Cliente mínimo de Chrome DevTools Protocol (sin dependencias)
// ---------------------------------------------------------------------------

/** Respuesta de un comando CDP (solo se leen estos campos). */
type RespuestaCdp = {
  data?: string;
  targetId?: string;
  sessionId?: string;
  result?: { value?: unknown };
  [clave: string]: unknown;
};

type Cdp = {
  send: (method: string, params?: Record<string, unknown>) => Promise<RespuestaCdp>;
  on: (event: string, handler: (params: unknown) => void) => () => void;
  close: () => void;
};

/** Conecta al WebSocket de una pestaña concreta (sin `sessionId`). */
async function conectarWs(urlWs: string): Promise<Cdp> {
  const ws = new WebSocket(urlWs);
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("no se pudo abrir el WebSocket de Chrome")), { once: true });
  });

  let id = 1;
  const pendientes = new Map<number, { resolve: (v: RespuestaCdp) => void; reject: (e: Error) => void }>();
  const oyentes = new Map<string, Set<(params: unknown) => void>>();

  ws.addEventListener("message", (evento: MessageEvent) => {
    const msg = JSON.parse(String(evento.data));
    if (typeof msg.id === "number") {
      const slot = pendientes.get(msg.id);
      if (!slot) return;
      pendientes.delete(msg.id);
      if (msg.error) slot.reject(new Error(`${msg.error.message}`));
      else slot.resolve(msg.result);
      return;
    }
    oyentes.get(msg.method)?.forEach((fn) => fn(msg.params));
  });
  ws.addEventListener("close", () => {
    const error = new Error("se cerró la conexión con Chrome");
    pendientes.forEach((slot) => slot.reject(error));
    pendientes.clear();
  });

  const enviar = (method: string, params: Record<string, unknown> = {}) => {
    const nuevoId = id++;
    return new Promise<RespuestaCdp>((resolve, reject) => {
      const reloj = setTimeout(() => {
        pendientes.delete(nuevoId);
        reject(new Error(`Chrome no respondió a ${method} en 60 s`));
      }, 60_000);
      pendientes.set(nuevoId, {
        resolve: (v) => {
          clearTimeout(reloj);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(reloj);
          reject(e);
        },
      });
      ws.send(JSON.stringify({ id: nuevoId, method, params }));
    });
  };

  return {
    send: (method, params = {}) => enviar(method, params),
    on(event, handler) {
      if (!oyentes.has(event)) oyentes.set(event, new Set());
      oyentes.get(event)!.add(handler);
      return () => oyentes.get(event)!.delete(handler);
    },
    close() {
      ws.close();
    },
  };
}

type ObjetivoDevtools = { type: string; webSocketDebuggerUrl?: string };

/**
 * Conecta con la pestaña que Chrome tiene abierta.
 *
 * Se va al endpoint `http://127.0.0.1:puerto/json/list` y a su WebSocket
 * directo, sin `Target.attachToTarget`: con el modo `flatten` esta versión de
 * Chrome rechaza los dominios de página («'Page.enable' wasn't found»).
 */
async function abrirPestana(puerto: number): Promise<Cdp> {
  let ultimoError: Error | null = null;
  for (let intento = 0; intento < 60; intento += 1) {
    try {
      const respuesta = await fetch(`http://127.0.0.1:${puerto}/json/list`);
      if (respuesta.ok) {
        const objetivos = (await respuesta.json()) as ObjetivoDevtools[];
        let pagina = objetivos.find((objetivo) => objetivo.type === "page" && objetivo.webSocketDebuggerUrl);
        if (!pagina) {
          // Chrome puede arrancar sin pestañas: se crea una (PUT desde v92).
          const creada = await fetch(`http://127.0.0.1:${puerto}/json/new?about:blank`, { method: "PUT" });
          if (creada.ok) pagina = (await creada.json()) as ObjetivoDevtools;
        }
        if (pagina?.webSocketDebuggerUrl) return await conectarWs(pagina.webSocketDebuggerUrl);
      }
    } catch (error) {
      ultimoError = error instanceof Error ? error : new Error(String(error));
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Chrome no abrió la pestaña${ultimoError ? `: ${ultimoError.message}` : ""}`);
}

// ---------------------------------------------------------------------------
// Base temporal y app
// ---------------------------------------------------------------------------

for (const suffix of ["", "-wal", "-shm"]) rmSync(DB_FILE + suffix, { force: true });
rmSync(DIR, { recursive: true, force: true });
mkdirSync(SHOTS, { recursive: true });

const port = await new Promise<number>((res) => {
  const probe = createServer();
  probe.listen(0, () => {
    const p = (probe.address() as { port: number }).port;
    probe.close(() => res(p));
  });
});
const BASE = `http://localhost:${port}`;

const env = {
  ...process.env,
  TURSO_DATABASE_URL: `file:${DB_FILE}`,
  TURSO_AUTH_TOKEN: "",
  BETTER_AUTH_SECRET: "verify-browser-secreto-solo-para-esta-prueba-00",
  // Sin la retención diaria de `server.ts`: escribiría en esta base a la vez
  // que la prueba (SQLite: «database is locked»). Se prueba aparte, llamándola.
  RETENTION_JOB: "off",
  BETTER_AUTH_URL: BASE,
  PORT: String(port),
  NEXT_DIST_DIR: DIST_DIR,
  // Sin clave: el asistente contesta en local.
  OPENROUTER_API_KEY: "",
  NODE_ENV: "development",
};
Object.assign(process.env, env);

function run(command: string, args: string[]): Promise<number> {
  return new Promise((res) => {
    const child = spawn(command, args, { env, cwd: ROOT, stdio: "ignore", shell: true });
    child.on("exit", (code) => res(code ?? 1));
  });
}

const { applyAllMigrations } = await import("./migrations.mts");
await applyAllMigrations(`file:${DB_FILE}`);
if ((await run("npx", ["tsx", "scripts/seed.ts"])) !== 0) throw new Error("el seed falló");
// Datos de demostración: sin ellos el gráfico sale vacío y la captura no
// sirve para mirar nada. Si falla, se sigue igual (el resto de la prueba no
// depende de los datos).
await run("npx", ["tsx", "scripts/db-demo.mts"]);

server = spawn("npx", ["tsx", "server.ts"], { env, cwd: ROOT, shell: true, stdio: "pipe" });
server.stdout?.on("data", (d) => (serverLog += String(d)));
server.stderr?.on("data", (d) => (serverLog += String(d)));
{
  const limite = Date.now() + 180_000;
  while (Date.now() < limite && !serverLog.includes("Table Waitlist en")) await new Promise((r) => setTimeout(r, 500));
  if (!serverLog.includes("Table Waitlist en")) throw new Error(`La app no arrancó:\n${serverLog.slice(-2000)}`);
}

const signIn = await fetch(`${BASE}/api/auth/sign-in/email`, {
  method: "POST",
  headers: { "content-type": "application/json", Origin: BASE },
  body: JSON.stringify({ email: "analitica@grupocomidas.test", password: PASSWORD }),
});
if (!signIn.ok) throw new Error(`login ${signIn.status}`);
const cookieCruda = (signIn.headers.get("set-cookie") ?? "").split(";")[0];
const nombreCookie = cookieCruda.slice(0, cookieCruda.indexOf("="));
const valorCookie = cookieCruda.slice(cookieCruda.indexOf("=") + 1);
if (!valorCookie) throw new Error(`sin cookie de sesión: ${cookieCruda.slice(0, 60)}`);

// ---------------------------------------------------------------------------
// Chrome y mediciones
// ---------------------------------------------------------------------------

const puertoCdp = 9300 + Math.floor(Math.random() * 500);
chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${puertoCdp}`,
    `--user-data-dir=${PERFIL}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-gpu",
    // Sin barra de scroll: `innerWidth` y `clientWidth` coinciden y la
    // medida no depende de la plataforma.
    "--hide-scrollbars",
    "--window-size=1440,900",
    "about:blank",
  ],
  { stdio: "ignore" },
);

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function conectar(intentos = 60): Promise<Cdp> {
  for (let intento = 0; intento < intentos; intento += 1) {
    try {
      return await abrirPestana(puertoCdp);
    } catch {
      await esperar(250);
    }
  }
  throw new Error("Chrome no abrió la pestaña");
}

const tab = await conectar();

await tab.send("Page.enable");
await tab.send("Network.enable");
await tab.send("Network.setCookie", { name: nombreCookie, value: valorCookie, url: BASE, path: "/" });

const contenido = `(() => {
  const doc = document.documentElement;
  const texto = document.body ? document.body.innerText : "";
  const conTitulo = [...document.querySelectorAll("[title]")].map((el) => el.getAttribute("title") || "");
  const anchosBarras = [...document.querySelectorAll('[role="img"][title]')].map((el) => el.getBoundingClientRect().width);
  const desbordados = [];
  const fuera = [];
  // ¿Alguien por encima lo recorta o le pone scroll propio? Entonces no es el
  // que ensancha la página.
  const recorta = (el) => {
    for (let padre = el.parentElement; padre; padre = padre.parentElement) {
      if (getComputedStyle(padre).overflowX !== "visible") return true;
    }
    return false;
  };
  for (const el of document.querySelectorAll("body *")) {
    const cs = getComputedStyle(el);
    // Un elemento con overflow-x propio (auto/scroll/hidden) no desborda la
    // página: se desplaza o se recorta él solo.
    if (cs.overflowX === "visible" && el.scrollWidth > el.clientWidth + 1) {
      desbordados.push({
        tag: el.tagName.toLowerCase(),
        cls: String(el.className || "").slice(0, 110),
        scrollWidth: el.scrollWidth,
        clientWidth: el.clientWidth,
      });
    }
    // Las HOJAS que empujan la página: se salen por la derecha, nadie las
    // recorta y ningún hijo hace lo mismo (para no listar la cadena entera).
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.right <= doc.clientWidth + 1) continue;
    if (recorta(el)) continue;
    const conHijoFuera = [...el.children].some((hijo) => {
      const q = hijo.getBoundingClientRect();
      return q.width > 0 && q.right > doc.clientWidth + 1 && !recorta(hijo);
    });
    if (conHijoFuera) continue;
    fuera.push({
      tag: el.tagName.toLowerCase(),
      cls: String(el.className || "").slice(0, 110),
      derecho: Math.round(r.right),
      ancho: Math.round(r.width),
      texto: String(el.innerText || "").replace(/\s+/g, " ").slice(0, 70),
    });
  }
  return JSON.stringify({
    innerWidth: window.innerWidth,
    clientWidth: doc.clientWidth,
    scrollWidth: doc.scrollWidth,
    bodyScrollWidth: document.body.scrollWidth,
    desbordados: desbordados.slice(0, 20),
    fuera: fuera.slice(0, 12),
    cargado: texto.includes("Volumen y tiempo de espera"),
    ejes: {
      izquierdo: texto.includes("Clientes (grupos)"),
      derecho: texto.includes("Minutos de espera"),
      x: texto.split("\\n").includes("Día"),
      leyenda: texto.includes("Clientes (grupos)") && texto.includes("Minutos de espera"),
      tooltips: conTitulo.some((t) => /\\bgrupos?\\b/.test(t)) && conTitulo.some((t) => /\\bminutos?\\b/.test(t)),
      // Las barras son fluidas (#61): ninguna puede quedar en 0 px.
      barras: anchosBarras.length > 0 && anchosBarras.every((ancho) => ancho >= 4),
    },
  });
})()`;

type Medicion = {
  innerWidth: number;
  clientWidth: number;
  scrollWidth: number;
  bodyScrollWidth: number;
  desbordados: Array<{ tag: string; cls: string; scrollWidth: number; clientWidth: number }>;
  fuera: Array<{ tag: string; cls: string; derecho: number; ancho: number; texto: string }>;
  cargado: boolean;
  ejes: { izquierdo: boolean; derecho: boolean; x: boolean; leyenda: boolean; tooltips: boolean; barras: boolean };
};

async function evaluar(expresion: string): Promise<unknown> {
  const respuesta = await tab.send("Runtime.evaluate", { expression: expresion, returnByValue: true });
  return respuesta.result?.value;
}

async function cargar(): Promise<void> {
  const cargado = new Promise<void>((resolve) => {
    const off = tab.on("Page.loadEventFired", () => {
      off();
      resolve();
    });
    setTimeout(() => {
      off();
      resolve();
    }, 90_000);
  });
  await tab.send("Page.navigate", { url: `${BASE}/analiticas` });
  await cargado;
  const limite = Date.now() + 90_000;
  while (Date.now() < limite) {
    // «Resumen del período» es un `aria-label`, no texto visible: `innerText`
    // no lo contiene. Lo que sí marca «ya hay datos» es esa sección montada.
    const listo = await evaluar(`!!document.querySelector('section[aria-label="Resumen del período"]')`);
    if (typeof listo === "boolean" && listo) return;
    await esperar(400);
  }
  // Diagnóstico: sin esto un fallo (sin sesión, error de API, pantalla de
  // carga) solo dice «no cargó» y no se puede saber por qué.
  const diagnostico = await evaluar(`JSON.stringify({
    url: location.href,
    texto: (document.body ? document.body.innerText : "").slice(0, 600),
    html: (document.body ? document.body.innerHTML : "").slice(0, 300),
  })`);
  let captura = "";
  try {
    const prueba = await tab.send("Page.captureScreenshot", { format: "png" });
    const destino = join(DIR, "fallo.png");
    writeFileSync(destino, Buffer.from(prueba.data ?? "", "base64"));
    captura = ` captura en ${destino}`;
  } catch {
    // sin captura
  }
  throw new Error(`la página no cargó /analiticas a tiempo: ${String(diagnostico)}${captura}`);
}

type Fila = { ancho: number; tema: string; pasa: boolean; pasaEstricto: boolean; medicion: Medicion };
const filas: Fila[] = [];
let ejes: Medicion["ejes"] | null = null;

for (const ancho of ANCHOS) {
  for (const tema of ["claro", "oscuro"]) {
    await tab.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: tema === "oscuro" ? "dark" : "light" }],
    });
    await tab.send("Emulation.setDeviceMetricsOverride", {
      width: ancho,
      height: ALTOS[ancho] ?? 800,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await cargar();
    const medicion = (await evaluar(contenido)) as string;
    const datos: Medicion = JSON.parse(medicion);
    if (!ejes) ejes = datos.ejes;
    filas.push({
      ancho,
      tema,
      pasa: datos.scrollWidth <= datos.innerWidth,
      pasaEstricto: datos.scrollWidth <= datos.clientWidth,
      medicion: datos,
    });
    const captura = await tab.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(SHOTS, `analiticas-${ancho}-${tema}.png`), Buffer.from(captura.data as string, "base64"));
    console.log(
      `${String(ancho).padStart(4)} ${tema.padEnd(6)} scrollWidth=${String(datos.scrollWidth).padStart(4)} innerWidth=${String(datos.innerWidth).padStart(4)} clientWidth=${String(datos.clientWidth).padStart(4)} ${datos.scrollWidth <= datos.innerWidth && datos.scrollWidth <= datos.clientWidth ? "sin scroll" : "CON SCROLL HORIZONTAL"}${datos.desbordados.length ? `  desbordan=${datos.desbordados.length}` : ""}`,
    );
  }
}

// ---------------------------------------------------------------------------
// Plano en vivo: el botón «Lista de espera» en todos los tamaños
// ---------------------------------------------------------------------------

async function entrarComo(correo: string): Promise<void> {
  const respuesta = await fetch(`${BASE}/api/auth/sign-in/email`, {
    method: "POST",
    headers: { "content-type": "application/json", Origin: BASE },
    body: JSON.stringify({ email: correo, password: PASSWORD }),
  });
  if (!respuesta.ok) throw new Error(`login de ${correo}: ${respuesta.status}`);
  const cruda = (respuesta.headers.get("set-cookie") ?? "").split(";")[0];
  await tab.send("Network.clearBrowserCookies");
  await tab.send("Network.setCookie", { name: cruda.slice(0, cruda.indexOf("=")), value: cruda.slice(cruda.indexOf("=") + 1), url: BASE, path: "/" });
}

async function abrirPlano(): Promise<void> {
  const cargado = new Promise<void>((resolve) => {
    const off = tab.on("Page.loadEventFired", () => {
      off();
      resolve();
    });
    setTimeout(() => {
      off();
      resolve();
    }, 90_000);
  });
  await tab.send("Page.navigate", { url: `${BASE}/restaurante/rest_centro/mapa` });
  await cargado;
  const limite = Date.now() + 90_000;
  while (Date.now() < limite) {
    if ((await evaluar(`!!(window.Konva && Konva.stages.length)`)) === true) return;
    await esperar(400);
  }
  throw new Error("el plano en vivo no cargó a tiempo");
}

const botonLista = `(() => {
  const btn = document.querySelector('[aria-controls="panel-lista-espera"]');
  if (!btn) return JSON.stringify({ existe: false });
  const r = btn.getBoundingClientRect();
  const visible = r.width > 0 && r.height > 0 && r.top >= 0 && r.left >= 0 && r.bottom <= innerHeight && r.right <= innerWidth;
  const encima = visible ? document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2) : null;
  return JSON.stringify({ existe: true, visible, tapado: visible ? !btn.contains(encima) : true, ancho: Math.round(r.width), alto: Math.round(r.height), texto: btn.innerText.replace(/\\s+/g, " ").trim() });
})()`;
const panelAbierto = `(() => { const p = document.querySelector("#panel-lista-espera"); if (!p) return false; const r = p.getBoundingClientRect(); return r.width > 0 && r.left < innerWidth - 10 && r.right <= innerWidth + 1; })()`;

const TAMANOS_PLANO: Array<{ nombre: string; ancho: number; alto: number; tactil: boolean }> = [
  { nombre: "celular de pie", ancho: 375, alto: 812, tactil: true },
  { nombre: "celular acostado", ancho: 812, alto: 375, tactil: true },
  { nombre: "tablet de pie", ancho: 768, alto: 1024, tactil: true },
  { nombre: "tablet acostada", ancho: 1024, alto: 768, tactil: true },
  { nombre: "computadora", ancho: 1440, alto: 900, tactil: false },
];
const filasLista: Array<{ quien: string; tamano: string; pasa: boolean; detalle: string }> = [];

for (const quien of ["chinawok", "admin"]) {
  await entrarComo(`${quien}@grupocomidas.test`);
  for (const t of TAMANOS_PLANO) {
    await tab.send("Emulation.setDeviceMetricsOverride", {
      width: t.ancho,
      height: t.alto,
      deviceScaleFactor: 1,
      mobile: t.tactil,
      screenOrientation: t.ancho > t.alto ? { type: "landscapePrimary", angle: 90 } : { type: "portraitPrimary", angle: 0 },
    });
    await tab.send("Emulation.setTouchEmulationEnabled", { enabled: t.tactil, maxTouchPoints: t.tactil ? 5 : 1 });
    await abrirPlano();
    await esperar(800);
    const boton = JSON.parse(String(await evaluar(botonLista))) as { existe: boolean; visible?: boolean; tapado?: boolean; ancho?: number; alto?: number; texto?: string };
    let abre = false;
    let cierraEsc = false;
    if (boton.existe && boton.visible && !boton.tapado) {
      await evaluar(`document.querySelector('[aria-controls="panel-lista-espera"]').click(), true`);
      await esperar(700);
      abre = (await evaluar(panelAbierto)) === true;
      const captura = await tab.send("Page.captureScreenshot", { format: "png" });
      writeFileSync(join(SHOTS, `plano-lista-${quien}-${t.ancho}x${t.alto}.png`), Buffer.from(captura.data as string, "base64"));
      await tab.send("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await esperar(500);
      cierraEsc = (await evaluar(panelAbierto)) === false;
    }
    const pasa = boton.existe && !!boton.visible && !boton.tapado && (boton.ancho ?? 0) >= 44 && (boton.alto ?? 0) >= 44 && abre && cierraEsc;
    filasLista.push({ quien, tamano: `${t.nombre} ${t.ancho}×${t.alto}`, pasa, detalle: JSON.stringify({ ...boton, abre, cierraEsc }) });
  }
}
// Analítica no opera: sin botón.
await entrarComo("analitica@grupocomidas.test");
await tab.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await tab.send("Emulation.setTouchEmulationEnabled", { enabled: false, maxTouchPoints: 1 });
await abrirPlano();
await esperar(500);
const analiticaSinBoton = (JSON.parse(String(await evaluar(botonLista))) as { existe: boolean }).existe === false;

// ---------------------------------------------------------------------------
// #88: las sugerencias del asistente preguntan de una vez
// ---------------------------------------------------------------------------

// La IA de verdad no se llama: `fetch` a /api/assistant se sustituye por una
// respuesta que tarda 1,5 s, y se cuenta cuántas veces se pidió.
await tab.send("Page.navigate", { url: `${BASE}/analiticas` });
const sugerencias = `[...document.querySelectorAll('button')].filter((b) => ['¿Cuál fue el día más lento?', 'Dame el top de clientes', 'Compara restaurantes'].includes(b.textContent.trim()))`;
for (let i = 0; i < 200 && (await evaluar(`${sugerencias}.length === 3 && ${sugerencias}.every((b) => !b.disabled)`)) !== true; i += 1) await esperar(300);
await evaluar(`(() => {
  window.__preguntas = 0;
  const original = window.fetch.bind(window);
  window.fetch = (url, init) => {
    if (String(url).includes('/api/assistant')) {
      window.__preguntas += 1;
      return new Promise((ok) => setTimeout(() => ok(new Response(JSON.stringify({ answer: 'Respuesta de prueba del asistente' }), { status: 200, headers: { 'Content-Type': 'application/json' } })), 1500));
    }
    return original(url, init);
  };
  return true;
})()`);
await evaluar(`${sugerencias}[0].click(), true`);
await esperar(150);
// Mientras responde: otra sugerencia y «Preguntar» están desactivados, y
// tocarlos no manda nada.
const mientras = JSON.parse(String(await evaluar(`JSON.stringify({ desactivadas: ${sugerencias}.every((b) => b.disabled), cuadro: document.querySelector('input[maxlength="500"]')?.value ?? null, preguntar: [...document.querySelectorAll('button')].find((b) => /Consultando/.test(b.textContent))?.disabled === true })`))) as { desactivadas: boolean; cuadro: string | null; preguntar: boolean };
await evaluar(`${sugerencias}[1].click(), [...document.querySelectorAll('button')].find((b) => /Consultando|Preguntar/.test(b.textContent))?.click(), true`);
await esperar(2200);
const filaAsistente = JSON.parse(String(await evaluar(`JSON.stringify({ preguntas: window.__preguntas, respuesta: document.body.innerText.includes('Respuesta de prueba del asistente'), libres: ${sugerencias}.every((b) => !b.disabled) })`))) as { preguntas: number; respuesta: boolean; libres: boolean };
const asistentePasa = filaAsistente.preguntas === 1 && mientras.desactivadas && mientras.preguntar && mientras.cuadro === "¿Cuál fue el día más lento?" && filaAsistente.respuesta && filaAsistente.libres;

// ---------------------------------------------------------------------------
// Plano en vivo: los textos de las mesas, dentro de su mesa y sin encimarse
// ---------------------------------------------------------------------------

// En el navegador: por cada texto visible de una mesa (`live-text`), su caja
// REAL en pantalla (el ancho del texto, no el del hueco que se le dio). Tiene
// que caber en el sitio de su mesa (`table-hit`: la mesa con sus sillas) y no
// tocar los textos de otra mesa.
const textosDelPlano = `(() => {
  const st = Konva.stages[0];
  const fallos = [];
  const cajas = [];
  let textos = 0;
  let minimo = 99;
  for (const g of st.find(".table-element")) {
    const hit = g.findOne(".table-hit");
    const ref = hit ? hit.getClientRect() : g.getClientRect({ skipStroke: true });
    for (const t of g.find(".live-text")) {
      if (!t.isVisible() || !t.text()) continue;
      const tr = t.getAbsoluteTransform();
      const ancho = Math.min(t.getTextWidth(), t.width());
      const izq = t.align() === "center" ? (t.width() - ancho) / 2 : 0;
      const pts = [[izq, 0], [izq + ancho, 0], [izq, t.fontSize()], [izq + ancho, t.fontSize()]].map(([x, y]) => tr.point({ x, y }));
      const caja = { x0: Math.min(...pts.map((p) => p.x)), y0: Math.min(...pts.map((p) => p.y)), x1: Math.max(...pts.map((p) => p.x)), y1: Math.max(...pts.map((p) => p.y)) };
      const px = t.fontSize() * t.getAbsoluteScale().y;
      textos += 1;
      minimo = Math.min(minimo, px);
      cajas.push({ id: g.id(), texto: t.text(), ...caja });
      const dentro = caja.x0 >= ref.x - 1 && caja.y0 >= ref.y - 1 && caja.x1 <= ref.x + ref.width + 1 && caja.y1 <= ref.y + ref.height + 1;
      if (!dentro) fallos.push("se sale: «" + t.text() + "» en " + g.id());
    }
  }
  for (let i = 0; i < cajas.length; i += 1) {
    for (let j = i + 1; j < cajas.length; j += 1) {
      const a = cajas[i], b = cajas[j];
      if (a.id === b.id) continue;
      const w = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);
      const h = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
      if (w > 0.5 && h > 0.5) fallos.push("se enciman: «" + a.texto + "» y «" + b.texto + "»");
    }
  }
  return JSON.stringify({ textos, minimo: Number(minimo.toFixed(1)), fallos: fallos.slice(0, 8) });
})()`;

const filasTextos: Array<{ tamano: string; pasa: boolean; detalle: string }> = [];
await entrarComo("chinawok@grupocomidas.test");
for (const t of [
  { nombre: "tablet acostada", ancho: 1180, alto: 820 },
  { nombre: "tablet acostada", ancho: 1024, alto: 768 },
]) {
  await tab.send("Emulation.setDeviceMetricsOverride", {
    width: t.ancho,
    height: t.alto,
    deviceScaleFactor: 1,
    mobile: true,
    screenOrientation: { type: "landscapePrimary", angle: 90 },
  });
  await tab.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await abrirPlano();
  await esperar(800);
  // Cada zona del restaurante (la de demostración es la más llena).
  const zonas = Number(await evaluar(`document.querySelectorAll('[role=tab]').length`)) || 1;
  for (let z = 0; z < zonas; z += 1) {
    await evaluar(`(document.querySelectorAll('[role=tab]')[${z}]?.click(), true)`);
    await esperar(1200);
    const nombreZona = String(await evaluar(`document.querySelectorAll('[role=tab]')[${z}]?.textContent ?? "única"`));
    const r = JSON.parse(String(await evaluar(textosDelPlano))) as { textos: number; minimo: number; fallos: string[] };
    const captura = await tab.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(join(SHOTS, `plano-textos-${t.ancho}x${t.alto}-zona${z + 1}.png`), Buffer.from(captura.data as string, "base64"));
    filasTextos.push({
      tamano: `${t.nombre} ${t.ancho}×${t.alto} · ${nombreZona}`,
      pasa: r.textos > 0 && r.fallos.length === 0,
      detalle: `${r.textos} textos, el menor de ${r.minimo} px${r.fallos.length ? " · " + r.fallos.join(" | ") : ""}`,
    });
  }
}

// ---------------------------------------------------------------------------
// #86: el select de «Personas» (Agregar cliente)
// ---------------------------------------------------------------------------

async function tecla(key: string): Promise<void> {
  const vk = ({ ArrowDown: 40, ArrowUp: 38, Escape: 27, Enter: 13, Tab: 9 } as Record<string, number>)[key] ?? 0;
  await tab.send("Input.dispatchKeyEvent", { type: "keyDown", key, code: key, windowsVirtualKeyCode: vk });
  await tab.send("Input.dispatchKeyEvent", { type: "keyUp", key, code: key, windowsVirtualKeyCode: vk });
}

// La lista abierta: ¿se ve entera dentro de lo que la recorta (o tiene su
// propio scroll), y no la tapa nada?
const medirLista = `(() => {
  const lb = [...document.querySelectorAll('[role=listbox]')].at(-1);
  if (!lb) return JSON.stringify({ abierta: false });
  const r = lb.getBoundingClientRect();
  let clip = { top: 0, bottom: innerHeight };
  for (let el = lb.parentElement; el; el = el.parentElement) {
    if (/(auto|scroll|hidden)/.test(getComputedStyle(el).overflowY)) { const c = el.getBoundingClientRect(); clip = { top: Math.max(clip.top, c.top), bottom: Math.min(clip.bottom, c.bottom) }; }
  }
  const dentro = r.top >= clip.top - 1 && r.bottom <= clip.bottom + 1;
  const opciones = [...lb.querySelectorAll('[role=option]')];
  const tapa = document.elementFromPoint(r.left + r.width / 2, r.top + 10);
  return JSON.stringify({ abierta: true, dentro, opciones: opciones.length, minAlto: Math.min(...opciones.map((o) => Math.round(o.getBoundingClientRect().height))), tapada: !!tapa && !lb.contains(tapa) });
})()`;

const filasSelect: Array<{ tamano: string; pasa: boolean; detalle: string }> = [];
await entrarComo("chinawok@grupocomidas.test");
for (const t of [
  { nombre: "tablet acostada", ancho: 1024, alto: 768 },
  { nombre: "tablet de pie", ancho: 768, alto: 1024 },
  { nombre: "celular acostado", ancho: 812, alto: 375 },
]) {
  await tab.send("Emulation.setDeviceMetricsOverride", { width: t.ancho, height: t.alto, deviceScaleFactor: 1, mobile: true, screenOrientation: t.ancho > t.alto ? { type: "landscapePrimary", angle: 90 } : { type: "portraitPrimary", angle: 0 } });
  await tab.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
  await tab.send("Page.navigate", { url: `${BASE}/restaurante/rest_centro/rapido` });
  for (let i = 0; i < 200 && (await evaluar(`[...document.querySelectorAll('button')].some((x) => /Agregar cliente/.test(x.textContent))`)) !== true; i += 1) await esperar(300);
  await evaluar(`[...document.querySelectorAll('button')].find((x) => /Agregar cliente/.test(x.textContent)).click(), true`);
  await esperar(900);
  const boton = `document.querySelectorAll('[role=dialog] [aria-haspopup=listbox]')[0]`;
  await evaluar(`${boton}.scrollIntoView({ block: "center" }), ${boton}.click(), true`);
  await esperar(400);
  const uno = JSON.parse(String(await evaluar(medirLista))) as { abierta: boolean; dentro: boolean; minAlto: number; tapada: boolean };
  // Esc: cierra la lista, no el panel.
  await evaluar(`${boton}.focus(), true`);
  await tecla("Escape");
  await esperar(300);
  const esc = (await evaluar(`!document.querySelector('[role=listbox]') && !!document.querySelector('[role=dialog] [aria-haspopup=listbox]')`)) === true;
  // Teclado: ↓ abre, ↓ ↓ baja, Enter elige; aria-activedescendant apunta a algo que existe.
  const antes = String(await evaluar(`${boton}.textContent.trim()`));
  await evaluar(`${boton}.focus(), true`);
  await tecla("ArrowDown"); await esperar(150); await tecla("ArrowDown"); await tecla("ArrowDown");
  const activo = (await evaluar(`(() => { const id = ${boton}.getAttribute('aria-activedescendant'); return !!(id && document.getElementById(id)); })()`)) === true;
  await tecla("Enter"); await esperar(250);
  const despues = String(await evaluar(`${boton}.textContent.trim()`));
  // Tab con la lista abierta: la cierra.
  await evaluar(`${boton}.focus(), true`);
  await tecla("ArrowDown"); await esperar(150); await tecla("Tab"); await esperar(250);
  const tab_ = (await evaluar(`!document.querySelector('[role=listbox]')`)) === true;
  // «Varios» con 5 filas: la última abre bien y no se repiten ids.
  await evaluar(`[...document.querySelectorAll('[role=dialog] button')].find((x) => x.textContent.trim() === 'Varios')?.click(), true`);
  await esperar(500);
  for (let i = 0; i < 2; i += 1) { await evaluar(`[...document.querySelectorAll('[role=dialog] button')].find((x) => x.textContent.trim() === 'Agregar fila')?.click(), true`); await esperar(150); }
  const ultimo = `[...document.querySelectorAll('[role=dialog] [aria-haspopup=listbox]')].at(-1)`;
  await evaluar(`${ultimo}.scrollIntoView({ block: "end" }), ${ultimo}.click(), true`);
  await esperar(400);
  const varios = JSON.parse(String(await evaluar(medirLista))) as { abierta: boolean; dentro: boolean; tapada: boolean };
  const idsRepetidos = Number(await evaluar(`(() => { const all = [...document.querySelectorAll('[id]')].map((e) => e.id); return all.length - new Set(all).size; })()`));
  const minBoton = Number(await evaluar(`Math.min(...[...document.querySelectorAll('[role=dialog] [aria-haspopup=listbox]')].map((x) => x.getBoundingClientRect().height))`));
  const captura = await tab.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(SHOTS, `select-personas-${t.ancho}x${t.alto}.png`), Buffer.from(captura.data as string, "base64"));
  const pasa = uno.abierta && uno.dentro && !uno.tapada && uno.minAlto >= 44 && esc && activo && antes !== despues && tab_ && varios.abierta && varios.dentro && !varios.tapada && idsRepetidos === 0 && minBoton >= 44;
  filasSelect.push({ tamano: `${t.nombre} ${t.ancho}×${t.alto}`, pasa, detalle: JSON.stringify({ uno, esc, activo, antes, despues, tab: tab_, varios, idsRepetidos, minBoton }) });
}

// ---------------------------------------------------------------------------
// Resultado
// ---------------------------------------------------------------------------

console.log("\n#60 ejes, leyenda y tooltips");
let fallos = 0;
for (const [clave, ok] of Object.entries(ejes ?? {})) {
  if (!ok) fallos += 1;
  console.log(`  ${ok ? "ok  " : "FALLA"} ${clave}`);
}

console.log("\n#61 desbordamientos");
for (const fila of filas) {
  const okFila = fila.pasa && fila.pasaEstricto;
  if (!okFila) fallos += 1;
  if (fila.tema !== "claro") continue;
  console.log(
    `  ${String(fila.ancho).padStart(4)}: scrollWidth=${fila.medicion.scrollWidth} inner=${fila.medicion.innerWidth} client=${fila.medicion.clientWidth} ${okFila ? "sin scroll" : "CON SCROLL HORIZONTAL"}`,
  );
  if (fila.medicion.fuera.length) {
    console.log("    hojas que empujan la página:");
    for (const d of fila.medicion.fuera) console.log(`      <${d.tag} class="${d.cls}"> derecho=${d.derecho} ancho=${d.ancho} «${d.texto}»`);
  }
  if (fila.medicion.desbordados.length) {
    console.log(`    contenido interno más ancho que su caja (${fila.medicion.desbordados.length}; lo recorta o lo desplaza un ancestro):`);
    for (const d of fila.medicion.desbordados.slice(0, 6)) console.log(`      <${d.tag} class="${d.cls}"> scroll=${d.scrollWidth} client=${d.clientWidth}`);
  }
}

console.log("\nPlano en vivo: botón «Lista de espera»");
for (const fila of filasLista) {
  if (!fila.pasa) fallos += 1;
  console.log(`  ${fila.pasa ? "ok  " : "FALLA"} ${fila.quien.padEnd(9)} ${fila.tamano.padEnd(26)} ${fila.pasa ? "" : fila.detalle}`);
}
if (!analiticaSinBoton) fallos += 1;
console.log(`  ${analiticaSinBoton ? "ok  " : "FALLA"} analítica no tiene el botón (no opera)`);

console.log("\nPlano en vivo: textos de las mesas (dentro del sitio de su mesa, sin encimarse)");
for (const fila of filasTextos) {
  if (!fila.pasa) fallos += 1;
  console.log(`  ${fila.pasa ? "ok  " : "FALLA"} ${fila.tamano.padEnd(48)} ${fila.detalle}`);
}

console.log("\n#86: select de «Personas» (Uno y Varios: se ve entero, Esc, teclado, Tab, ids y 44 px)");
for (const fila of filasSelect) {
  if (!fila.pasa) fallos += 1;
  console.log(`  ${fila.pasa ? "ok  " : "FALLA"} ${fila.tamano.padEnd(26)} ${fila.pasa ? "" : fila.detalle}`);
}

console.log("\n#88: sugerencias del asistente");
if (!asistentePasa) fallos += 1;
console.log(`  ${asistentePasa ? "ok  " : "FALLA"} una sugerencia pregunta de una vez y no se manda otra mientras responde ${asistentePasa ? "" : JSON.stringify({ ...mientras, ...filaAsistente })}`);

writeFileSync(join(DIR, "resultado.json"), JSON.stringify({ filas, ejes, filasLista, analiticaSinBoton, filasTextos, filasSelect, asistente: { ...mientras, ...filaAsistente } }, null, 2));
console.log(`\nCapturas en ${SHOTS}`);

tab.close();
cerrarTodo();

if (fallos > 0) {
  console.log(`verify:browser — ${fallos} fallo(s).`);
  process.exit(1);
}
console.log(`verify:browser — ${filas.length} mediciones sin scroll horizontal, ejes etiquetados, el botón «Lista de espera» en ${filasLista.length} casos, los textos del plano en ${filasTextos.length} zonas y el select de «Personas» en ${filasSelect.length} tamaños.`);
process.exit(0);
