// Verificación de /analiticas en un navegador real (Chrome por CDP).
//
// Sirve para dos cosas que ningún `verify:*` puede ver:
//
//  - #60: que el gráfico «Volumen y tiempo de espera» lleva sus ejes
//    etiquetados («Clientes (grupos)» a la izquierda, «Minutos de espera» a
//    la derecha, «Día» debajo), la leyenda de series y tooltips con unidades.
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
  ejes: { izquierdo: boolean; derecho: boolean; x: boolean; leyenda: boolean; tooltips: boolean };
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
  if (fila.pasa && fila.pasaEstricto) continue;
  fallos += 1;
  console.log(`  ${fila.ancho} ${fila.tema}: scrollWidth=${fila.medicion.scrollWidth} inner=${fila.medicion.innerWidth} client=${fila.medicion.clientWidth}`);
  if (fila.tema !== "claro") continue;
  console.log("    hojas que empujan la página:");
  for (const d of fila.medicion.fuera) {
    console.log(`      <${d.tag} class="${d.cls}"> derecho=${d.derecho} ancho=${d.ancho} «${d.texto}»`);
  }
}

writeFileSync(join(DIR, "resultado.json"), JSON.stringify({ filas, ejes }, null, 2));
console.log(`\nCapturas en ${SHOTS}`);

tab.close();
cerrarTodo();

if (fallos > 0) {
  console.log(`verify:browser — ${fallos} fallo(s).`);
  process.exit(1);
}
console.log(`verify:browser — ${filas.length} mediciones sin scroll horizontal y ejes etiquetados.`);
process.exit(0);
