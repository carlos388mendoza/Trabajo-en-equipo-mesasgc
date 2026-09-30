// Verificación de autenticación y permisos (RBAC).
//
//   npm run verify:auth
//
// Levanta la app DE VERDAD (server.ts, con Next y Socket.IO) en un puerto
// libre, contra una base SQLite temporal (`.verify-auth.db`) con las
// migraciones del repo y el seed, y comprueba con peticiones HTTP y clientes
// Socket.IO reales:
//
//  - login correcto con los 5 usuarios de prueba e incorrecto con una
//    contraseña mala;
//  - que cada rol entra solo a lo suyo, por la página, por la API, por las
//    server actions y por el socket;
//  - que sin sesión todo da 401 o redirige a /login;
//  - que un usuario desactivado no puede entrar.
//
// La app de prueba compila en `.next-verify/` (gitignorada), así que puede
// correr mientras `npm run dev` sigue abierto. La primera vez tarda: Next
// compila cada ruta al pedirla.

import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";

import { io as ioClient, type Socket } from "socket.io-client";

const ROOT = process.cwd();
const DB_FILE = resolve(process.env.VERIFY_AUTH_DB_FILE ?? join(ROOT, ".verify-auth.db"));
const DIST_DIR = process.env.VERIFY_AUTH_DIST_DIR ?? ".next-verify";
const PASSWORD = "12345abc";

for (const suffix of ["", "-wal", "-shm"]) rmSync(DB_FILE + suffix, { force: true });

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
  BETTER_AUTH_SECRET: "verify-auth-secreto-solo-para-esta-prueba-000",
  BETTER_AUTH_URL: BASE,
  PORT: String(port),
  NEXT_DIST_DIR: DIST_DIR,
  // Sin clave: el asistente contesta en local y no gasta nada.
  OPENROUTER_API_KEY: "",
  NODE_ENV: "development",
};
Object.assign(process.env, env);

let passed = 0;
const failures: string[] = [];
function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FALLA ${name}${detail ? ` -> ${detail}` : ""}`);
  }
}
function section(title: string): void {
  console.log(`\n${title}`);
}

// ---------------------------------------------------------------------------
// Base de datos y app
// ---------------------------------------------------------------------------

section("Preparación");

const { applyAllMigrations } = await import("./migrations.mts");
await applyAllMigrations(`file:${DB_FILE}`);

function run(command: string, args: string[], extraEnv: Record<string, string> = {}): Promise<number> {
  return new Promise((res) => {
    const child = spawn(command, args, { env: { ...env, ...extraEnv }, cwd: ROOT, stdio: "ignore", shell: true });
    child.on("exit", (code) => res(code ?? 1));
  });
}
check("el seed se niega a correr con NODE_ENV=production", (await run("npx", ["tsx", "scripts/seed.ts"], { NODE_ENV: "production" })) !== 0);
check("seed con usuarios de prueba", (await run("npx", ["tsx", "scripts/seed.ts"])) === 0);
// reset-password solo pregunta en una terminal: sin ella (aquí stdin no es una
// TTY) se niega y no cambia nada. La contraseña de admin se sigue usando en
// los logins de abajo, así que si cambiara, esos fallarían.
check("reset-password sin terminal se niega a correr", (await run("npx", ["tsx", "scripts/reset-password.mts"])) !== 0);

let server: ChildProcess | null = null;
let serverLog = "";
async function startServer(): Promise<void> {
  server = spawn("npx", ["tsx", "server.ts"], {
    env,
    cwd: ROOT,
    shell: true,
    // Fuera de Windows, grupo propio para poder cerrar el árbol entero.
    detached: process.platform !== "win32",
  });
  server.stdout?.on("data", (d) => (serverLog += d));
  server.stderr?.on("data", (d) => (serverLog += d));
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    if (serverLog.includes("Table Waitlist en")) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`La app no arrancó a tiempo:\n${serverLog.slice(-2000)}`);
}
function stopServer(): void {
  if (!server?.pid) return;
  const pid = server.pid;
  server = null;
  // `shell: true` en Windows: hay que matar el árbol entero. Síncrono a
  // propósito: con `spawn`, el `process.exit` de después llegaba antes que el
  // taskkill y el servidor se quedaba vivo, con la base temporal bloqueada.
  if (process.platform === "win32") spawnSync("taskkill", ["/PID", String(pid), "/T", "/F"], { stdio: "ignore" });
  else process.kill(-pid, "SIGTERM");
}
process.on("exit", stopServer);

await startServer();
check(`la app arranca en el puerto ${port}`, true);

// ---------------------------------------------------------------------------
// Utilidades HTTP
// ---------------------------------------------------------------------------

type Res = { status: number; location: string | null; text: string; setCookie: string | null };

// Ninguna comprobación espera un 404: todas las rutas que se piden existen.
// Un 404 aquí es `next dev` compilando (o recompilando) esa ruta en ese
// momento, no la respuesta de la app. Se reintenta unas pocas veces; si una
// ruta de verdad no existiera, seguiría dando 404 y la comprobación fallaría.
const NOT_FOUND_RETRIES = 5;
const NOT_FOUND_WAIT_MS = 1_000;

async function http(
  method: string,
  path: string,
  options: { cookie?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Res> {
  let res = await httpOnce(method, path, options);
  for (let attempt = 1; res.status === 404 && attempt <= NOT_FOUND_RETRIES; attempt += 1) {
    await new Promise((r) => setTimeout(r, NOT_FOUND_WAIT_MS));
    res = await httpOnce(method, path, options);
  }
  return res;
}

async function httpOnce(
  method: string,
  path: string,
  { cookie, body, headers = {} }: { cookie?: string; body?: unknown; headers?: Record<string, string> } = {},
): Promise<Res> {
  const response = await fetch(BASE + path, {
    method,
    redirect: "manual",
    headers: {
      ...(body !== undefined && typeof body !== "string" ? { "Content-Type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      Origin: BASE,
      ...headers,
    },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  return {
    status: response.status,
    location: response.headers.get("location"),
    text: await response.text(),
    setCookie: response.headers.get("set-cookie"),
  };
}

async function login(email: string, password = PASSWORD): Promise<Res & { cookie: string }> {
  const res = await http("POST", "/api/auth/sign-in/email", { body: { email, password } });
  return { ...res, cookie: (res.setCookie ?? "").split(";")[0] };
}

/** Dónde termina una página: "200", "/login", "/sin-acceso", otra ruta... */
function landing(res: Res): string {
  if (res.status >= 300 && res.status < 400 && res.location) {
    const target = new URL(res.location, BASE);
    return target.pathname;
  }
  return String(res.status);
}

// ---------------------------------------------------------------------------
// Calentar las rutas
//
// `next dev` compila cada ruta la primera vez que se pide. Mientras compila
// puede contestar 404, y eso hacía fallar al azar las primeras comprobaciones
// de una ruta (típico: el PATCH de `/clientes/[clienteId]`). Se pide cada una
// una vez, sin sesión, hasta que deja de dar 404. Sin sesión, las páginas
// redirigen a /login y las API responden 401: no se escribe nada.
// ---------------------------------------------------------------------------

section("Calentar rutas");

const WARM_UP: [string, string][] = [
  ["GET", "/login"],
  ["GET", "/inicio"],
  ["GET", "/admin"],
  ["GET", "/analiticas"],
  ["GET", "/ajustes"],
  ["GET", "/sin-acceso"],
  ["GET", "/restaurante/rest_centro/rapido"],
  ["GET", "/restaurante/rest_centro/editor"],
  ["GET", "/mapa"],
  ["GET", "/restaurante/rest_centro/mapa"],
  ["GET", "/api/analiticas"],
  ["POST", "/api/assistant"],
  ["GET", "/api/restaurante/rest_centro/clientes"],
  ["PATCH", "/api/restaurante/rest_centro/clientes/wl_1"],
];
{
  const deadline = Date.now() + 120_000;
  const cold: string[] = [];
  for (const [method, path] of WARM_UP) {
    let res = await httpOnce(method, path, { body: method === "GET" ? undefined : {} });
    while (res.status === 404 && Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, NOT_FOUND_WAIT_MS));
      res = await httpOnce(method, path, { body: method === "GET" ? undefined : {} });
    }
    if (res.status === 404) cold.push(`${method} ${path}`);
  }
  check(`las ${WARM_UP.length} rutas responden antes de empezar`, cold.length === 0, cold.join(", "));
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

section("Login");

const USERS = {
  admin: "admin@grupocomidas.test",
  centro: "centro@grupocomidas.test",
  norte: "norte@grupocomidas.test",
  analitica: "analitica@grupocomidas.test",
  gerente: "gerente@grupocomidas.test",
} as const;
type Who = keyof typeof USERS;

const cookies = {} as Record<Who, string>;
for (const [who, email] of Object.entries(USERS) as [Who, string][]) {
  const res = await login(email);
  cookies[who] = res.cookie;
  check(`login correcto: ${email}`, res.status === 200 && res.cookie.includes("session_token"), `HTTP ${res.status}`);
}

{
  const res = await login(USERS.centro, "contrasena-mala");
  check("login con contraseña mala se rechaza (401)", res.status === 401 && !res.cookie, `HTTP ${res.status}`);
  const signUp = await http("POST", "/api/auth/sign-up/email", {
    body: { email: "nuevo@x.test", password: "12345abcd", name: "Nuevo" },
  });
  check("no hay registro público", signUp.status >= 400, `HTTP ${signUp.status}`);
}

// ---------------------------------------------------------------------------
// Páginas
// ---------------------------------------------------------------------------

section("Páginas (sin sesión)");

const PAGES = [
  "/inicio",
  "/admin",
  "/analiticas",
  "/ajustes",
  "/restaurante/rest_centro/rapido",
  "/restaurante/rest_centro/editor",
  "/restaurante/rest_norte/rapido",
  "/mapa",
  "/restaurante/rest_centro/mapa",
];
for (const page of PAGES) {
  const res = await http("GET", page);
  check(`sin sesión, ${page} redirige a /login`, landing(res) === "/login", landing(res));
}

section("Páginas por rol");

type Expect = Record<string, string>;
const EXPECTED: Record<Who, Expect> = {
  admin: {
    "/admin": "200",
    "/analiticas": "200",
    "/restaurante/rest_centro/rapido": "200",
    "/restaurante/rest_centro/editor": "200",
    "/restaurante/rest_norte/rapido": "200",
    "/restaurante/rest_norte/editor": "200",
    "/mapa": "200",
    "/restaurante/rest_norte/mapa": "200",
  },
  centro: {
    "/restaurante/rest_centro/rapido": "200",
    "/restaurante/rest_centro/editor": "200",
    "/restaurante/rest_norte/rapido": "/sin-acceso",
    "/restaurante/rest_norte/editor": "/sin-acceso",
    "/admin": "/sin-acceso",
    "/analiticas": "/sin-acceso",
    // Mapa: solo el plano en vivo del suyo.
    "/restaurante/rest_centro/mapa": "200",
    "/mapa": "/sin-acceso",
    "/restaurante/rest_norte/mapa": "/sin-acceso",
  },
  norte: {
    "/restaurante/rest_norte/rapido": "200",
    "/restaurante/rest_norte/editor": "200",
    "/restaurante/rest_centro/rapido": "/sin-acceso",
    "/restaurante/rest_centro/editor": "/sin-acceso",
    "/admin": "/sin-acceso",
    "/restaurante/rest_norte/mapa": "200",
    "/mapa": "/sin-acceso",
    "/restaurante/rest_centro/mapa": "/sin-acceso",
  },
  analitica: {
    "/analiticas": "200",
    "/mapa": "200",
    "/restaurante/rest_centro/mapa": "200",
    "/restaurante/rest_centro/rapido": "/sin-acceso",
    "/restaurante/rest_centro/editor": "/sin-acceso",
    "/admin": "/sin-acceso",
  },
  gerente: {
    "/restaurante/rest_centro/rapido": "200",
    "/restaurante/rest_centro/editor": "200",
    "/analiticas": "200",
    "/admin": "/sin-acceso",
    "/restaurante/rest_norte/rapido": "/sin-acceso",
    // Su rol analitica le da el mapa general (los permisos se suman).
    "/mapa": "200",
  },
};
for (const [who, pages] of Object.entries(EXPECTED) as [Who, Expect][]) {
  for (const [page, expected] of Object.entries(pages)) {
    const got = landing(await http("GET", page, { cookie: cookies[who] }));
    check(`${who}: ${page} -> ${expected}`, got === expected, got);
  }
}

section("Destino después del login (/inicio)");

{
  // Un solo rol entra directo; el gerente (dos roles) elige.
  const INICIO: Record<Who, string> = {
    admin: "/mapa",
    centro: "/restaurante/rest_centro/rapido",
    norte: "/restaurante/rest_norte/rapido",
    analitica: "/analiticas",
    gerente: "200",
  };
  for (const [who, expected] of Object.entries(INICIO) as [Who, string][]) {
    const res = await http("GET", "/inicio", { cookie: cookies[who] });
    check(`${who}: /inicio -> ${expected === "200" ? "elegir destino" : expected}`, landing(res) === expected, landing(res));
    if (who === "gerente") {
      check(
        "  gerente elige entre su restaurante y las estadísticas",
        res.text.includes("/restaurante/rest_centro/rapido") && res.text.includes("/analiticas") && !res.text.includes("/admin\""),
      );
    }
    if (who === "gerente") {
      check("  y entre ellos está el mapa general (su rol analitica)", res.text.includes("href=\"/mapa\""));
    }
  }
}

// ---------------------------------------------------------------------------
// API routes
// ---------------------------------------------------------------------------

section("API (sin sesión: 401)");

const ask = { question: "¿Qué día hubo menos espera?" };
const newGuest = { customerName: "Verify", partySize: 2 };
const API_NO_SESSION: [string, string, unknown?][] = [
  ["GET", "/api/analiticas"],
  ["POST", "/api/assistant", ask],
  ["GET", "/api/restaurante/rest_centro/clientes"],
  ["POST", "/api/restaurante/rest_centro/clientes", newGuest],
  ["PATCH", "/api/restaurante/rest_centro/clientes/wl_1", { status: "listo" }],
];
for (const [method, path, body] of API_NO_SESSION) {
  const res = await http(method, path, { body });
  check(`sin sesión, ${method} ${path} -> 401`, res.status === 401, `HTTP ${res.status}`);
}

section("Healthcheck de Railway");

{
  // El healthcheck es la ÚNICA API pública (excepción exacta en `proxy.ts`).
  // Mientras `next dev` compila la ruta puede dar 404: se reintenta un poco.
  let res = await http("GET", "/api/health");
  for (let i = 0; res.status === 404 && i < 10; i += 1) {
    await new Promise((r) => setTimeout(r, 1_000));
    res = await http("GET", "/api/health");
  }
  let body: unknown = null;
  try {
    body = JSON.parse(res.text);
  } catch {
    // Se comprueba abajo: si no es JSON, `body` se queda en null.
  }
  check("sin sesión, GET /api/health -> 200", res.status === 200, `HTTP ${res.status}`);
  check("  y responde {\"ok\":true}", JSON.stringify(body) === JSON.stringify({ ok: true }), res.text.slice(0, 80));
  for (const path of ["/api/healthz", "/api/health/x"]) {
    const other = await http("GET", path);
    check(`  la excepción es exacta: sin sesión, GET ${path} -> 401`, other.status === 401, `HTTP ${other.status}`);
  }
}

section("API por rol");

async function status(who: Who, method: string, path: string, body?: unknown): Promise<number> {
  return (await http(method, path, { cookie: cookies[who], body })).status;
}
const API: [Who, string, string, unknown, number][] = [
  ["analitica", "GET", "/api/analiticas", undefined, 200],
  ["analitica", "POST", "/api/assistant", ask, 200],
  ["analitica", "GET", "/api/restaurante/rest_centro/clientes", undefined, 403],
  ["analitica", "POST", "/api/restaurante/rest_centro/clientes", newGuest, 403],
  ["analitica", "PATCH", "/api/restaurante/rest_centro/clientes/wl_1", { status: "listo" }, 403],
  ["centro", "GET", "/api/restaurante/rest_centro/clientes", undefined, 200],
  ["centro", "POST", "/api/restaurante/rest_centro/clientes", newGuest, 201],
  ["centro", "GET", "/api/restaurante/rest_norte/clientes", undefined, 403],
  ["centro", "POST", "/api/restaurante/rest_norte/clientes", newGuest, 403],
  ["centro", "PATCH", "/api/restaurante/rest_norte/clientes/wl_4", { status: "listo" }, 403],
  ["centro", "GET", "/api/analiticas", undefined, 403],
  ["centro", "POST", "/api/assistant", ask, 403],
  ["norte", "GET", "/api/restaurante/rest_norte/clientes", undefined, 200],
  ["norte", "GET", "/api/restaurante/rest_centro/clientes", undefined, 403],
  ["gerente", "GET", "/api/restaurante/rest_centro/clientes", undefined, 200],
  ["gerente", "GET", "/api/analiticas", undefined, 200],
  ["gerente", "GET", "/api/restaurante/rest_norte/clientes", undefined, 403],
  ["admin", "GET", "/api/restaurante/rest_norte/clientes", undefined, 200],
  ["admin", "GET", "/api/analiticas", undefined, 200],
];
for (const [who, method, path, body, expected] of API) {
  const got = await status(who, method, path, body);
  check(`${who}: ${method} ${path} -> ${expected}`, got === expected, `HTTP ${got}`);
}

section("Privacidad del asistente con OpenRouter");

{
  const [{ getAnalytics }, { buildOpenRouterMessages, getAssistantSensitiveValues, restoreCustomerAliases }, { db }, { waitlistEntries }] = await Promise.all([
    import("@/lib/analytics/data"),
    import("@/lib/analytics/assistant-privacy"),
    import("@/lib/db"),
    import("@/lib/db/schema"),
  ]);
  const statistics = await getAnalytics();
  const sensitiveValues = await getAssistantSensitiveValues(statistics);
  const seededRows = await db.select({
    customerName: waitlistEntries.customerName,
    phone: waitlistEntries.phone,
    notes: waitlistEntries.notes,
  }).from(waitlistEntries);
  // La anonimización conoce a los clientes del período de las estadísticas
  // (los 14 días que ve el asistente), no a todo el historial del seed.
  const seedNames = [...new Set(seededRows.map((row) => row.customerName))]
    .filter((name) => sensitiveValues.includes(name));
  const seedPhonesAndNotes = [...new Set(seededRows.flatMap((row) => [row.phone, row.notes])
    .filter((value): value is string => typeof value === "string" && Boolean(value)))];
  const questionWithPrivateData = [
    "Dame el top de clientes. ¿Qué semana fue más lenta? El 2026-09-20 y el 2026-10-03. El martes fueron 25 minutos en China Wok.",
    ...seedNames,
    ...seedPhonesAndNotes,
  ].join(" ");
  const messages = buildOpenRouterMessages(questionWithPrivateData, statistics, sensitiveValues);
  const serializedMessages = JSON.stringify(messages);
  const userContext = JSON.parse(messages[1].content) as {
    pregunta: string;
    topClientes: { alias: string; grupos: number }[];
  };

  check("el cuerpo enviado a OpenRouter no contiene nombres de clientes del seed", seedNames.every((name) => !serializedMessages.includes(name)));
  check("el cuerpo enviado a OpenRouter no contiene teléfonos ni notas del seed", seedPhonesAndNotes.every((value) => !serializedMessages.includes(value)));
  check("la anonimización conserva intacta la palabra semana", userContext.pregunta.includes("¿Qué semana fue más lenta?"));
  check("la anonimización conserva intactas las fechas ISO", userContext.pregunta.includes("2026-09-20") && userContext.pregunta.includes("2026-10-03"));
  check("se conservan días de semana, cantidades de espera y nombres de marcas", userContext.pregunta.includes("martes fueron 25 minutos en China Wok"));
  check("Ana Torres no se filtra ni se reemplaza dentro de otra palabra", seedNames.includes("Ana Torres") && !serializedMessages.includes("Ana Torres") && userContext.pregunta.includes("semana"));
  check("el top enviado contiene alias y métricas, sin nombres", userContext.topClientes.every((customer) => /^Cliente \d+$/.test(customer.alias)));
  check("la respuesta restaura los alias solo para mostrar los nombres del top", statistics.topCustomers.length > 0 && restoreCustomerAliases("Cliente 1", statistics) === statistics.topCustomers[0].name);

  // Nombres y notas que contienen un día, una marca o una cantidad: antes se
  // apartaban esos términos primero y el dato completo salía sin anonimizar.
  const trickyStatistics = {
    ...statistics,
    topCustomers: [{ ...statistics.topCustomers[0], name: "Domingo Pérez" }, ...statistics.topCustomers.slice(1)],
  };
  const trickyValues = ["Martes Aguilar", "viene los viernes con 2 personas", "Kfc Martínez", "China", "9876-5432"];
  const trickyQuestion = "¿Cuántas veces vino Domingo Pérez? ¿Y Martes Aguilar? Nota: viene los viernes con 2 personas. Cliente Kfc Martínez, teléfono 9876 5432 grupos. ¿El domingo en China Wok Centro hubo 3 grupos?";
  const trickyMessages = buildOpenRouterMessages(trickyQuestion, trickyStatistics, [...sensitiveValues, ...trickyValues]);
  const trickySerialized = JSON.stringify(trickyMessages);
  const trickyQuestionSent = (JSON.parse(trickyMessages[1].content) as { pregunta: string }).pregunta;
  check("un cliente del top con nombre de día («Domingo Pérez») viaja como alias", !trickySerialized.includes("Domingo Pérez") && trickyQuestionSent.includes("vino Cliente 1?"));
  check("nombres y notas con días, marcas o cantidades no se envían", ["Martes Aguilar", "viene los viernes con 2 personas", "Kfc Martínez"].every((value) => !trickySerialized.includes(value)));
  check("un teléfono seguido de una cantidad tampoco se envía", !trickyQuestionSent.includes("9876"));
  check("el día, el restaurante y la cantidad sueltos se conservan", trickyQuestionSent.includes("¿El domingo en China Wok Centro hubo 3 grupos?"));
}

section("Marcas, ciudades y preguntas del asistente");

{
  const response = await http("GET", "/api/analiticas", { cookie: cookies.analitica });
  const data = JSON.parse(response.text) as {
    brandsAvailable: { id: string; name: string; accentColor: string }[];
    citiesAvailable: string[];
  };
  check("analíticas ofrece las cuatro marcas con color", data.brandsAvailable.length === 4 && data.brandsAvailable.every((brand) => /^#[0-9a-f]{6}$/i.test(brand.accentColor)));
  check("analíticas ofrece las dos ciudades del seed", data.citiesAvailable.includes("Tegucigalpa") && data.citiesAvailable.includes("San Pedro Sula"));

  const filtered = await http("GET", "/api/analiticas?brandId=brand_kfc&city=Tegucigalpa", { cookie: cookies.analitica });
  const filteredData = JSON.parse(filtered.text) as { restaurants: { brand: { id: string } | null; city: string | null }[] };
  check("filtros combinan restaurants.brand_id y restaurants.city", filtered.status === 200 && filteredData.restaurants.length > 0 && filteredData.restaurants.every((restaurant) => restaurant.brand?.id === "brand_kfc" && restaurant.city === "Tegucigalpa"));

  const brandAnswer = await http("POST", "/api/assistant", { cookie: cookies.gerente, body: { question: "¿Qué marca tiene más espera?" } });
  const cityAnswer = await http("POST", "/api/assistant", { cookie: cookies.gerente, body: { question: "Compara Tegucigalpa con San Pedro Sula" } });
  const restaurantAnswer = await http("POST", "/api/assistant", { cookie: cookies.gerente, body: { question: "Compara restaurantes" } });
  check("asistente responde qué marca tiene más espera sin OpenRouter", brandAnswer.status === 200 && /mayor espera promedio|No hay grupos sentados/.test(JSON.parse(brandAnswer.text).answer));
  check("asistente compara Tegucigalpa y San Pedro Sula sin OpenRouter", cityAnswer.status === 200 && JSON.parse(cityAnswer.text).answer.includes("Tegucigalpa") && JSON.parse(cityAnswer.text).answer.includes("San Pedro Sula"));
  check("comparación del asistente muestra marca y ciudad por restaurante", restaurantAnswer.status === 200 && /China Wok|KFC|Pizza Hut/.test(JSON.parse(restaurantAnswer.text).answer) && /Tegucigalpa|San Pedro Sula/.test(JSON.parse(restaurantAnswer.text).answer));
}

{
  // El límite del asistente cuenta por usuario: cambiar X-Forwarded-For ya no
  // sirve para saltarlo. La analítica ya hizo 1 pregunta arriba.
  const codes: number[] = [];
  for (let i = 0; i < 10; i++) {
    codes.push(
      (await http("POST", "/api/assistant", {
        cookie: cookies.analitica,
        body: ask,
        headers: { "X-Forwarded-For": `10.20.30.${i}` },
      })).status,
    );
  }
  check(
    "asistente: la pregunta 11 del mismo usuario da 429 aunque cambie la IP",
    codes.slice(0, 9).every((c) => c === 200) && codes[9] === 429,
    codes.join(","),
  );
  check("  otro usuario sigue pudiendo preguntar", (await status("gerente", "POST", "/api/assistant", ask)) === 200);
}

// ---------------------------------------------------------------------------
// Server actions (guardar el editor)
// ---------------------------------------------------------------------------

section("Server actions del editor");

/** Busca el id de una server action en el manifiesto de la app de prueba. */
function findActionId(exportName: string, fileHint = "editor"): string | null {
  const dir = join(ROOT, DIST_DIR);
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    if (!existsSync(current)) continue;
    for (const name of readdirSync(current)) {
      const full = join(current, name);
      if (statSync(full).isDirectory()) stack.push(full);
      else if (name === "server-reference-manifest.json") {
        const manifest = JSON.parse(readFileSync(full, "utf8")) as {
          node?: Record<string, { exportedName?: string; filename?: string }>;
        };
        for (const [id, entry] of Object.entries(manifest.node ?? {})) {
          if (entry.exportedName === exportName && (entry.filename ?? "").includes(fileHint)) return id;
        }
      }
    }
  }
  return null;
}

const saveId = findActionId("saveLayoutStructure");
check("se localiza la server action saveLayoutStructure", saveId !== null);

async function callSave(who: Who | null, restaurantId: string, layoutId: string): Promise<string> {
  const { getLayout } = await import("@/lib/db/queries/layouts");
  const layout = await getLayout(layoutId, restaurantId);
  const payload = {
    layoutId,
    restaurantId,
    width: layout?.width ?? 1200,
    height: layout?.height ?? 800,
    elements: (layout?.elements ?? []).map((e) => ({
      id: e.id,
      elementTypeId: e.elementTypeId,
      label: e.label,
      x: e.x,
      y: e.y,
      width: e.width,
      height: e.height,
      rotation: e.rotation,
      capacity: e.capacity,
    })),
  };
  const res = await http("POST", `/restaurante/${restaurantId}/editor`, {
    cookie: who ? cookies[who] : undefined,
    body: JSON.stringify([payload]),
    headers: {
      "Next-Action": saveId ?? "",
      "Content-Type": "text/plain;charset=UTF-8",
      Accept: "text/x-component",
    },
  });
  if (res.status >= 300 && res.status < 400) return `redirige a ${landing(res)}`;
  if (res.text.includes("No tienes permiso")) return "sin permiso";
  if (res.text.includes("Tu sesión terminó")) return "sin sesión";
  if (/"ok":true/.test(res.text)) return "guardado";
  return `HTTP ${res.status}`;
}

if (saveId) {
  check("analitica no puede guardar el editor", (await callSave("analitica", "rest_centro", "lay_centro_terraza")) === "sin permiso");
  check("centro no puede guardar el plano de rest_norte", (await callSave("centro", "rest_norte", "lay_norte_principal")) === "sin permiso");
  check("centro sí guarda el plano de rest_centro", (await callSave("centro", "rest_centro", "lay_centro_terraza")) === "guardado");
  check("sin sesión, guardar redirige a /login", (await callSave(null, "rest_centro", "lay_centro_terraza")) === "redirige a /login");
}

{
  // Detrás del proxy de Railway llega `x-forwarded-proto: https`. Cuando una
  // server action redirige, Next pide la página de destino a su propio
  // servidor; sin __NEXT_PRIVATE_ORIGIN la pedía por https al puerto interno,
  // que habla http («SSL wrong version number»), y caía a una redirección
  // normal con un error en el log. Se usa una sesión aparte de norte: cerrarla
  // no afecta a las de arriba.
  const signOutId = findActionId("signOutAction", "login");
  check("se localiza la server action signOutAction", signOutId !== null);
  if (signOutId) {
    const extra = (await login(USERS.norte)).cookie;
    const before = serverLog.length;
    const res = await http("POST", "/inicio", {
      cookie: extra,
      body: "[]",
      headers: { "Next-Action": signOutId, "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component", "X-Forwarded-Proto": "https" },
    });
    await new Promise((r) => setTimeout(r, 300));
    const log = serverLog.slice(before);
    check("una server action que redirige, detrás de https, responde bien", res.status === 200 || res.status === 303, `HTTP ${res.status}`);
    check("  y Next sigue la redirección por dentro, sin «failed to get redirect response»", !log.includes("failed to get redirect response"), log.slice(0, 300));
  }
}

// ---------------------------------------------------------------------------
// Mapa: quién ve nombres de clientes
// ---------------------------------------------------------------------------

section("Mapa: nombres de clientes");

// Los clientes sentados ahora en rest_centro (los sienta el seed).
const { db } = await import("@/lib/db");
const { waitlistEntries, tables: tablesTable, elementTypes } = await import("@/lib/db/schema");
const { and, eq, inArray, isNotNull, isNull } = await import("drizzle-orm");
const seatedAtCentro = await db
  .select({ id: waitlistEntries.id, name: waitlistEntries.customerName })
  .from(tablesTable)
  .innerJoin(waitlistEntries, eq(waitlistEntries.id, tablesTable.currentEntryId))
  .where(and(eq(tablesTable.restaurantId, "rest_centro"), isNotNull(tablesTable.currentEntryId)));
check("el seed deja clientes sentados en rest_centro", seatedAtCentro.length > 0, `${seatedAtCentro.length}`);

function mentionsAnyCustomer(text: string): boolean {
  return seatedAtCentro.some((c) => text.includes(c.name) || text.includes(c.id));
}

{
  const page = (who: Who) => http("GET", "/restaurante/rest_centro/mapa", { cookie: cookies[who] });
  check("centro ve los nombres en el plano en vivo de su restaurante", mentionsAnyCustomer((await page("centro")).text));
  check("admin ve los nombres en el plano en vivo", mentionsAnyCustomer((await page("admin")).text));
  check("analitica NO recibe nombres ni ids de clientes en la página del plano", !mentionsAnyCustomer((await page("analitica")).text));
}

const planId = findActionId("loadLivePlan", "mapa");
check("se localiza la server action loadLivePlan", planId !== null);

async function callPlan(who: Who, restaurantId: string): Promise<{ status: string; text: string }> {
  const res = await http("POST", "/mapa", {
    cookie: cookies[who],
    body: JSON.stringify([{ restaurantId }]),
    headers: { "Next-Action": planId ?? "", "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component" },
  });
  if (res.text.includes("No tienes permiso")) return { status: "sin permiso", text: res.text };
  if (/"ok":true/.test(res.text)) return { status: "ok", text: res.text };
  return { status: `HTTP ${res.status}`, text: res.text };
}

if (planId) {
  const analitica = await callPlan("analitica", "rest_centro");
  check("analitica pide el plano en vivo por la action", analitica.status === "ok", analitica.status);
  check("  y no trae nombres ni ids de clientes", !mentionsAnyCustomer(analitica.text));
  check("  pero sí las mesas ocupadas", analitica.text.includes('"currentEntryId":"oculto"'));
  const admin = await callPlan("admin", "rest_centro");
  check("admin recibe los nombres por la action", admin.status === "ok" && mentionsAnyCustomer(admin.text));
  check("centro no puede pedir el plano de rest_norte por la action", (await callPlan("centro", "rest_norte")).status === "sin permiso");
  check("gerente (restaurante + analitica) ve el plano de rest_norte sin nombres", (await callPlan("gerente", "rest_norte")).text.includes('"showNames":false'));
}

// ---------------------------------------------------------------------------
// Socket.IO
// ---------------------------------------------------------------------------

section("Socket.IO");

function connect(cookie?: string): Promise<Socket | null> {
  return new Promise((res) => {
    const socket = ioClient(BASE, {
      transports: ["websocket"],
      reconnection: false,
      extraHeaders: cookie ? { cookie } : {},
    });
    socket.once("connect", () => res(socket));
    socket.once("connect_error", () => res(null));
  });
}
async function emit(socket: Socket, event: string, payload: unknown): Promise<{ ok: boolean; error?: string }> {
  return socket.timeout(5000).emitWithAck(event, payload);
}

check("sin sesión, el socket no conecta", (await connect()) === null);
{
  const centro = await connect(cookies.centro);
  const norte = await connect(cookies.norte);
  const analitica = await connect(cookies.analitica);
  const admin = await connect(cookies.admin);
  check("los usuarios con sesión conectan", Boolean(centro && norte && analitica && admin));
  if (centro && norte && analitica && admin) {
    check("centro entra en la room de rest_centro", (await emit(centro, "restaurant:join", { restaurantId: "rest_centro" })).ok);
    check("centro NO entra en la room de rest_norte", !(await emit(centro, "restaurant:join", { restaurantId: "rest_norte" })).ok);
    await emit(centro, "restaurant:join", { restaurantId: "rest_centro" });
    check("norte NO entra en la room de rest_centro", !(await emit(norte, "restaurant:join", { restaurantId: "rest_centro" })).ok);
    check("analitica NO entra en ninguna room (no edita)", !(await emit(analitica, "restaurant:join", { restaurantId: "rest_centro" })).ok);
    check(
      "analitica no puede asignar mesas",
      !(await emit(analitica, "table:assign", { tableId: "tbl_c_1", entryId: "wl_1" })).ok,
    );
    check("admin entra en la room de rest_norte", (await emit(admin, "restaurant:join", { restaurantId: "rest_norte" })).ok);

    // Sala overview (mapa general): solo mapa:ver.
    const overviewCentro = await emit(centro, "overview:join", {});
    check("centro NO entra en la sala overview (socket)", !overviewCentro.ok, overviewCentro.error);
    const overviewAnalitica = (await emit(analitica, "overview:join", {})) as { ok: boolean; counters?: unknown[] };
    check("analitica entra en la sala overview", overviewAnalitica.ok && (overviewAnalitica.counters?.length ?? 0) === 8);
    check("  y el ack no trae datos de clientes", !mentionsAnyCustomer(JSON.stringify(overviewAnalitica)));
    check("admin entra en la sala overview", (await emit(admin, "overview:join", {})).ok);

    // Una mesa libre de verdad: el seed ya ocupa y reserva algunas.
    const [free] = await db
      .select({ id: tablesTable.id })
      .from(tablesTable)
      .innerJoin(elementTypes, eq(elementTypes.id, tablesTable.elementTypeId))
      .where(
        and(
          eq(tablesTable.restaurantId, "rest_centro"),
          isNull(tablesTable.currentEntryId),
          eq(tablesTable.status, "libre"),
          inArray(elementTypes.key, ["mesa-sillas", "mesa-butacas"]),
        ),
      )
      .limit(1);
    const got: unknown[] = [];
    centro.on("overview:counters", (c: unknown) => got.push(c));
    const countersAnalitica: unknown[] = [];
    analitica.on("overview:counters", (c: unknown) => countersAnalitica.push(c));
    const seat = await emit(centro, "table:assign", { tableId: free?.id ?? "", entryId: "wl_1" });
    check("centro sienta a un cliente en su restaurante", seat.ok, seat.error);
    await new Promise((r) => setTimeout(r, 400));
    check("  analitica recibe los contadores nuevos por la sala overview", countersAnalitica.length === 1);
    check("  sin datos del cliente", !JSON.stringify(countersAnalitica).includes("wl_1") && !JSON.stringify(countersAnalitica).includes("Ana Torres"));
    check("  centro no recibe los contadores de todos (no está en la sala)", got.length === 0);
  }
  for (const s of [centro, norte, analitica, admin]) s?.close();
}

// ---------------------------------------------------------------------------
// RBAC del enunciado: lo que no cubren las tablas de arriba
// ---------------------------------------------------------------------------

section("RBAC del enunciado");

{
  // 1. Solo el admin crea usuarios, y con uno o varios roles y restaurantes.
  //    Se llama a la server action directamente: esconder el botón no basta.
  const createId = findActionId("createUserAction", "admin");
  check("se localiza la server action createUserAction", createId !== null);
  const callCreate = async (who: Who, input: Record<string, unknown>) =>
    (await http("POST", "/admin", {
      cookie: cookies[who],
      body: JSON.stringify([input]),
      headers: { "Next-Action": createId ?? "", "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component" },
    })).text;
  const multi = {
    name: "Gerente de dos locales",
    email: "multi@grupocomidas.test",
    password: "clave-de-prueba-123",
    roles: ["restaurante", "analitica"],
    restaurantIds: ["rest_centro", "rest_norte"],
  };
  if (createId) {
    for (const who of ["centro", "analitica", "gerente"] as const) {
      const denied = await callCreate(who, { ...multi, email: `intruso-${who}@grupocomidas.test` });
      check(`${who} no puede crear usuarios (server action)`, denied.includes("No tienes permiso"));
    }
    check("admin crea un usuario con dos roles y dos restaurantes", /"ok":true/.test(await callCreate("admin", multi)));
    const { user: userTable, userRoles, userRestaurants } = await import("@/lib/db/schema");
    const [created] = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, multi.email));
    const roles = created ? (await db.select().from(userRoles).where(eq(userRoles.userId, created.id))).map((r) => r.role).sort() : [];
    const places = created ? (await db.select().from(userRestaurants).where(eq(userRestaurants.userId, created.id))).map((r) => r.restaurantId).sort() : [];
    check("  quedan sus dos roles y sus dos restaurantes", roles.join(",") === "analitica,restaurante" && places.join(",") === "rest_centro,rest_norte", `${roles} / ${places}`);
    const intruders = await db.select({ id: userTable.id }).from(userTable).where(inArray(userTable.email, ["intruso-centro@grupocomidas.test", "intruso-analitica@grupocomidas.test", "intruso-gerente@grupocomidas.test"]));
    check("  y ningún intento sin permiso creó un usuario", intruders.length === 0);

    const multiCookie = (await login(multi.email, multi.password)).cookie;
    const pages: [string, string][] = [
      ["/restaurante/rest_centro/rapido", "200"],
      ["/restaurante/rest_norte/editor", "200"],
      ["/analiticas", "200"],
      ["/restaurante/rest_tgu_kfc/rapido", "/sin-acceso"],
      ["/admin", "/sin-acceso"],
    ];
    for (const [page, expected] of pages) {
      const got = landing(await http("GET", page, { cookie: multiCookie }));
      check(`  el usuario nuevo: ${page} -> ${expected}`, got === expected, got);
    }
  }

  // 2. El admin entra a cualquier restaurante, no solo a los del seed de las
  //    tablas de arriba, y ve las analíticas de todos.
  for (const page of ["/restaurante/rest_tgu_kfc/rapido", "/restaurante/rest_sps_dennys/editor"]) {
    const got = landing(await http("GET", page, { cookie: cookies.admin }));
    check(`admin: ${page} -> 200`, got === "200", got);
  }
  const all = async (who: Who, query = "") =>
    JSON.parse((await http("GET", `/api/analiticas${query}`, { cookie: cookies[who] })).text) as { restaurants: { id: string }[] };
  check("admin ve las analíticas de los 8 restaurantes", (await all("admin")).restaurants.length === 8);
  check("analitica ve las analíticas de los 8 restaurantes", (await all("analitica")).restaurants.length === 8);
  const onlyNorte = await all("analitica", "?restaurantId=rest_norte");
  check("analitica filtra por restaurante", onlyNorte.restaurants.length === 1 && onlyNorte.restaurants[0].id === "rest_norte");
  const onlyKfc = await all("analitica", "?brandId=brand_kfc");
  check("analitica filtra por marca", onlyKfc.restaurants.length === 2 && onlyKfc.restaurants.every((r) => r.id.includes("kfc")));
  check("gerente: POST a la lista de rest_norte -> 403", (await status("gerente", "POST", "/api/restaurante/rest_norte/clientes", newGuest)) === 403);

  // 3. Socket.IO: el restaurante sale de la room, no del payload.
  const centro = await connect(cookies.centro);
  const analitica = await connect(cookies.analitica);
  const gerente = await connect(cookies.gerente);
  if (centro && analitica && gerente) {
    await emit(centro, "restaurant:join", { restaurantId: "rest_centro" });
    const [norteTable] = await db
      .select({ id: tablesTable.id })
      .from(tablesTable)
      .innerJoin(elementTypes, eq(elementTypes.id, tablesTable.elementTypeId))
      .where(and(eq(tablesTable.restaurantId, "rest_norte"), isNull(tablesTable.currentEntryId), inArray(elementTypes.key, ["mesa-sillas", "mesa-butacas"])))
      .limit(1);
    check("centro no puede sentar en una mesa de rest_norte (socket)", !(await emit(centro, "table:assign", { tableId: norteTable?.id ?? "", entryId: "wl_4" })).ok);
    check("centro no puede resolver un cliente de rest_norte (socket)", !(await emit(centro, "waitlist:resolve", { entryId: "wl_4", status: "listo" })).ok);
    const [wl4] = await db.select({ status: waitlistEntries.status }).from(waitlistEntries).where(eq(waitlistEntries.id, "wl_4"));
    check("  y el cliente de rest_norte sigue igual", wl4?.status === "esperando", wl4?.status);
    check("analitica no puede añadir a la lista de espera (socket)", !(await emit(analitica, "waitlist:add", { customerName: "Prueba", partySize: 2 })).ok);
    check("gerente entra en la room de rest_centro", (await emit(gerente, "restaurant:join", { restaurantId: "rest_centro" })).ok);
    check("gerente NO entra en la room de rest_norte", !(await emit(gerente, "restaurant:join", { restaurantId: "rest_norte" })).ok);
    check("gerente entra en la sala overview (su rol analitica)", (await emit(gerente, "overview:join", {})).ok);
  } else {
    check("los sockets de centro, analitica y gerente conectan", false);
  }
  for (const s of [centro, analitica, gerente]) s?.close();
}

// ---------------------------------------------------------------------------
// /admin: restablecer la contraseña y desactivar
// ---------------------------------------------------------------------------

section("Contraseña y desactivar desde /admin");

{
  // La interfaz pide la contraseña dos veces y una confirmación, pero lo que
  // vale es lo que hace el servidor: se llama a las actions directamente.
  const resetId = findActionId("resetPasswordAction", "admin");
  const activeId = findActionId("setActiveAction", "admin");
  check("se localizan resetPasswordAction y setActiveAction", resetId !== null && activeId !== null);
  const callAdmin = async (actionId: string | null, who: Who, payload: Record<string, unknown>) =>
    (await http("POST", "/admin", {
      cookie: cookies[who],
      body: JSON.stringify([payload]),
      headers: { "Next-Action": actionId ?? "", "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component" },
    })).text;
  const email = "multi@grupocomidas.test";
  const { user: userTable } = await import("@/lib/db/schema");
  const [target] = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, email));
  check("  el usuario de prueba existe (lo creó «RBAC del enunciado»)", Boolean(target));
  if (resetId && activeId && target) {
    const oldPassword = "clave-de-prueba-123";
    const newPassword = "clave-nueva-456789";
    const oldSession = (await login(email, oldPassword)).cookie;

    const mismatch = await callAdmin(resetId, "admin", { userId: target.id, password: newPassword, confirmPassword: "otra-cosa-123" });
    check("si las dos contraseñas no coinciden, el servidor no la cambia", mismatch.includes("no coinciden") && (await login(email, oldPassword)).status === 200);
    const missing = await callAdmin(resetId, "admin", { userId: target.id, password: newPassword });
    check("  ni si falta la repetición", !/"ok":true/.test(missing) && (await login(email, oldPassword)).status === 200);
    const denied = await callAdmin(resetId, "centro", { userId: target.id, password: newPassword, confirmPassword: newPassword });
    check("  ni si la pide alguien que no es admin", denied.includes("No tienes permiso") && (await login(email, oldPassword)).status === 200);

    const done = await callAdmin(resetId, "admin", { userId: target.id, password: newPassword, confirmPassword: newPassword });
    check("con las dos iguales, responde «Contraseña cambiada para <correo>»", done.includes(`Contraseña cambiada para ${email}`));
    check("  la vieja ya no entra y la nueva sí", (await login(email, oldPassword)).status === 401 && (await login(email, newPassword)).status === 200);
    check("  y la sesión que tenía abierta se cerró", landing(await http("GET", "/analiticas", { cookie: oldSession })) === "/login");

    const off = await callAdmin(activeId, "admin", { userId: target.id, active: false });
    check("desactivar responde bien y ya no puede entrar", /"ok":true/.test(off) && (await login(email, newPassword)).status !== 200);
    const offDenied = await callAdmin(activeId, "gerente", { userId: target.id, active: true });
    check("  un no-admin no puede reactivarlo", offDenied.includes("No tienes permiso") && (await login(email, newPassword)).status !== 200);
    const on = await callAdmin(activeId, "admin", { userId: target.id, active: true });
    check("  el admin lo reactiva y vuelve a entrar", /"ok":true/.test(on) && (await login(email, newPassword)).status === 200);
  }
}

// ---------------------------------------------------------------------------
// /admin: marcas y restaurantes
// ---------------------------------------------------------------------------

section("Marcas y restaurantes desde /admin");

{
  const ids = {
    brand: findActionId("createBrandAction", "catalog"),
    restaurant: findActionId("createRestaurantAction", "catalog"),
    active: findActionId("setRestaurantActiveAction", "catalog"),
    access: findActionId("updateAccessAction", "admin"),
  };
  check("se localizan las actions de marcas, restaurantes y accesos", Object.values(ids).every(Boolean));
  const call = async (actionId: string | null, who: Who, payload: Record<string, unknown>) =>
    (await http("POST", "/admin", {
      cookie: cookies[who],
      body: JSON.stringify([payload]),
      headers: { "Next-Action": actionId ?? "", "Content-Type": "text/plain;charset=UTF-8", Accept: "text/x-component" },
    })).text;
  const { brands: brandsTable, restaurants: restaurantsTable, tableLayouts, user: userTable, userRestaurants } = await import("@/lib/db/schema");

  if (Object.values(ids).every(Boolean)) {
    for (const who of ["centro", "analitica", "gerente"] as const) {
      check(`${who} no puede crear marcas (server action)`, (await call(ids.brand, who, { name: `Intrusa ${who}`, accentColor: "#111111" })).includes("No tienes permiso"));
    }
    check("  y no se creó ninguna", (await db.select().from(brandsTable).where(inArray(brandsTable.name, ["Intrusa centro", "Intrusa analitica", "Intrusa gerente"]))).length === 0);

    check("admin crea una marca", /"ok":true/.test(await call(ids.brand, "admin", { name: "Marca Verificada", accentColor: "#0EA5E9" })));
    const [brand] = await db.select().from(brandsTable).where(eq(brandsTable.name, "Marca Verificada"));
    check("  con el color en minúsculas", brand?.accentColor === "#0ea5e9");
    const payload = { name: "Local Verificado", brandId: brand?.id, city: "La Ceiba", latitude: 15.7597, longitude: -86.7822 };
    check("un host no puede crear restaurantes", (await call(ids.restaurant, "centro", payload)).includes("No tienes permiso"));
    check("  ni con una ubicación fuera de Honduras el admin", (await call(ids.restaurant, "admin", { ...payload, latitude: 40.4, longitude: -3.7 })).includes("Honduras"));
    check("admin crea un restaurante", /"ok":true/.test(await call(ids.restaurant, "admin", payload)));
    const [rest] = await db.select().from(restaurantsTable).where(eq(restaurantsTable.name, "Local Verificado"));
    check("  con su zona vacía", Boolean(rest) && (await db.select().from(tableLayouts).where(eq(tableLayouts.restaurantId, rest.id))).length === 1);

    if (rest) {
      const mapaHtml = (await http("GET", "/mapa", { cookie: cookies.admin })).text;
      check("  sale de inmediato en el mapa general", mapaHtml.includes("Local Verificado"));
      const stats = JSON.parse((await http("GET", "/api/analiticas", { cookie: cookies.analitica })).text) as { restaurantsAvailable: { id: string }[] };
      check("  y en las estadísticas", stats.restaurantsAvailable.some((r) => r.id === rest.id));
      check("  y en los accesos de /admin", (await http("GET", "/admin", { cookie: cookies.admin })).text.includes("Local Verificado"));

      // Se lo asigna a norte (conserva rest_norte) y norte entra.
      const [norte] = await db.select({ id: userTable.id }).from(userTable).where(eq(userTable.email, USERS.norte));
      const assigned = await call(ids.access, "admin", { userId: norte.id, roles: ["restaurante"], restaurantIds: ["rest_norte", rest.id] });
      check("admin se lo asigna a norte", /"ok":true/.test(assigned));
      check("  y norte entra a su modo sencillo", landing(await http("GET", `/restaurante/${rest.id}/rapido`, { cookie: cookies.norte })) === "200");

      check("un host no puede desactivar restaurantes", (await call(ids.active, "centro", { id: rest.id, active: false })).includes("No tienes permiso"));
      check("admin lo desactiva", /"ok":true/.test(await call(ids.active, "admin", { id: rest.id, active: false })));
      check("  norte deja de verlo (página)", landing(await http("GET", `/restaurante/${rest.id}/rapido`, { cookie: cookies.norte })) === "/sin-acceso");
      check("  ni por la API", (await status("norte", "GET", `/api/restaurante/${rest.id}/clientes`)) === 403);
      const sock = await connect(cookies.norte);
      check("  ni por el socket", sock !== null && !(await emit(sock, "restaurant:join", { restaurantId: rest.id })).ok);
      sock?.close();
      check("  pero sigue en rest_norte", landing(await http("GET", "/restaurante/rest_norte/rapido", { cookie: cookies.norte })) === "200");
      check("  sale del mapa general", !(await http("GET", "/mapa", { cookie: cookies.admin })).text.includes("Local Verificado"));
      const statsAfter = JSON.parse((await http("GET", "/api/analiticas", { cookie: cookies.analitica })).text) as { restaurantsAvailable: { id: string }[] };
      check("  y su historial sigue en las estadísticas", statsAfter.restaurantsAvailable.some((r) => r.id === rest.id));
      check("  no se borra ni él ni la asignación de norte",
        (await db.select().from(restaurantsTable).where(eq(restaurantsTable.id, rest.id))).length === 1 &&
        (await db.select().from(userRestaurants).where(and(eq(userRestaurants.userId, norte.id), eq(userRestaurants.restaurantId, rest.id)))).length === 1);
      // Editar los accesos de norte mientras está desactivado no le quita la asignación.
      await call(ids.access, "admin", { userId: norte.id, roles: ["restaurante"], restaurantIds: ["rest_norte"] });
      check("  y editar sus accesos mientras está desactivado tampoco la borra",
        (await db.select().from(userRestaurants).where(and(eq(userRestaurants.userId, norte.id), eq(userRestaurants.restaurantId, rest.id)))).length === 1);
      check("al reactivarlo, norte lo recupera", /"ok":true/.test(await call(ids.active, "admin", { id: rest.id, active: true })) &&
        landing(await http("GET", `/restaurante/${rest.id}/rapido`, { cookie: cookies.norte })) === "200");
      // Se deja todo como estaba para lo que sigue.
      await call(ids.access, "admin", { userId: norte.id, roles: ["restaurante"], restaurantIds: ["rest_norte"] });
      await db.delete(userRestaurants).where(and(eq(userRestaurants.userId, norte.id), eq(userRestaurants.restaurantId, rest.id)));
    }
  }
}

// ---------------------------------------------------------------------------
// Un usuario para varios restaurantes (el piloto: Denny's y Pizza Hut)
// ---------------------------------------------------------------------------

section("Un usuario de restaurante con los 4 locales de Denny's y Pizza Hut");

{
  // Lo crea el seed (usuario de prueba del piloto), con la contraseña de desarrollo.
  const four = ["rest_tgu_dennys", "rest_sps_dennys", "rest_norte", "rest_tgu_pizza"];
  const piloto = await login("dennys-pizzahut@grupocomidas.test");
  check("el seed crea el usuario del piloto y entra", piloto.status === 200 && piloto.cookie.includes("session_token"), `HTTP ${piloto.status}`);
  const cookie = piloto.cookie;
  const get = (path: string) => http("GET", path, { cookie });

  const inicio = await get("/inicio");
  check("/inicio no lo manda directo a un restaurante: elige", inicio.status === 200);
  // Se cuenta el texto entre etiquetas (`>…<`): el payload de React, en los
  // <script>, repite los mismos textos, pero entre comillas.
  const cards = (inicio.text.match(/>grupos? esperando</g) ?? []).length;
  check("  y ve las 4 tarjetas, con cuántos esperan en cada una", />Tus 4 restaurantes</.test(inicio.text) && cards === 4, `${cards} tarjetas`);
  check("  de sus restaurantes y de ninguno más", inicio.text.includes("Pizza Hut Los Próceres") && inicio.text.includes("Pizza Hut Norte") && !inicio.text.includes("China Wok Centro") && !inicio.text.includes("KFC Boulevard"));

  for (const id of four) {
    const rapido = landing(await get(`/restaurante/${id}/rapido`));
    const editor = landing(await get(`/restaurante/${id}/editor`));
    check(`  ${id}: modo sencillo y completo`, rapido === "200" && editor === "200", `${rapido} / ${editor}`);
  }
  for (const id of ["rest_centro", "rest_sps_kfc"]) {
    check(`  ${id} (otra marca) -> /sin-acceso`, landing(await get(`/restaurante/${id}/rapido`)) === "/sin-acceso");
  }
  const page = (await get("/restaurante/rest_norte/rapido")).text;
  check("en la cabecera tiene el selector de restaurante", page.includes("Cambiar de restaurante"));
  check("  que solo lista sus restaurantes", page.includes("Pizza Hut Los Próceres") && !page.includes("China Wok Centro") && !page.includes("KFC Río Piedras"));
  check("un host con un solo restaurante no tiene selector", !(await http("GET", "/restaurante/rest_centro/rapido", { cookie: cookies.centro })).text.includes("Cambiar de restaurante"));
  check("  ni el admin", !(await http("GET", "/restaurante/rest_centro/rapido", { cookie: cookies.admin })).text.includes("Cambiar de restaurante"));
  check("  y no ve /admin ni /mapa", landing(await get("/admin")) === "/sin-acceso" && landing(await get("/mapa")) === "/sin-acceso");
}

// ---------------------------------------------------------------------------
// Usuario desactivado
// ---------------------------------------------------------------------------

section("Usuario desactivado");

{
  const { findUserIdByEmail, setUserActive } = await import("@/lib/auth/users");
  const id = await findUserIdByEmail(USERS.norte);
  await setUserActive(id!, false);
  const res = await login(USERS.norte);
  check(
    "no puede iniciar sesión: 'Usuario desactivado'",
    res.status === 403 && res.text.includes("Usuario desactivado") && !res.cookie,
    `HTTP ${res.status} ${res.text.slice(0, 120)}`,
  );
  check(
    "su sesión anterior ya no abre páginas",
    landing(await http("GET", "/restaurante/rest_norte/rapido", { cookie: cookies.norte })) === "/login",
  );
  check("ni la API", (await status("norte", "GET", "/api/restaurante/rest_norte/clientes")) === 401);
  check("ni el socket", (await connect(cookies.norte)) === null);
}

// ---------------------------------------------------------------------------

stopServer();
console.log(`\n${passed} comprobaciones ok, ${failures.length} fallos`);
if (failures.length > 0) {
  console.log(`\nFallan: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("Autenticación y permisos verificados.");
process.exit(0);
