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

function run(command: string, args: string[]): Promise<number> {
  return new Promise((res) => {
    const child = spawn(command, args, { env, cwd: ROOT, stdio: "ignore", shell: true });
    child.on("exit", (code) => res(code ?? 1));
  });
}
check("seed con usuarios de prueba", (await run("npx", ["tsx", "scripts/seed.ts"])) === 0);

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

async function http(
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
  const seedNames = [...new Set(seededRows.map((row) => row.customerName))];
  const seedPhonesAndNotes = [...new Set(seededRows.flatMap((row) => [row.phone, row.notes])
    .filter((value): value is string => typeof value === "string" && Boolean(value)))];
  const questionWithPrivateData = [
    "Dame el top de clientes",
    ...seedNames,
    ...seedPhonesAndNotes,
  ].join(" ");
  const messages = buildOpenRouterMessages(questionWithPrivateData, statistics, sensitiveValues);
  const serializedMessages = JSON.stringify(messages);
  const userContext = JSON.parse(messages[1].content) as { topClientes: { alias: string; grupos: number }[] };

  check("el cuerpo enviado a OpenRouter no contiene nombres de clientes del seed", seedNames.every((name) => !serializedMessages.includes(name)));
  check("el cuerpo enviado a OpenRouter no contiene teléfonos ni notas del seed", seedPhonesAndNotes.every((value) => !serializedMessages.includes(value)));
  check("el top enviado contiene alias y métricas, sin nombres", userContext.topClientes.every((customer) => /^Cliente \d+$/.test(customer.alias)));
  check("la respuesta restaura los alias solo para mostrar los nombres del top", statistics.topCustomers.length > 0 && restoreCustomerAliases("Cliente 1", statistics) === statistics.topCustomers[0].name);
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
