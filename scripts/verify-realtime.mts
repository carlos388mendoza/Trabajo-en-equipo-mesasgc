// Verificación del tiempo real y del bloqueo de mesas (pasos 5 y 6).
//
// Igual que `verify-editor.mts`: no hay runner de tests, así que es un script
// que sale con código 1 si algo falla. Se ejecuta con `npm run verify:realtime`.
//
// Qué cubre, y por qué:
//
//  - `assignTable` / `releaseTable` directamente: las reglas y, sobre todo,
//    las CARRERAS. Dos asignaciones lanzadas a la vez pasan las dos las
//    lecturas previas (ven la mesa libre), así que lo que se comprueba es que
//    el UPDATE condicional deje entrar a una sola.
//  - Un servidor Socket.IO de verdad en un puerto libre, con clientes de
//    verdad: rooms por restaurante, que el perdedor reciba el error solo él, y
//    que el restaurante salga de la room y no del payload.
//  - La sala `overview` del mapa general: solo entra quien tiene `mapa:ver`,
//    recibe contadores al sentar y liberar, y nunca datos de clientes.
//
// Usa una base SQLite temporal (`.verify-realtime.db`) con la migración real
// del repo. NO ejecuta `drizzle-kit push`, por lo mismo que `verify-editor`:
// leería el TURSO_DATABASE_URL del entorno y podría vaciar una base de verdad.

import { rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

import { config } from "dotenv";

// Antes de cualquier acceso a `db`, que lee la variable en el primer uso.
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });
const DB_FILE = resolve(process.cwd(), ".verify-realtime.db");
rmSync(DB_FILE, { force: true });
process.env.TURSO_DATABASE_URL = `file:${DB_FILE}`;
// Secreto solo de esta prueba: el handshake del socket firma y lee cookies.
process.env.BETTER_AUTH_SECRET = "verify-realtime-secret-solo-para-esta-prueba";
process.env.BETTER_AUTH_URL = "http://localhost:3000";

const { applyAllMigrations } = await import("./migrations.mts");
const { eq, inArray } = await import("drizzle-orm");
const { RealtimeClient } = await import("@/lib/realtime/client");
const { db } = await import("@/lib/db");
const { elementTypes, restaurants, tableLayouts, tables, waitlistEntries } = await import(
  "@/lib/db/schema"
);
const { assignTable, releaseTable } = await import("@/lib/tables/assign");
const { handleRealtimeGet, handleRealtimePost } = await import("@/lib/realtime/http");
const { allowedRooms } = await import("@/lib/realtime/handlers");
const { emitToRestaurant } = await import("@/lib/realtime/registry");
const { emitOverview } = await import("@/lib/realtime/overview");
const { getCounters, getRestaurantCounters, averageWaitMinutes, waitLevel } = await import("@/lib/map/counters");
type RestaurantCountersT = import("@/lib/realtime/events").RestaurantCounters;

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
// Esquema y datos
// ---------------------------------------------------------------------------

section("Esquema y datos de prueba");

const applied = await applyAllMigrations(`file:${DB_FILE}`);
check(`las migraciones del repo se aplican (${applied.length})`, applied.length > 0);

const REST = "rest-1";
const REST_2 = "rest-2";

await db.insert(restaurants).values([
  { id: REST, name: "Casa Nostra", slug: "casa-nostra" },
  { id: REST_2, name: "Bar Apuesto", slug: "bar-apuesto" },
]);
await db.insert(elementTypes).values([
  { id: "type-mesa", key: "mesa-sillas", label: "Mesa con sillas", color: "#3b82f6", icon: "utensils", defaultCapacity: 4, sortOrder: 0 },
  { id: "type-bano", key: "bano", label: "Baños", color: "#06b6d4", icon: "toilet", defaultCapacity: null, sortOrder: 1 },
]);
await db.insert(tableLayouts).values([
  { id: "layout-1", restaurantId: REST, name: "Comedor", isDefault: true },
  { id: "layout-2", restaurantId: REST_2, name: "Comedor", isDefault: true },
]);

const mesa = (id: string, restaurantId = REST, layoutId = "layout-1") => ({
  id,
  restaurantId,
  layoutId,
  elementTypeId: "type-mesa",
  label: id,
  capacity: 4,
});

await db.insert(tables).values([
  mesa("m1"),
  mesa("m2"),
  mesa("m3"),
  mesa("m-carrera"),
  mesa("m-multitud"),
  mesa("m-doble-a"),
  mesa("m-doble-b"),
  mesa("m-socket"),
  mesa("m-ajena", REST_2, "layout-2"),
  { ...mesa("bano-1"), elementTypeId: "type-bano", capacity: null },
]);

const cliente = (id: string, restaurantId = REST, status = "esperando") => ({
  id,
  restaurantId,
  customerName: id,
  partySize: 2,
  status,
});

await db.insert(waitlistEntries).values([
  cliente("ana"),
  cliente("luis"),
  cliente("pepa"),
  cliente("ausente", REST, "ausente"),
  cliente("de-fuera", REST_2),
  cliente("carrera-1"),
  cliente("carrera-2"),
  cliente("doble"),
  ...Array.from({ length: 10 }, (_, i) => cliente(`multitud-${i}`)),
  cliente("socket-a"),
  cliente("socket-b"),
  cliente("quick-resolve"),
]);
check("datos de partida insertados", true);

async function tableRow(id: string) {
  return db.query.tables.findFirst({ where: eq(tables.id, id) });
}
async function entryRow(id: string) {
  return db.query.waitlistEntries.findFirst({ where: eq(waitlistEntries.id, id) });
}

// ---------------------------------------------------------------------------
// Asignar
// ---------------------------------------------------------------------------

section("Asignar una mesa");

{
  const r = await assignTable({ restaurantId: REST, tableId: "m1", entryId: "ana", userId: "host-1" });
  check("una mesa libre se asigna", r.ok, r.ok ? "" : r.error);
  const t = await tableRow("m1");
  const e = await entryRow("ana");
  check("  la mesa apunta al cliente", t?.currentEntryId === "ana", `${t?.currentEntryId}`);
  check("  la mesa queda 'ocupada'", t?.status === "ocupada", t?.status);
  check("  la versión de la mesa sube a 2", t?.version === 2, `${t?.version}`);
  check("  el ack trae la versión nueva", r.ok && r.table.version === 2);
  check("  el cliente queda 'sentado'", e?.status === "sentado", e?.status);
  check("  con su mesa y su hora", e?.assignedTableId === "m1" && e?.seatedAt instanceof Date);
  check("  y quién lo sentó", e?.seatedByUserId === "host-1", `${e?.seatedByUserId}`);
}

{
  const r = await assignTable({ restaurantId: REST, tableId: "m1", entryId: "luis", userId: null });
  check(
    "una mesa ocupada se rechaza con 'Esta mesa ya fue asignada.'",
    !r.ok && r.code === "mesa_ocupada" && r.error === "Esta mesa ya fue asignada.",
    r.ok ? "la aceptó" : r.error,
  );
  check("  el cliente rechazado sigue esperando", (await entryRow("luis"))?.status === "esperando");
  check("  la mesa sigue siendo de Ana", (await tableRow("m1"))?.currentEntryId === "ana");
}

{
  const r = await assignTable({ restaurantId: REST, tableId: "m2", entryId: "ana", userId: null });
  check("un cliente ya sentado no se sienta en otra mesa", !r.ok && r.code === "cliente_no_disponible");
  check("  y esa otra mesa sigue libre", (await tableRow("m2"))?.currentEntryId === null);
}

{
  const r = await assignTable({ restaurantId: REST, tableId: "m2", entryId: "ausente", userId: null });
  check("un cliente 'ausente' no se puede sentar", !r.ok && r.code === "cliente_no_disponible");
}

{
  const r = await assignTable({ restaurantId: REST, tableId: "bano-1", entryId: "luis", userId: null });
  check("en un baño no se sienta a nadie", !r.ok && r.code === "no_es_mesa");
}

{
  const r = await assignTable({ restaurantId: REST, tableId: "m-ajena", entryId: "luis", userId: null });
  check("una mesa de otro restaurante 'no existe'", !r.ok && r.code === "mesa_no_existe");
  check("  y no se tocó", (await tableRow("m-ajena"))?.currentEntryId === null);
}

{
  const r = await assignTable({ restaurantId: REST, tableId: "m2", entryId: "de-fuera", userId: null });
  check("un cliente de otro restaurante 'no existe'", !r.ok && r.code === "cliente_no_existe");
}

{
  const r = await assignTable({ restaurantId: REST, tableId: "no-existe", entryId: "luis", userId: null });
  check("una mesa inventada 'no existe'", !r.ok && r.code === "mesa_no_existe");
}

// ---------------------------------------------------------------------------
// Carreras: lo que de verdad protege el bloqueo optimista
// ---------------------------------------------------------------------------

section("Carreras");

{
  // Las dos se lanzan antes de esperar a ninguna: las dos leen la mesa libre.
  const results = await Promise.all([
    assignTable({ restaurantId: REST, tableId: "m-carrera", entryId: "carrera-1", userId: null }),
    assignTable({ restaurantId: REST, tableId: "m-carrera", entryId: "carrera-2", userId: null }),
  ]);
  const winners = results.filter((r) => r.ok);
  const losers = results.filter((r) => !r.ok);
  check("dos hosts a la vez, misma mesa: gana exactamente uno", winners.length === 1, `ganaron ${winners.length}`);
  check(
    "  el otro recibe 'Esta mesa ya fue asignada.'",
    losers.length === 1 && !losers[0].ok && losers[0].code === "mesa_ocupada",
    JSON.stringify(losers),
  );
  const t = await tableRow("m-carrera");
  const winner = winners[0]?.ok ? winners[0].entryId : null;
  const loser = winner === "carrera-1" ? "carrera-2" : "carrera-1";
  check("  la mesa apunta al ganador", t?.currentEntryId === winner, `${t?.currentEntryId}`);
  check("  el perdedor sigue esperando", (await entryRow(loser))?.status === "esperando");
  check("  la versión subió una sola vez", t?.version === 2, `${t?.version}`);
}

{
  const results = await Promise.all(
    Array.from({ length: 10 }, (_, i) =>
      assignTable({ restaurantId: REST, tableId: "m-multitud", entryId: `multitud-${i}`, userId: null }),
    ),
  );
  const winners = results.filter((r) => r.ok).length;
  check("diez hosts a la vez, misma mesa: gana exactamente uno", winners === 1, `ganaron ${winners}`);
  const seated = await db.query.waitlistEntries.findMany({
    where: (w, { and, eq, like }) => and(like(w.id, "multitud-%"), eq(w.status, "sentado")),
  });
  check("  y solo un cliente quedó sentado", seated.length === 1, `${seated.length}`);
}

{
  // El mismo cliente en dos mesas a la vez (dos hosts lo llaman a la vez).
  const results = await Promise.all([
    assignTable({ restaurantId: REST, tableId: "m-doble-a", entryId: "doble", userId: null }),
    assignTable({ restaurantId: REST, tableId: "m-doble-b", entryId: "doble", userId: null }),
  ]);
  check("un cliente en dos mesas a la vez: solo entra en una", results.filter((r) => r.ok).length === 1);
  const a = await tableRow("m-doble-a");
  const b = await tableRow("m-doble-b");
  check(
    "  la otra mesa queda libre",
    [a?.currentEntryId, b?.currentEntryId].filter((x) => x === "doble").length === 1 &&
      [a?.currentEntryId, b?.currentEntryId].includes(null),
    `a=${a?.currentEntryId} b=${b?.currentEntryId}`,
  );
}

// ---------------------------------------------------------------------------
// Liberar
// ---------------------------------------------------------------------------

section("Liberar una mesa");

{
  const r = await releaseTable({ restaurantId: REST, tableId: "m1", entryId: "luis" });
  check("liberar con el cliente equivocado se rechaza", !r.ok && r.code === "mesa_cambio");
  check("  la mesa sigue ocupada por Ana", (await tableRow("m1"))?.currentEntryId === "ana");
}

{
  const r = await releaseTable({ restaurantId: REST_2, tableId: "m1", entryId: "ana" });
  check("liberar desde otro restaurante 'no existe'", !r.ok && r.code === "mesa_no_existe");
}

{
  const r = await releaseTable({ restaurantId: REST, tableId: "m1", entryId: "ana" });
  check("liberar con el cliente correcto funciona", r.ok, r.ok ? "" : r.error);
  const t = await tableRow("m1");
  const e = await entryRow("ana");
  check("  la mesa queda 'libre' y sin cliente", t?.status === "libre" && t?.currentEntryId === null);
  check("  su versión sube a 3", t?.version === 3, `${t?.version}`);
  check("  el cliente se queda 'sentado' (histórico)", e?.status === "sentado" && e?.assignedTableId === "m1");
}

{
  const r = await releaseTable({ restaurantId: REST, tableId: "m1", entryId: "ana" });
  check("liberar dos veces: la segunda se rechaza", !r.ok && r.code === "mesa_cambio");
}

{
  const r = await assignTable({ restaurantId: REST, tableId: "m1", entryId: "luis", userId: null });
  check("una mesa liberada se puede volver a asignar", r.ok, r.ok ? "" : r.error);
}

// ---------------------------------------------------------------------------
// Socket.IO de verdad
// ---------------------------------------------------------------------------

section("Tiempo real por HTTP: salas y avisos");

// La misma puerta que `app/api/tiempo-real/route.ts` (`lib/realtime/http.ts`),
// servida sin Next: un servidor HTTP mínimo que pasa cada petición a esas
// funciones. Así se prueba lo que corre en Vercel, con varias «pantallas»
// (clientes) que preguntan cada 40 ms en vez de cada 2 s.
const httpServer = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) if (typeof value === "string") headers.set(name, value);
  const request = new Request(`http://localhost${req.url}`, { method: req.method, headers, body: req.method === "POST" ? Buffer.concat(chunks) : undefined });
  const response = req.method === "POST" ? await handleRealtimePost(request) : await handleRealtimeGet(request);
  res.writeHead(response.status, { "content-type": "application/json" });
  res.end(await response.text());
});
await new Promise<void>((r) => httpServer.listen(0, r));
const url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;

type Client = InstanceType<typeof RealtimeClient>;
type AnyAck = { ok: boolean; error?: string };

/** Conecta con la cookie de sesión de `cookie` (o sin ella). */
function connect(cookie?: string): Promise<Client> {
  return new Promise((res, rej) => {
    const c = new RealtimeClient({ baseUrl: url, headers: cookie ? { cookie } : {}, fastMs: 40, slowMs: 40, maxBackoffMs: 200 });
    c.once("connect", () => res(c));
    c.once("connect_error", (err) => {
      c.disconnect();
      rej(err);
    });
    c.connect();
  });
}

// El handshake exige sesión de Better Auth: tres usuarios de prueba.
//  - hostA: admin (entra en cualquier restaurante).
//  - hostB: rol restaurante en REST.
//  - otro:  rol restaurante en REST_2.
const PASSWORD = process.env.SEED_PASSWORD || `Vf-${crypto.randomUUID()}`;
const { createUserWithPassword, setUserAccess, setUserActive } = await import("@/lib/auth/users");
const { getAuth } = await import("@/lib/auth/auth");
async function sessionCookie(email: string, roles: ("admin" | "restaurante" | "analitica")[], restaurantIds: string[]) {
  await createUserWithPassword({ name: email, email, password: PASSWORD, roles, restaurantIds });
  const res = await getAuth().api.signInEmail({
    body: { email, password: PASSWORD },
    returnHeaders: true,
  });
  return res.headers.get("set-cookie")?.split(";")[0] ?? "";
}
const cookieA = await sessionCookie("admin@verify.test", ["admin"], []);
const cookieB = await sessionCookie("rest1@verify.test", ["restaurante"], [REST]);
const cookieOtro = await sessionCookie("rest2@verify.test", ["restaurante"], [REST_2]);
const cookieAnalitica = await sessionCookie("analitica@verify.test", ["analitica"], []);

{
  const rejected = await connect().then(
    (c) => {
      c.close();
      return false;
    },
    () => true,
  );
  check("sin sesión, el socket no conecta", rejected);
}
async function ask(c: Client, event: string, payload: unknown): Promise<AnyAck> {
  return (await c.timeout(3000).emitWithAck(event as "restaurant:join", payload as never)) as AnyAck;
}
/** Cuenta los avisos que recibe un cliente. */
function counter(c: Client, event: string) {
  const got: unknown[] = [];
  c.on(event as "table:assigned", ((p: unknown) => got.push(p)) as never);
  return got;
}
const settle = () => new Promise((r) => setTimeout(r, 300));

const hostA = await connect(cookieA);
const hostB = await connect(cookieB);
const otro = await connect(cookieOtro);
const analitica = await connect(cookieAnalitica);
check("cuatro clientes conectados (HTTP con sondeo)", hostA.connected && hostB.connected && otro.connected && analitica.connected);

{
  // Un host no entra en la room de otro restaurante.
  const r = await ask(hostB, "restaurant:join", { restaurantId: REST_2 });
  check("un host de REST no entra en la room de REST_2", !r.ok && /acceso/.test(r.error ?? ""), r.error);
}

{
  const r = await ask(hostA, "table:assign", { tableId: "m-socket", entryId: "socket-a" });
  check("asignar sin haber entrado en un restaurante se rechaza", !r.ok && /Primero/.test(r.error ?? ""));
  const add = await ask(hostA, "waitlist:add", { customerName: "Sin room", partySize: 2 });
  check("waitlist:add sin restaurante unido se rechaza", !add.ok && /Primero/.test(add.error ?? ""));
}

{
  const r = await ask(hostA, "restaurant:join", { restaurantId: "no-existe" });
  check("entrar en un restaurante inexistente se rechaza", !r.ok);
  const bad = await ask(hostA, "restaurant:join", { restaurantId: 42 });
  check("un join con payload inválido se rechaza", !bad.ok);
}

check(
  "los tres entran en su restaurante",
  (await ask(hostA, "restaurant:join", { restaurantId: REST })).ok &&
    (await ask(hostB, "restaurant:join", { restaurantId: REST })).ok &&
    (await ask(otro, "restaurant:join", { restaurantId: REST_2 })).ok,
);

{
  const denied = await ask(analitica, "restaurant:join", { restaurantId: REST });
  check("analítica no puede entrar en la room operativa", !denied.ok && /acceso/.test(denied.error ?? ""));
  const add = await ask(analitica, "waitlist:add", { customerName: "No autorizado", partySize: 2 });
  const resolve = await ask(analitica, "waitlist:resolve", { entryId: "quick-resolve", status: "ausente" });
  const undo = await ask(analitica, "waitlist:undo", { actionId: "analitica-undo" });
  check("analítica sin acceso a room no modifica la lista con waitlist:*", !add.ok && !resolve.ok && !undo.ok);
  check("las filas siguen intactas tras los eventos de analítica", (await entryRow("quick-resolve"))?.status === "esperando");
}

{
  const changesA = counter(hostA, "waitlist:changed");
  const changesB = counter(hostB, "waitlist:changed");
  const changesOtro = counter(otro, "waitlist:changed");
  const undoStatesA = counter(hostA, "waitlist:undo-state");

  const invalid = await ask(hostA, "waitlist:add", {
    customerName: "",
    partySize: 2,
  });
  check("waitlist:add rechaza datos inválidos con Zod", !invalid.ok);

  const added = await ask(hostA, "waitlist:add", {
    customerName: "Grupo en vivo",
    partySize: 3,
    notes: "Carrito",
  }) as AnyAck & { entry?: { id: string; status: string }; actionId?: string };
  await settle();
  check("waitlist:add crea un grupo esperando y devuelve actionId", added.ok && added.entry?.status === "esperando" && Boolean(added.actionId));
  check("waitlist:add notifica ambas tablets del restaurante", changesA.length === 1 && changesB.length === 1);
  check("waitlist:add no notifica otra room", changesOtro.length === 0);
  check("waitlist:add publica el estado deshacible", undoStatesA.at(-1) != null);

  const undoneAdd = await ask(hostB, "waitlist:undo", {
    actionId: added.actionId,
  }) as AnyAck & { action?: string; entry?: { id: string } };
  await settle();
  check("waitlist:undo elimina el cliente que se agregó", undoneAdd.ok && undoneAdd.action === "removed" && (await entryRow(added.entry!.id)) === undefined);
  check("deshacer agregar llega a toda la room y no a otra", changesA.length === 2 && changesB.length === 2 && changesOtro.length === 0);

  const resolved = await ask(hostB, "waitlist:resolve", {
    entryId: "quick-resolve",
    status: "listo",
  }) as AnyAck & { entry?: { status: string }; actionId?: string };
  await settle();
  check("waitlist:resolve marca listo y emite cambio", resolved.ok && resolved.entry?.status === "listo" && changesA.length === 3 && changesB.length === 3);
  check("waitlist:resolve actualiza el estado en Turso", (await entryRow("quick-resolve"))?.status === "listo");

  const undoneResolve = await ask(hostA, "waitlist:undo", {
    actionId: resolved.actionId,
  }) as AnyAck & { action?: string; entry?: { status: string } };
  await settle();
  check("waitlist:undo restaura el estado anterior", undoneResolve.ok && undoneResolve.action === "restored" && undoneResolve.entry?.status === "esperando");
  check("waitlist:undo lo notifica a todos los hosts", changesA.length === 4 && changesB.length === 4);
  check("waitlist:undo restaura el dato en Turso", (await entryRow("quick-resolve"))?.status === "esperando");

  // Revocar el permiso mientras el socket ya está en la room: cada evento
  // debe volver a consultar RBAC, no confiar solo en el join inicial.
  const session = await getAuth().api.getSession({ headers: new Headers({ cookie: cookieB }) });
  // Cambiar a analítica mientras sigue conectado prueba una revocación real:
  // conserva la sesión, pero el rol ya no tiene permiso de modificar.
  await setUserAccess(session!.user.id, ["analitica"], []);
  const deniedAdd = await ask(hostB, "waitlist:add", { customerName: "Revocado", partySize: 2 });
  const deniedResolve = await ask(hostB, "waitlist:resolve", { entryId: "quick-resolve", status: "ausente" });
  const deniedUndo = await ask(hostB, "waitlist:undo", { actionId: "stale-but-valid" });
  check("waitlist:add exige permiso actualizado", !deniedAdd.ok && /permiso/.test(deniedAdd.error ?? ""));
  check("waitlist:resolve exige permiso actualizado", !deniedResolve.ok && /permiso/.test(deniedResolve.error ?? ""));
  check("waitlist:undo exige permiso actualizado", !deniedUndo.ok && /permiso/.test(deniedUndo.error ?? ""));
  check("sin permiso no se cambia la espera", (await entryRow("quick-resolve"))?.status === "esperando");
  await setUserAccess(session!.user.id, ["restaurante"], [REST]);

  const staleUndo = await ask(hostA, "waitlist:undo", { actionId: added.actionId });
  check("la misma acción no se puede deshacer dos veces", !staleUndo.ok);
}

// ---------------------------------------------------------------------------
// «Ver clientes»: quién resolvió, volver a la espera y deshacerlo
// ---------------------------------------------------------------------------

section("Ver clientes: volver a la espera");

{
  // Filas propias de esta sección, en REST; se borran al final para no mover
  // los contadores que se miden después.
  await db.insert(waitlistEntries).values([
    cliente("cartas-listo"),
    cliente("cartas-espera"),
    { ...cliente("cartas-sentado"), status: "sentado" },
  ]);
  const changesA = counter(hostA, "waitlist:changed");
  const changesB = counter(hostB, "waitlist:changed");
  const changesOtro = counter(otro, "waitlist:changed");
  const undoStates = counter(hostA, "waitlist:undo-state");

  type EntryAck = AnyAck & {
    entry?: { status: string; calledAt: number | null; resolvedAt: number | null; resolvedByName: string | null };
    actionId?: string;
    action?: string;
  };
  const resolved = (await ask(hostB, "waitlist:resolve", { entryId: "cartas-listo", status: "listo" })) as EntryAck;
  const resolvedRow = await entryRow("cartas-listo");
  const sessionB = await getAuth().api.getSession({ headers: new Headers({ cookie: cookieB }) });
  check(
    "waitlist:resolve guarda quién y cuándo lo resolvió",
    resolved.ok && resolvedRow?.resolvedByUserId === sessionB?.user.id && resolvedRow?.resolvedAt instanceof Date,
    JSON.stringify(resolvedRow?.resolvedByUserId),
  );
  check(
    "  y el aviso trae el nombre de quien lo resolvió",
    resolved.entry?.resolvedByName === "rest1@verify.test" && resolved.entry?.resolvedAt !== null,
    JSON.stringify(resolved.entry),
  );
  await settle();
  const before = { a: changesA.length, b: changesB.length, otro: changesOtro.length };

  const fromOther = await ask(otro, "waitlist:reopen", { entryId: "cartas-listo" });
  check("waitlist:reopen no toca un cliente de otro restaurante", !fromOther.ok && (await entryRow("cartas-listo"))?.status === "listo", fromOther.error);
  const fromAnalitica = await ask(analitica, "waitlist:reopen", { entryId: "cartas-listo" });
  check("analítica no puede volver a la espera a nadie", !fromAnalitica.ok && (await entryRow("cartas-listo"))?.status === "listo");
  const invalid = await ask(hostA, "waitlist:reopen", { entryId: "" });
  check("waitlist:reopen rechaza un payload inválido con Zod", !invalid.ok && /no válidos/.test(invalid.error ?? ""), invalid.error);
  const waitingAlready = await ask(hostA, "waitlist:reopen", { entryId: "cartas-espera" });
  check("un cliente que ya espera no se reabre", !waitingAlready.ok && /ya está en la espera/.test(waitingAlready.error ?? ""), waitingAlready.error);
  const seated = await ask(hostA, "waitlist:reopen", { entryId: "cartas-sentado" });
  check("un sentado no vuelve a la espera (tiene mesa)", !seated.ok && (await entryRow("cartas-sentado"))?.status === "sentado", seated.error);

  const reopened = (await ask(hostA, "waitlist:reopen", { entryId: "cartas-listo" })) as EntryAck;
  await settle();
  const reopenedRow = await entryRow("cartas-listo");
  check(
    "waitlist:reopen lo devuelve a la espera y devuelve actionId",
    reopened.ok && reopened.entry?.status === "esperando" && Boolean(reopened.actionId),
    reopened.error,
  );
  check(
    "  y borra el aviso, la hora y quién lo resolvió",
    reopenedRow?.status === "esperando" && reopenedRow.calledAt === null && reopenedRow.resolvedAt === null && reopenedRow.resolvedByUserId === null,
  );
  check(
    "  lo avisa a las dos tablets del restaurante como «reopened»",
    changesA.length === before.a + 1 && changesB.length === before.b + 1 && (changesB.at(-1) as { action?: string })?.action === "reopened",
  );
  check("  y no a otra room", changesOtro.length === before.otro);
  check(
    "  y se puede deshacer",
    /Volver a la espera/.test((undoStates.at(-1) as { label?: string } | null)?.label ?? ""),
    JSON.stringify(undoStates.at(-1)),
  );

  const undone = (await ask(hostB, "waitlist:undo", { actionId: reopened.actionId })) as EntryAck;
  await settle();
  const undoneRow = await entryRow("cartas-listo");
  check(
    "deshacer «volver a la espera» lo deja listo otra vez",
    undone.ok && undone.action === "restored" && undone.entry?.status === "listo" && undoneRow?.status === "listo",
    undone.error,
  );
  check(
    "  con su aviso y quién lo resolvió",
    undoneRow?.calledAt?.getTime() === resolvedRow?.calledAt?.getTime() && undoneRow?.resolvedByUserId === sessionB?.user.id && undone.entry?.resolvedByName === "rest1@verify.test",
  );
  check("  y llega a toda la room", changesA.length === before.a + 2 && changesOtro.length === before.otro);

  // El permiso se vuelve a mirar en cada evento, también en este.
  await setUserAccess(sessionB!.user.id, ["analitica"], []);
  const revoked = await ask(hostB, "waitlist:reopen", { entryId: "cartas-listo" });
  check("waitlist:reopen exige permiso actualizado", !revoked.ok && /permiso/.test(revoked.error ?? ""), revoked.error);
  await setUserAccess(sessionB!.user.id, ["restaurante"], [REST]);

  await db.delete(waitlistEntries).where(inArray(waitlistEntries.id, ["cartas-listo", "cartas-espera", "cartas-sentado"]));
}

{
  // La lectura de la vista: rangos en hora de Honduras y nombre del que resolvió.
  const { listWaitlistCards, rangeStart } = await import("@/lib/waitlist/cards");
  const { hondurasMidnightUtc, hondurasToday, addCalendarDays } = await import("@/lib/time/honduras");
  const now = new Date();
  const today = hondurasToday(now);
  const at = (daysAgo: number) => new Date(hondurasMidnightUtc(addCalendarDays(today, -daysAgo)).getTime() + 10 * 3_600_000);
  const sessionA = await getAuth().api.getSession({ headers: new Headers({ cookie: cookieA }) });
  await db.insert(waitlistEntries).values([
    { ...cliente("rango-hoy", REST, "listo"), arrivedAt: at(0), resolvedAt: at(0), resolvedByUserId: sessionA!.user.id },
    { ...cliente("rango-3dias", REST, "ausente"), arrivedAt: at(3) },
    { ...cliente("rango-6dias", REST, "ausente"), arrivedAt: at(6) },
    { ...cliente("rango-10dias", REST, "ausente"), arrivedAt: at(10) },
    { ...cliente("rango-espera-vieja", REST, "esperando"), arrivedAt: at(10) },
    { ...cliente("rango-ajeno", REST_2, "listo"), arrivedAt: at(0) },
  ]);
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id).filter((id) => id.startsWith("rango-"));
  const hoy = await listWaitlistCards(REST, "hoy", now);
  const semana = await listWaitlistCards(REST, "7dias", now);
  check("«hoy» empieza a la medianoche de Honduras", rangeStart("hoy", now).getTime() === hondurasMidnightUtc(today).getTime());
  check(
    "«hoy» trae las de hoy y las que siguen esperando, aunque sean de antes",
    JSON.stringify(ids(hoy).sort()) === JSON.stringify(["rango-espera-vieja", "rango-hoy"]),
    JSON.stringify(ids(hoy)),
  );
  check(
    "«7dias» trae hoy y los 6 días anteriores, no más",
    JSON.stringify(ids(semana).sort()) === JSON.stringify(["rango-3dias", "rango-6dias", "rango-espera-vieja", "rango-hoy"]),
    JSON.stringify(ids(semana)),
  );
  check("  ninguna de otro restaurante", !ids(semana).includes("rango-ajeno"));
  check("  la más reciente primero", ids(semana)[0] === "rango-hoy", JSON.stringify(ids(semana)));
  check(
    "  con el nombre de quien la resolvió",
    hoy.find((e) => e.id === "rango-hoy")?.resolvedByName === "admin@verify.test",
    JSON.stringify(hoy.find((e) => e.id === "rango-hoy")),
  );
  await db.delete(waitlistEntries).where(inArray(waitlistEntries.id, [
    "rango-hoy", "rango-3dias", "rango-6dias", "rango-10dias", "rango-espera-vieja", "rango-ajeno",
  ]));
}

{
  // «Ver clientes» paginado y filtrado en el servidor, y la lista ligera del
  // modo sencillo (solo lo activo, no el historial).
  const { queryWaitlistCards } = await import("@/lib/waitlist/cards");
  const { listQuickModeEntries } = await import("@/lib/waitlist/active");
  const { and, isNull, like } = await import("drizzle-orm");
  const { hondurasMidnightUtc, hondurasToday, addCalendarDays } = await import("@/lib/time/honduras");
  const now = new Date();
  const today = hondurasToday(now);
  const at = (daysAgo: number, minute = 0) => new Date(hondurasMidnightUtc(addCalendarDays(today, -daysAgo)).getTime() + 10 * 3_600_000 + minute * 60_000);
  const pag = Array.from({ length: 60 }, (_, i) => ({ ...cliente(`pag-${String(i).padStart(2, "0")}`, REST, "ausente"), arrivedAt: at(0, i) }));
  await db.insert(waitlistEntries).values([
    ...pag,
    { ...cliente("pag-viejo-sentado", REST, "sentado"), arrivedAt: at(40), seatedAt: at(40) },
    { ...cliente("pag-viejo-listo", REST, "listo"), arrivedAt: at(40) },
    { ...cliente("pag-viejo-ausente", REST, "ausente"), arrivedAt: at(40) },
    { ...cliente("pag-viejo-espera", REST, "esperando"), arrivedAt: at(40) },
    { ...cliente("pag-25dias", REST, "ausente"), arrivedAt: at(25) },
    { ...cliente("pag-José", REST, "ausente"), customerName: "José Núñez", arrivedAt: at(0, 90) },
  ]);
  const [libre] = await db.select({ id: tables.id }).from(tables).where(and(eq(tables.restaurantId, REST), isNull(tables.currentEntryId))).limit(1);
  if (libre) await db.update(tables).set({ currentEntryId: "pag-viejo-sentado", status: "ocupada" }).where(eq(tables.id, libre.id));
  const ids = (rows: { id: string }[]) => rows.map((r) => r.id).filter((id) => id.startsWith("pag-"));

  const p1 = await queryWaitlistCards(REST, { range: "hoy", filter: "todas" }, now);
  check("«Ver clientes» trae 50 por página y dice si hay más", p1.entries.length === 50 && p1.next !== null, `${p1.entries.length}, ${p1.next}`);
  const p2 = await queryWaitlistCards(REST, { range: "hoy", filter: "todas", before: (await import("@/lib/waitlist/card-options")).decodeCardCursor(p1.next) }, now);
  const juntos = [...p1.entries, ...p2.entries].map((e) => e.id);
  check("  «Ver más» trae el resto, sin repetir ninguno", new Set(juntos).size === juntos.length && juntos.length === p1.counts.todas, `${juntos.length} de ${p1.counts.todas}`);
  check("  la más reciente primero", p1.entries[0].arrivedAt >= p1.entries[49].arrivedAt);
  check(
    "en «hoy» salen siempre los que esperan, los listos y los que ocupan mesa, aunque sean de hace 40 días",
    ["pag-viejo-sentado", "pag-viejo-listo", "pag-viejo-espera"].every((id) => juntos.includes(id)) && !juntos.includes("pag-viejo-ausente"),
    JSON.stringify(ids([...p1.entries, ...p2.entries]).filter((id) => id.includes("viejo"))),
  );
  // #87: lo que pinta la tablet es «página del servidor + cola sin conexión»
  // (`applyOperations`, que devuelve por orden de llegada) reordenado con
  // `newestFirst`. Tiene que dar el MISMO orden que el servidor, poner arriba
  // al cliente que se acaba de agregar sin conexión, y «Ver más» no puede
  // repetir ni saltarse a nadie.
  const { applyOperations } = await import("@/lib/offline/apply");
  const { newestFirst } = await import("@/lib/waitlist/card-options");
  const orden = (list: { id: string }[]) => list.map((e) => e.id);
  const bajando = (list: { arrivedAt: number; id: string }[]) => list.every((e, i) => i === 0 || newestFirst(list[i - 1], e) < 0);
  check("#87: el orden del servidor es el mismo que `newestFirst` (también en empates de hora)", JSON.stringify(orden([...p1.entries, ...p2.entries])) === JSON.stringify(orden([...p1.entries, ...p2.entries].sort(newestFirst))));
  const recienLlegado = p1.entries[0].arrivedAt + 60_000;
  let paso = 0;
  const pendiente = (data: object) => ({ operationId: `op87-${++paso}`, userId: "u", restaurantId: REST, targetId: "x", label: "x", sequence: paso, createdAt: recienLlegado + paso, state: "pendiente" as const, attempts: 0, ...data });
  const cola = [
    pendiente({ action: "waitlist:add", data: { customerName: "Sin conexión", partySize: 2, notes: "", entryId: "pag-cola-nuevo", arrivedAt: recienLlegado } }),
    pendiente({ action: "waitlist:resolve", data: { entryId: "pag-viejo-espera", status: "listo" } }),
  ] as Parameters<typeof applyOperations>[1];
  const vista = (lista: typeof p1.entries) => [...applyOperations({ entries: lista, tables: [] }, cola, recienLlegado).entries].sort(newestFirst);
  const pagina1 = vista(p1.entries);
  check("  con la cola sin conexión aplicada, el cliente de hoy recién agregado sale primero", pagina1[0]?.id === "pag-cola-nuevo", orden(pagina1).slice(0, 3).join(", "));
  check("  y el resto sigue de lo más reciente a lo más viejo", bajando(pagina1) && pagina1.length === p1.entries.length + 1);
  // «Ver más» como lo hace la tablet: añade la página 2 sin repetir ids.
  const vistos = new Set(p1.entries.map((e) => e.id));
  const pagina2 = vista([...p1.entries, ...p2.entries.filter((e) => !vistos.has(e.id))]);
  const deUnaVez = await queryWaitlistCards(REST, { range: "hoy", filter: "todas", limit: 100 }, now);
  check(
    "  «Ver más» con la cola: sin repetidos ni huecos (igual que pedirlo todo de una vez, más el de la cola)",
    new Set(orden(pagina2)).size === pagina2.length && JSON.stringify(orden(pagina2).filter((id) => id !== "pag-cola-nuevo")) === JSON.stringify(orden(deUnaVez.entries)) && bajando(pagina2),
    `${pagina2.length} vs ${deUnaVez.entries.length}`,
  );
  check("  el cambio pendiente (marcar listo) se ve sin mover al cliente de su sitio", pagina2.find((e) => e.id === "pag-viejo-espera")?.status === "listo" && orden(pagina2).indexOf("pag-viejo-espera") === orden(deUnaVez.entries).indexOf("pag-viejo-espera") + 1);
  // El montón del modo sencillo y el abanico NO cambian: siguen por orden de llegada.
  const monton = applyOperations({ entries: await listQuickModeEntries(REST, now), tables: [] }, cola, recienLlegado).entries;
  check("  el modo sencillo y el abanico siguen por orden de llegada (el más antiguo primero)", monton.every((e, i) => i === 0 || monton[i - 1].arrivedAt <= e.arrivedAt) && monton.at(-1)?.id === "pag-cola-nuevo");

  const ocupando = await queryWaitlistCards(REST, { range: "hoy", filter: "ocupando" }, now);
  check("«Ocupando mesa» trae a quien ocupa una mesa, aunque sea viejo", !libre || (ids(ocupando.entries).includes("pag-viejo-sentado") && ocupando.counts.ocupando >= 1), JSON.stringify(ids(ocupando.entries)));
  const mes = await queryWaitlistCards(REST, { range: "30dias", filter: "ausente", limit: 100 }, now);
  check("«Últimos 30 días» llega a 25 días atrás, no a 40", ids(mes.entries).includes("pag-25dias") && !ids(mes.entries).includes("pag-viejo-ausente"));
  const todos = await queryWaitlistCards(REST, { range: "todos", filter: "ausente", limit: 100 }, now);
  check("«Todos» llega a lo de hace 40 días", ids(todos.entries).includes("pag-viejo-ausente"));
  const jose = await queryWaitlistCards(REST, { range: "hoy", filter: "todas", query: "jose nunez" }, now);
  check("buscar «jose nunez» encuentra a «José Núñez» (sin tildes ni mayúsculas)", JSON.stringify(ids(jose.entries)) === JSON.stringify(["pag-José"]), JSON.stringify(ids(jose.entries)));
  check("  y los conteos son los de la búsqueda", jose.counts.todas === 1 && jose.counts.ausente === 1, JSON.stringify(jose.counts));
  const ajenos = await queryWaitlistCards(REST_2, { range: "todos", filter: "todas", limit: 100 }, now);
  check("  ninguno de otro restaurante", ids(ajenos.entries).length === 0);

  const sencillo = ids(await listQuickModeEntries(REST, now));
  check("el modo sencillo carga lo activo y lo de hoy", ["pag-viejo-espera", "pag-viejo-listo", "pag-00"].every((id) => sencillo.includes(id)));
  check("  y a quien ocupa una mesa, aunque sea viejo", !libre || sencillo.includes("pag-viejo-sentado"));
  check("  pero no el historial (ausentes de otros días)", !sencillo.includes("pag-viejo-ausente") && !sencillo.includes("pag-25dias"), JSON.stringify(sencillo.filter((id) => id.includes("viejo") || id.includes("25"))));

  if (libre) await db.update(tables).set({ currentEntryId: null, status: "libre" }).where(eq(tables.id, libre.id));
  await db.delete(waitlistEntries).where(like(waitlistEntries.id, "pag-%"));
}

// ---------------------------------------------------------------------------
// «Ver clientes»: eliminar un cliente de la fila
// ---------------------------------------------------------------------------

section("Eliminar un cliente de la lista");

{
  await db.insert(waitlistEntries).values([
    cliente("borrar-espera"),
    cliente("borrar-oculto"),
    { ...cliente("borrar-demo"), isDemo: true, demoBatchId: "demo_test" },
    { ...cliente("borrar-ajeno"), restaurantId: REST_2 },
    { ...cliente("borrar-sentado"), status: "sentado" },
  ]);
  await db.update(tables).set({ currentEntryId: "borrar-sentado", status: "ocupada" }).where(eq(tables.id, "m3"));

  type DelAck = AnyAck & {
    entry?: { id: string; customerName: string; status: string };
    actionId?: string;
    action?: string;
  };
  const changesA = counter(hostA, "waitlist:changed");
  const changesB = counter(hostB, "waitlist:changed");
  const changesOtro = counter(otro, "waitlist:changed");
  const undoStates = counter(hostA, "waitlist:undo-state");
  await settle();
  const before = { a: changesA.length, b: changesB.length, otro: changesOtro.length };

  const bad = await ask(hostA, "waitlist:delete", { entryId: "" });
  check("waitlist:delete rechaza un payload inválido con Zod", !bad.ok && /no válidos/.test(bad.error ?? ""), bad.error);

  const seated = await ask(hostA, "waitlist:delete", { entryId: "borrar-sentado" });
  check("un cliente con mesa no se elimina: «Este cliente está en la … Primero libera la mesa…»", !seated.ok && /^Este cliente está en la .+\. Primero libera la mesa para poder eliminarlo\.$/.test(seated.error ?? ""), seated.error);
  check("  y sigue sentado, con su mesa", (await entryRow("borrar-sentado"))?.status === "sentado" && (await tableRow("m3"))?.currentEntryId === "borrar-sentado");
  check("  la mesa no se toca", (await tableRow("m3"))?.status === "ocupada", (await tableRow("m3"))?.status);

  // `borrar-ajeno` es de REST_2 y `hostA` está en la room de REST: el borrado
  // va siempre al restaurante del socket, así que ni lo ve.
  const fromOther = await ask(hostA, "waitlist:delete", { entryId: "borrar-ajeno" });
  check(
    "waitlist:delete no toca un cliente de otro restaurante",
    !fromOther.ok && (await db.query.waitlistEntries.findFirst({ where: eq(waitlistEntries.id, "borrar-ajeno") })) !== undefined,
    fromOther.error,
  );

  // El host de OTRO restaurante (está en la room de REST_2) manda el id de un
  // cliente de REST: se busca en su restaurante, no lo encuentra y no borra.
  const fromOtherHost = await ask(otro, "waitlist:delete", { entryId: "borrar-espera" });
  check(
    "el host de otro restaurante no puede borrar un cliente ajeno",
    !fromOtherHost.ok && (await entryRow("borrar-espera")) !== undefined,
    fromOtherHost.error,
  );
  check("  y nadie recibe un aviso de borrado", changesA.length === before.a && changesB.length === before.b && changesOtro.length === before.otro);

  const fromAnalitica = await ask(analitica, "waitlist:delete", { entryId: "borrar-espera" });
  check("analítica no puede eliminar a nadie", !fromAnalitica.ok && (await entryRow("borrar-espera")) !== undefined, fromAnalitica.error);

  const missing = await ask(hostA, "waitlist:delete", { entryId: "no-existe" });
  check("un cliente que no existe 'no existe'", !missing.ok && /no existe/.test(missing.error ?? ""), missing.error);

  // Un cliente de DEMOSTRACIÓN se borra como cualquier otro: a veces hay que
  // limpiar una carta de mentira. Y al deshacer vuelve con su lote intacto,
  // que es justo lo que no puede pasar en producción. Se borra y se deshace
  // aquí seguido porque el «deshacer» es de una sola acción a la vez: el
  // borrado siguiente taparía el registro.
  const demo = (await ask(hostA, "waitlist:delete", { entryId: "borrar-demo" })) as DelAck;
  await settle();
  check("un cliente de demostración también se elimina", demo.ok && (await entryRow("borrar-demo")) === undefined, demo.error);
  const undoneDemo = (await ask(hostA, "waitlist:undo", { actionId: demo.actionId })) as DelAck;
  await settle();
  const backDemo = await entryRow("borrar-demo");
  check(
    "  y al deshacer vuelve con su is_demo y su lote intactos: el lote demo sigue valiendo",
    undoneDemo.ok && undoneDemo.action === "restored" && backDemo?.isDemo === true && backDemo?.demoBatchId === "demo_test",
    JSON.stringify(backDemo),
  );

  const done = (await ask(hostB, "waitlist:delete", { entryId: "borrar-espera" })) as DelAck;
  await settle();
  check(
    "waitlist:delete quita al cliente y devuelve actionId",
    done.ok && done.entry?.id === "borrar-espera" && Boolean(done.actionId) && (await entryRow("borrar-espera")) === undefined,
    done.error,
  );
  check(
    "  lo avisa a las dos tablets como «removed», que es lo que ya saben quitar de la pantalla",
    changesA.length === before.a + 3 && changesB.length === before.b + 3 && (changesB.at(-1) as { action?: string })?.action === "removed",
    `A=${changesA.length} B=${changesB.length}`,
  );
  check("  y no a otra room", changesOtro.length === before.otro);
  check("  y se puede deshacer, con el nombre del cliente", /borrar-espera/.test((undoStates.at(-1) as { label?: string } | null)?.label ?? ""), JSON.stringify(undoStates.at(-1)));

  const undone = (await ask(hostA, "waitlist:undo", { actionId: done.actionId })) as DelAck;
  await settle();
  const back = await entryRow("borrar-espera");
  check(
    "deshacer «eliminar» lo devuelve entero a la lista",
    undone.ok && undone.action === "restored" && undone.entry?.id === "borrar-espera" && back !== undefined,
    undone.error,
  );
  check("  con sus mismos datos", back?.customerName === "borrar-espera" && back?.partySize === 2 && back?.status === "esperando", JSON.stringify(back));

  const again = await ask(hostA, "waitlist:undo", { actionId: done.actionId });
  check("la misma eliminación no se puede deshacer dos veces", !again.ok, again.error);

  // Un cliente marcado «listo» en otra tablet SÍ se puede borrar: el borrado
  // no depende del estado. La carrera de verdad (la fila cambia entre leerla
  // y borrarla) no se puede provocar desde fuera, así que lo que se comprueba
  // aquí es que un cambio de estado previo no estorba.
  await resolveViaDb("borrar-oculto");
  const afterResolve = (await ask(hostA, "waitlist:delete", { entryId: "borrar-oculto" })) as DelAck;
  await settle();
  check(
    "un cliente ya resuelto también se elimina",
    afterResolve.ok && (await entryRow("borrar-oculto")) === undefined,
    afterResolve.error,
  );

  // El permiso se mira en cada evento, también aquí.
  const sessionB = await getAuth().api.getSession({ headers: new Headers({ cookie: cookieB }) });
  await setUserAccess(sessionB!.user.id, ["analitica"], []);
  const revoked = await ask(hostB, "waitlist:delete", { entryId: "borrar-espera" });
  check("waitlist:delete exige permiso actualizado", !revoked.ok && /permiso/.test(revoked.error ?? ""), revoked.error);
  check("  y no se borra nada", (await entryRow("borrar-espera")) !== undefined);
  await setUserAccess(sessionB!.user.id, ["restaurante"], [REST]);
  await db.delete(waitlistEntries).where(inArray(waitlistEntries.id, ["borrar-espera", "borrar-oculto", "borrar-demo", "borrar-ajeno", "borrar-sentado"]));
  await db.update(tables).set({ currentEntryId: null, status: "libre" }).where(eq(tables.id, "m3"));
}

// ---------------------------------------------------------------------------
// Agregar varios clientes de una vez
// ---------------------------------------------------------------------------

section("Agregar varios clientes de una vez");

{
  const { parseGuestList } = await import("@/lib/waitlist/guest-list");
  const parsed = parseGuestList("Ana Torres, 4\n\nLuis Ríos; 2; silla para bebé\nsin número\nGrupo grande, 12\nMarta\t3");
  check(
    "«Pegar lista» entiende «Nombre, personas», con nota, punto y coma o tabulador",
    JSON.stringify(parsed.rows) === JSON.stringify([
      { name: "Ana Torres", party: 4, note: "" },
      { name: "Luis Ríos", party: 2, note: "silla para bebé" },
      { name: "Marta", party: 3, note: "" },
    ]),
    JSON.stringify(parsed.rows),
  );
  check(
    "  y marca las líneas que no entiende, con su número",
    JSON.stringify(parsed.errors.map((e) => e.line)) === JSON.stringify([4, 5]),
    JSON.stringify(parsed.errors),
  );
}

{
  type ManyAck = AnyAck & { entries?: { id: string; customerName: string; arrivedAt: number; status: string }[]; actionId?: string };
  const changesA = counter(hostA, "waitlist:changed");
  const changesB = counter(hostB, "waitlist:changed");
  const changesOtro = counter(otro, "waitlist:changed");
  const names = ["Lote 1", "Lote 2", "Lote 3", "Lote 4"];
  const restRows = async () => (await db.query.waitlistEntries.findMany({ where: eq(waitlistEntries.restaurantId, REST) }))
    .filter((row) => row.customerName.startsWith("Lote") || row.customerName.startsWith("Mal"));

  const added = (await ask(hostB, "waitlist:add-many", {
    entries: names.map((customerName, i) => ({ customerName, partySize: i + 1, notes: i === 0 ? "Ventana" : "" })),
  })) as ManyAck;
  await settle();
  const rows = (await restRows()).sort((a, b) => a.arrivedAt.getTime() - b.arrivedAt.getTime());
  check("waitlist:add-many crea a todos, esperando, y devuelve actionId", added.ok && added.entries?.length === 4 && Boolean(added.actionId) && rows.length === 4, added.error);
  check(
    "  en el orden de las filas (hora de llegada creciente)",
    JSON.stringify(rows.map((r) => r.customerName)) === JSON.stringify(names) && new Set(rows.map((r) => r.arrivedAt.getTime())).size === 4,
  );
  check("  con sus personas y notas", rows[0]?.partySize === 1 && rows[0]?.notes === "Ventana" && rows[3]?.partySize === 4 && rows[3]?.notes === null);
  check(
    "  llegan los 4 avisos «added» a las dos tablets, en orden",
    changesA.length === 4 && changesB.length === 4
      && JSON.stringify(changesB.map((c) => (c as { entry: { customerName: string } }).entry.customerName)) === JSON.stringify(names),
    `A=${changesA.length} B=${changesB.length}`,
  );
  check("  y ninguno a otra room", changesOtro.length === 0);

  const undone = (await ask(hostA, "waitlist:undo", { actionId: added.actionId })) as AnyAck & { action?: string; entries?: unknown[] };
  await settle();
  check("deshacer «agregar varios» los quita a todos de una vez", undone.ok && undone.action === "removed" && undone.entries?.length === 4 && (await restRows()).length === 0, undone.error);
  check("  y avisa la baja de cada uno a la room", changesB.length === 8 && changesOtro.length === 0, `${changesB.length}`);

  // Si otro host ya resolvió a uno, deshacer no quita a ninguno.
  const again = (await ask(hostB, "waitlist:add-many", {
    entries: [{ customerName: "Lote A", partySize: 2 }, { customerName: "Lote B", partySize: 2 }],
  })) as ManyAck;
  const [firstOfBatch] = again.entries ?? [];
  await resolveViaDb(firstOfBatch?.id ?? "");
  const blocked = await ask(hostA, "waitlist:undo", { actionId: again.actionId });
  check("  pero si uno ya cambió, no quita a ninguno", !blocked.ok && (await restRows()).length === 2, blocked.error);
  await db.delete(waitlistEntries).where(inArray(waitlistEntries.id, (again.entries ?? []).map((e) => e.id)));

  // Todo o nada: una fila mala tumba el lote entero.
  const bad = await ask(hostB, "waitlist:add-many", {
    entries: [{ customerName: "Mal 1", partySize: 2 }, { customerName: "", partySize: 2 }],
  });
  check("una fila inválida rechaza el lote y no guarda ninguna", !bad.ok && (await restRows()).length === 0, bad.error);
  const tooMany = await ask(hostB, "waitlist:add-many", {
    entries: Array.from({ length: 31 }, (_, i) => ({ customerName: `Mal ${i}`, partySize: 2 })),
  });
  check("más de 30 de una vez se rechaza", !tooMany.ok && /hasta 30/.test(tooMany.error ?? "") && (await restRows()).length === 0, tooMany.error);
  const empty = await ask(hostB, "waitlist:add-many", { entries: [] });
  check("un lote vacío se rechaza", !empty.ok);
  const fromAnalitica = await ask(analitica, "waitlist:add-many", { entries: [{ customerName: "Mal analitica", partySize: 2 }] });
  check("analítica no puede agregar varios", !fromAnalitica.ok && (await restRows()).length === 0);

  const session = await getAuth().api.getSession({ headers: new Headers({ cookie: cookieB }) });
  await setUserAccess(session!.user.id, ["analitica"], []);
  const revoked = await ask(hostB, "waitlist:add-many", { entries: [{ customerName: "Mal revocado", partySize: 2 }] });
  check("waitlist:add-many exige permiso actualizado", !revoked.ok && /permiso/.test(revoked.error ?? ""), revoked.error);
  await setUserAccess(session!.user.id, ["restaurante"], [REST]);
}

/** Simula que otro host marcó listo a un cliente, sin pasar por el deshacer. */
async function resolveViaDb(id: string) {
  await db.update(waitlistEntries).set({ status: "listo", updatedAt: new Date(Date.now() + 1000) }).where(eq(waitlistEntries.id, id));
}

{
  const r = await ask(hostA, "table:assign", { tableId: "", entryId: null });
  check("un payload de asignación inválido se rechaza", !r.ok && /no válidos/.test(r.error ?? ""));
}

{
  // Un cliente fabricado que no manda ack no tumba el servidor.
  hostA.emit("table:assign", { tableId: "m2", entryId: "pepa" } as never);
  await settle();
  check("un evento sin ack no rompe el servidor", hostA.connected);
  // Se deshace para que no afecte a lo siguiente.
  await releaseTable({ restaurantId: REST, tableId: "m2", entryId: "pepa" });
}

{
  const assignedA = counter(hostA, "table:assigned");
  const assignedB = counter(hostB, "table:assigned");
  const assignedOtro = counter(otro, "table:assigned");

  const [ra, rb] = await Promise.all([
    ask(hostA, "table:assign", { tableId: "m-socket", entryId: "socket-a" }),
    ask(hostB, "table:assign", { tableId: "m-socket", entryId: "socket-b" }),
  ]);
  await settle();

  check("dos hosts por socket, misma mesa: un solo ack ok", [ra, rb].filter((r) => r.ok).length === 1);
  const loser = ra.ok ? rb : ra;
  check("  el perdedor recibe 'Esta mesa ya fue asignada.'", loser.error === "Esta mesa ya fue asignada.", loser.error);
  check("  los dos hosts del restaurante reciben UN aviso", assignedA.length === 1 && assignedB.length === 1, `A=${assignedA.length} B=${assignedB.length}`);
  check("  el otro restaurante no recibe nada", assignedOtro.length === 0, `${assignedOtro.length}`);

  const winnerEntry = ra.ok ? "socket-a" : "socket-b";
  const aviso = assignedA[0] as { table?: { tableId: string; currentEntryId: string } } | undefined;
  check(
    "  el aviso dice qué mesa y qué cliente",
    aviso?.table?.tableId === "m-socket" && aviso.table.currentEntryId === winnerEntry,
    JSON.stringify(aviso),
);

{
  const crossRestaurant = await ask(otro, "waitlist:resolve", {
    entryId: "quick-resolve",
    status: "ausente",
  });
  check("waitlist:resolve no puede modificar una fila de otro restaurante", !crossRestaurant.ok && (await entryRow("quick-resolve"))?.status === "esperando");
}

  const releasedA = counter(hostA, "table:released");
  const releasedOtro = counter(otro, "table:released");
  const rel = await ask(hostB, "table:release", { tableId: "m-socket", entryId: winnerEntry });
  await settle();
  check("liberar por socket avisa a la room", rel.ok && releasedA.length === 1 && releasedOtro.length === 0);
}

{
  // El restaurante sale de la room, no del payload: desde REST_2 no se toca
  // una mesa de REST aunque se mande su id.
  const r = await ask(otro, "table:assign", { tableId: "m2", entryId: "pepa" });
  check("desde otro restaurante no se asigna una mesa ajena", !r.ok);
  check("  y la mesa sigue libre", (await tableRow("m2"))?.currentEntryId === null);
}

{
  // Lo que usan las server actions: emitir por `globalThis`, sin handler.
  const layoutA = counter(hostA, "layout:updated");
  const layoutOtro = counter(otro, "layout:updated");
  await emitToRestaurant(REST, "layout:updated", { layoutId: "layout-1", version: 7 });
  await settle();
  check("emitToRestaurant llega al restaurante (por la base, sin servidor propio)", layoutA.length === 1);
  check("  y no a otros restaurantes", layoutOtro.length === 0);
}

{
  // Un socket está en un solo restaurante: cambiar sale del anterior.
  await ask(hostA, "restaurant:join", { restaurantId: REST_2 });
  const layoutA = counter(hostA, "layout:updated");
  await emitToRestaurant(REST, "layout:updated", { layoutId: "layout-1", version: 8 });
  await settle();
  check("cambiar de restaurante sale de la room anterior", layoutA.length === 0);
}

{
  // Un host con varios restaurantes (el piloto: un usuario para 4 locales de
  // Denny's y Pizza Hut) cambia entre ellos sin recargar: entra en la room
  // del nuevo, sale de la del anterior, y lo que hace va al restaurante nuevo.
  const { eq } = await import("drizzle-orm");
  await db.insert(restaurants).values({ id: "rest-3", name: "Tercero", slug: "tercero" }).onConflictDoNothing();
  const cookieVarios = await sessionCookie("varios@verify.test", ["restaurante"], [REST, REST_2]);
  const varios = await connect(cookieVarios);
  check("un host con dos restaurantes entra en el primero", (await ask(varios, "restaurant:join", { restaurantId: REST })).ok);
  const layouts = counter(varios, "layout:updated");
  await emitToRestaurant(REST, "layout:updated", { layoutId: "layout-1", version: 20 });
  await settle();
  check("  y recibe sus avisos", layouts.length === 1);
  check("  cambia al segundo", (await ask(varios, "restaurant:join", { restaurantId: REST_2 })).ok);
  await emitToRestaurant(REST, "layout:updated", { layoutId: "layout-1", version: 21 });
  await emitToRestaurant(REST_2, "layout:updated", { layoutId: "layout-2", version: 5 });
  await settle();
  check("  deja de recibir los del primero y recibe los del segundo", layouts.length === 2 && (layouts[1] as { layoutId: string }).layoutId === "layout-2");
  const added = (await ask(varios, "waitlist:add", { customerName: "Cliente del segundo", partySize: 2 })) as AnyAck & { entry?: { id: string } };
  const [row] = added.entry ? await db.select().from(waitlistEntries).where(eq(waitlistEntries.id, added.entry.id)) : [];
  check("  lo que añade a la lista va al restaurante en el que está", added.ok && row?.restaurantId === REST_2, added.error);
  // Se quita para no mover los contadores de REST_2 que se miden más abajo.
  if (added.entry) await db.delete(waitlistEntries).where(eq(waitlistEntries.id, added.entry.id));
  check("  no entra en un restaurante que no es suyo", !(await ask(varios, "restaurant:join", { restaurantId: "rest-3" })).ok);
  await db.update(restaurants).set({ active: false }).where(eq(restaurants.id, REST));
  check("  ni en uno suyo desactivado", !(await ask(varios, "restaurant:join", { restaurantId: REST })).ok);
  await db.update(restaurants).set({ active: true }).where(eq(restaurants.id, REST));
  check("  al reactivarlo vuelve a entrar", (await ask(varios, "restaurant:join", { restaurantId: REST })).ok);
  varios.close();
}

// ---------------------------------------------------------------------------
// Modo offline: la cola de una tablet sin conexión
// ---------------------------------------------------------------------------

section("Modo offline: cola, reenvíos y conflictos entre dispositivos");

{
  const { runOnce, findOperation, purgeOldOperations, OPERATION_TTL_MS } = await import("@/lib/offline/operations");
  const { offlineOperations } = await import("@/lib/db/schema");
  const { clampArrival, MAX_OFFLINE_ARRIVAL_MS } = await import("@/lib/waitlist/quick-actions");
  const { listSeatableTables } = await import("@/lib/tables/list");
  const uuid = () => crypto.randomUUID();

  // Las dos «tablets» del mismo restaurante: A (admin) y B (host de REST).
  check("A y B entran en REST", (await ask(hostA, "restaurant:join", { restaurantId: REST })).ok && (await ask(hostB, "restaurant:join", { restaurantId: REST })).ok);
  await db.insert(tables).values([mesa("m-off-1"), mesa("m-off-2")]);
  await db.insert(waitlistEntries).values([cliente("off-listo"), cliente("off-sentar-a"), cliente("off-sentar-b")]);
  const changesB = counter(hostB, "waitlist:changed");
  const assignedB = counter(hostB, "table:assigned");
  const changesOtro = counter(otro, "waitlist:changed");
  type OpAck = AnyAck & { entry?: { id: string; customerName: string; arrivedAt: number; status: string }; actionId?: string };

  // 1. Un alta hecha sin conexión: id y hora de la tablet. El ack se «pierde»
  //    y la tablet la reenvía con el MISMO operationId: no hay dos clientes.
  const entryId = uuid();
  const addOp = uuid();
  const arrivedAt = Date.now() - 20 * 60_000;
  const add = { customerName: "Cola sin red", partySize: 3, notes: "", entryId, arrivedAt, operationId: addOp };
  const first = (await ask(hostA, "waitlist:add", add)) as OpAck;
  const again = (await ask(hostA, "waitlist:add", add)) as OpAck;
  await settle();
  const rows = await db.select().from(waitlistEntries).where(eq(waitlistEntries.customerName, "Cola sin red"));
  check("alta sin conexión: entra con el id que eligió la tablet", first.ok && first.entry?.id === entryId && rows.length === 1, first.error);
  check("  con su hora de llegada real (no la de la sincronización)", rows[0]?.arrivedAt.getTime() === arrivedAt, String(rows[0]?.arrivedAt.getTime()));
  check("  el reenvío del mismo operationId devuelve la misma respuesta", again.ok && JSON.stringify(again) === JSON.stringify(first));
  check("  y no crea un segundo cliente", rows.length === 1);
  check("  la room recibe UN aviso, no dos", changesB.filter((c) => (c as { entry: { id: string } }).entry.id === entryId).length === 1);
  check("  queda registrada la operación", (await findOperation(addOp, REST))?.ok === true);
  // Un alta con el mismo id de cliente pero OTRO operationId (dos pestañas): tampoco duplica.
  const sameEntry = (await ask(hostA, "waitlist:add", { ...add, operationId: uuid() })) as OpAck;
  check("  el mismo id de cliente con otra operación tampoco duplica", sameEntry.ok && (await db.select().from(waitlistEntries).where(eq(waitlistEntries.id, entryId))).length === 1);

  // 2. Marcar listo desde la cola, reenviado: la segunda vez NO dice
  //    «ya fue atendido» (sería un conflicto falso), devuelve lo mismo.
  const resolveOp = uuid();
  const r1 = (await ask(hostA, "waitlist:resolve", { entryId: "off-listo", status: "listo", operationId: resolveOp })) as OpAck;
  const r2 = (await ask(hostA, "waitlist:resolve", { entryId: "off-listo", status: "listo", operationId: resolveOp })) as OpAck;
  check("listo sin conexión, reenviado: las dos respuestas son el mismo éxito", r1.ok && r2.ok && JSON.stringify(r1) === JSON.stringify(r2), r2.error);
  check("  y no un «ya fue atendido» falso", !/atendido/.test(r2.error ?? ""));

  // 3. CONFLICTO entre dispositivos: A (sin conexión) cree que m-off-1 está
  //    libre y deja en cola sentar ahí a off-sentar-a. Mientras, B (en línea)
  //    sienta a off-sentar-b en m-off-1. A vuelve y manda su cola.
  const byB = await ask(hostB, "table:assign", { tableId: "m-off-1", entryId: "off-sentar-b" });
  check("B, en línea, ocupa la mesa", byB.ok, byB.error);
  const assignOp = uuid();
  const byA = await ask(hostA, "table:assign", { tableId: "m-off-1", entryId: "off-sentar-a", operationId: assignOp });
  await settle();
  check("la cola de A NO pisa lo que hizo B: «Esta mesa ya fue asignada.»", !byA.ok && byA.error === "Esta mesa ya fue asignada.", byA.error);
  check("  la mesa sigue con el cliente de B", (await tableRow("m-off-1"))?.currentEntryId === "off-sentar-b");
  check("  y el cliente de A sigue esperando (sin mesa)", (await entryRow("off-sentar-a"))?.status === "esperando" && (await entryRow("off-sentar-a"))?.assignedTableId === null);
  const replayA = await ask(hostA, "table:assign", { tableId: "m-off-1", entryId: "off-sentar-a", operationId: assignOp });
  check("  reenviar ese rechazo da el mismo rechazo (no se reintenta a ciegas)", !replayA.ok && replayA.error === byA.error);
  check("  y la room solo vio la asignación de B", assignedB.length === 1);
  // A puede sentarlo en la otra mesa: la que de verdad está libre.
  const okA = await ask(hostA, "table:assign", { tableId: "m-off-2", entryId: "off-sentar-a", operationId: uuid() });
  check("A lo sienta después en una mesa libre", okA.ok, okA.error);

  // 4. Liberar desde la cola: el reenvío no da «la mesa cambió».
  const releaseOp = uuid();
  const rel1 = await ask(hostA, "table:release", { tableId: "m-off-2", entryId: "off-sentar-a", operationId: releaseOp });
  const rel2 = await ask(hostA, "table:release", { tableId: "m-off-2", entryId: "off-sentar-a", operationId: releaseOp });
  check("liberar sin conexión, reenviado: dos veces el mismo éxito", rel1.ok && rel2.ok, rel2.error);
  // Y si mientras tanto otro dispositivo volvió a ocupar la mesa, liberar con
  // el cliente viejo NO deja sin mesa al nuevo.
  await ask(hostB, "table:assign", { tableId: "m-off-2", entryId: "off-listo" });
  const stale = await ask(hostA, "table:release", { tableId: "m-off-2", entryId: "off-sentar-a", operationId: uuid() });
  check("liberar con un cliente que ya no está ahí se rechaza («la mesa cambió»)", !stale.ok && /cambió/.test(stale.error ?? ""), stale.error);
  check("  y la mesa sigue con el cliente nuevo", (await tableRow("m-off-2"))?.currentEntryId === "off-listo");

  // 5. Un operationId de OTRO restaurante no sirve para leer su respuesta.
  const stolen = (await ask(otro, "waitlist:add", { ...add, operationId: addOp })) as OpAck;
  check("un operationId de otro restaurante se rechaza", !stolen.ok && !stolen.entry, stolen.error);
  await settle();
  // El contador de `otro` se creó al empezar la sección y puede recibir tarde
  // algún aviso de una sección anterior (el sondeo es asíncrono), así que no se
  // cuenta «cuántos llegaron» sino si llegó alguno de ESTA operación: el alta
  // robada lleva el mismo `entryId` que el alta de la room de REST. Un aviso
  // filtrado de verdad (de ésa o de la alta original) lo llevaría.
  const leaked = changesOtro.filter((c) => JSON.stringify(c).includes(entryId));
  check("  y no avisa a nadie de su room", leaked.length === 0, `${leaked.length} avisos con ese cliente`);

  // 6. Validación: el id de operación tiene que ser un UUID.
  const badId = await ask(hostA, "waitlist:resolve", { entryId: "off-listo", status: "ausente", operationId: "no-es-uuid" });
  check("un operationId que no es UUID se rechaza con Zod", !badId.ok);

  // 7. La hora de llegada de la tablet no sirve para colarse.
  const t = new Date("2026-10-02T12:00:00Z");
  check("hora de llegada: más de 24 h atrás se recorta a 24 h", clampArrival(t.getTime() - 3 * MAX_OFFLINE_ARRIVAL_MS, t).getTime() === t.getTime() - MAX_OFFLINE_ARRIVAL_MS);
  check("  en el futuro se recorta a ahora", clampArrival(t.getTime() + 60_000, t).getTime() === t.getTime());
  check("  sin hora, ahora", clampArrival(undefined, t).getTime() === t.getTime());

  // 8. Sin operationId (en línea) todo sigue como antes: se aplica sin registrar.
  const before = (await db.select().from(offlineOperations)).length;
  const plain = await runOnce({ restaurantId: REST, userId: null, action: "x" }, async () => ({ ok: true as const }));
  check("sin operationId se ejecuta y no se registra nada", plain.kind === "nueva" && (await db.select().from(offlineOperations)).length === before);

  // 9. Las operaciones viejas se olvidan solas.
  await db.update(offlineOperations).set({ createdAt: new Date(Date.now() - OPERATION_TTL_MS - 1000) }).where(eq(offlineOperations.operationId, addOp));
  check("las operaciones de hace más de 7 días se purgan", (await purgeOldOperations()) >= 1 && (await findOperation(addOp, REST)) === null);

  // 10. La lista de mesas para «Sentar»: solo las que admiten clientes, con su zona.
  const seatable = await listSeatableTables(REST);
  check("mesas para sentar: solo mesas (no baños), de este restaurante", seatable.length > 0 && seatable.every((x) => x.id !== "bano-1") && !seatable.some((x) => x.id === "m-ajena"));
  check("  con su zona y su ocupación", seatable.find((x) => x.id === "m-off-1")?.layoutName === "Comedor" && seatable.find((x) => x.id === "m-off-1")?.currentEntryId === "off-sentar-b");

  // Limpieza: lo de esta sección no tiene que mover los contadores de la siguiente.
  await db.update(tables).set({ currentEntryId: null, status: "libre" }).where(inArray(tables.id, ["m-off-1", "m-off-2"]));
  await db.delete(tables).where(inArray(tables.id, ["m-off-1", "m-off-2"]));
  await db.delete(waitlistEntries).where(inArray(waitlistEntries.id, ["off-listo", "off-sentar-a", "off-sentar-b", entryId]));
  await ask(hostA, "restaurant:join", { restaurantId: REST_2 });
}

{
  // La pantalla sin conexión: «servidor + cola». Funciones puras.
  const { applyOperations } = await import("@/lib/offline/apply");
  const base = {
    entries: [
      { id: "e1", customerName: "Uno", partySize: 2, notes: null, status: "esperando" as const, arrivedAt: 1, calledAt: null, seatedAt: null, resolvedAt: null, resolvedByName: null, assignedTableId: null, isDemo: false, updatedAt: 1 },
      { id: "e2", customerName: "Dos", partySize: 4, notes: null, status: "esperando" as const, arrivedAt: 2, calledAt: null, seatedAt: null, resolvedAt: null, resolvedByName: null, assignedTableId: null, isDemo: false, updatedAt: 2 },
    ],
    tables: [
      { id: "t1", label: "Mesa 1", capacity: 4, status: "libre" as const, currentEntryId: null, version: 1, layoutId: "l", layoutName: "Comedor" },
      { id: "t2", label: "Mesa 2", capacity: 4, status: "ocupada" as const, currentEntryId: "otro", version: 3, layoutId: "l", layoutName: "Comedor" },
    ],
  };
  let seq = 0;
  const op = (data: object) => ({ operationId: `op${++seq}`, userId: "u", restaurantId: "r", targetId: "x", label: "x", sequence: seq, createdAt: 100 + seq, state: "pendiente" as const, attempts: 0, ...data });
  const ops = [
    op({ action: "waitlist:add", data: { customerName: "Nuevo", partySize: 2, notes: "", entryId: "e3", arrivedAt: 3 } }),
    op({ action: "waitlist:resolve", data: { entryId: "e1", status: "listo" } }),
    op({ action: "table:assign", data: { tableId: "t1", entryId: "e2" } }),
    // Esta mesa ya está ocupada por otro: NO se pinta como suya.
    op({ action: "table:assign", data: { tableId: "t2", entryId: "e3" } }),
    op({ action: "waitlist:delete", data: { entryId: "e3" } }),
  ] as Parameters<typeof applyOperations>[1];
  const v = applyOperations(base, ops, 500);
  const byId = (id: string) => v.entries.find((e) => e.id === id);
  check("la cola se aplica en orden: alta, listo, sentar y eliminar", byId("e1")?.status === "listo" && byId("e2")?.status === "sentado" && byId("e3") === undefined);
  check("  sentar ocupa la mesa en pantalla", v.tables.find((x) => x.id === "t1")?.currentEntryId === "e2");
  check("  una mesa que ya tiene a otro NO se pinta como ocupada por el de la cola (sin pantalla falsa)", v.tables.find((x) => x.id === "t2")?.currentEntryId === "otro");
  check("  los datos base no se modifican", base.entries[0].status === "esperando" && base.tables[0].currentEntryId === null);
  const withConflict = applyOperations(base, [{ ...ops[1], state: "conflicto" }], 500);
  check("  una operación rechazada deja de aplicarse", withConflict.entries.find((e) => e.id === "e1")?.status === "esperando");
  const undone = applyOperations(base, ops.slice(0, 1), 500);
  check("  deshacer sin conexión = quitar la última de la cola", undone.entries.length === 3 && undone.entries.find((e) => e.id === "e1")?.status === "esperando");
}

// ---------------------------------------------------------------------------
// Sala overview (mapa general)
// ---------------------------------------------------------------------------

section("Sala overview: contadores del mapa general");

{
  // Contadores calculados directamente, sin socket.
  const now = Date.now();
  await db.insert(tables).values([mesa("m-overview"), { ...mesa("m-reservada"), status: "reservada" }]);
  await db.insert(waitlistEntries).values([
    { ...cliente("ov-1"), arrivedAt: new Date(now - 30 * 60_000) },
    { ...cliente("ov-2", REST_2), arrivedAt: new Date(now - 50 * 60_000) },
  ]);
  const all = await getCounters();
  const rest = all.find((c) => c.restaurantId === REST);
  const seatable = (await db.query.tables.findMany({ where: eq(tables.restaurantId, REST) })).filter(
    (t) => t.elementTypeId === "type-mesa",
  );
  check("getCounters devuelve una fila por restaurante", all.length === 2, `${all.length}`);
  check("  cuenta solo las mesas, no los baños", rest?.tablesTotal === seatable.length, `${rest?.tablesTotal} vs ${seatable.length}`);
  check("  una mesa reservada y libre cuenta como reservada", rest?.tablesReserved === 1, `${rest?.tablesReserved}`);
  // En REST_2 esperan "de-fuera" (llegó al crear los datos) y "ov-2" (hace
  // 50 min): la espera media es la media de las dos.
  const other = all.find((c) => c.restaurantId === REST_2);
  const waitingRows = (await db.query.waitlistEntries.findMany({ where: eq(waitlistEntries.restaurantId, REST_2) })).filter(
    (w) => w.status === "esperando",
  );
  const expected = Math.floor(
    waitingRows.reduce((sum, w) => sum + (now - w.arrivedAt.getTime()), 0) / waitingRows.length / 60_000,
  );
  check(
    `  la espera media sale de la llegada media (${expected} min en REST_2)`,
    other !== undefined && other.waiting === 2 && averageWaitMinutes(other, now) === expected,
    JSON.stringify(other),
  );
  check("  más de 40 min es crítica, más de 20 alerta", waitLevel(41) === "critica" && waitLevel(21) === "alerta" && waitLevel(20) === "normal");
  const none = await getRestaurantCounters("no-existe");
  check("  un restaurante sin nada da ceros", none.tablesTotal === 0 && none.waiting === 0 && none.averageArrivedAt === null);
}

// `analitica` es el socket de analitica que se conectó arriba.
{
  const r = (await ask(hostB, "overview:join", {})) as AnyAck;
  check("el rol restaurante NO entra en la sala overview", !r.ok && /mapa general/.test(r.error ?? ""), r.error);
  const bad = (await ask(analitica, "restaurant:join", { restaurantId: REST })) as AnyAck;
  check("analitica NO entra en la room de un restaurante (vería nombres)", !bad.ok);
}

// `waitersKey` no es de ningún cliente: id y versión de la configuración de meseros activa.
const COUNTER_KEYS = ["averageArrivedAt", "restaurantId", "tablesOccupied", "tablesReserved", "tablesTotal", "waitersKey", "waiting"];

{
  const joinAnalitica = (await ask(analitica, "overview:join", {})) as AnyAck & { counters?: unknown[] };
  const joinAdmin = (await ask(hostA, "overview:join", {})) as AnyAck & { counters?: unknown[] };
  check("analitica y admin entran en la sala overview", joinAnalitica.ok && joinAdmin.ok);
  check("  el ack trae los contadores de todos", joinAnalitica.counters?.length === 2);
  check(
    "  solo contadores: ni nombres ni ids de clientes",
    (joinAnalitica.counters ?? []).every((c) => JSON.stringify(Object.keys(c as object).sort()) === JSON.stringify(COUNTER_KEYS)),
    JSON.stringify(joinAnalitica.counters?.[0]),
  );
}

{
  const before = await getRestaurantCounters(REST);
  const gotAnalitica = counter(analitica, "overview:counters");
  const gotAdmin = counter(hostA, "overview:counters");
  const gotHostB = counter(hostB, "overview:counters");
  const gotOtro = counter(otro, "overview:counters");

  const r = await ask(hostB, "table:assign", { tableId: "m-overview", entryId: "ov-1" });
  await settle();
  const aviso = gotAnalitica[0] as Record<string, unknown> | undefined;
  check("asignar una mesa manda contadores a la sala overview", r.ok && gotAnalitica.length === 1 && gotAdmin.length === 1, `${gotAnalitica.length}/${gotAdmin.length}`);
  check("  del restaurante correcto", aviso?.restaurantId === REST);
  check(
    "  con una mesa ocupada más y un cliente menos en espera",
    aviso?.tablesOccupied === before.tablesOccupied + 1 && aviso?.waiting === before.waiting - 1,
    JSON.stringify(aviso),
  );
  check("  sin datos del cliente", !JSON.stringify(aviso).includes("ov-1") && JSON.stringify(Object.keys(aviso ?? {}).sort()) === JSON.stringify(COUNTER_KEYS));
  check("  quien no está en la sala no recibe nada", gotHostB.length === 0 && gotOtro.length === 0);

  const rel = await ask(hostB, "table:release", { tableId: "m-overview", entryId: "ov-1" });
  await settle();
  const libre = gotAnalitica[1] as Record<string, unknown> | undefined;
  check("liberar la mesa manda contadores otra vez", rel.ok && gotAnalitica.length === 2);
  check("  y la mesa ya no cuenta como ocupada", libre?.tablesOccupied === before.tablesOccupied, JSON.stringify(libre));
}

{
  // Lo que llamarán el editor y el modo rápido: emitOverview a secas.
  const got = counter(analitica, "overview:counters");
  await emitOverview(REST_2);
  await settle();
  check("emitOverview llega a la sala del mapa (por la base)", got.length === 1 && (got[0] as { restaurantId?: string }).restaurantId === REST_2);
}

{
  // El modo rápido también avisa al mapa general: agregar, resolver y
  // deshacer cambian los clientes en espera. Solo viajan contadores.
  const got = counter(analitica, "overview:counters");
  const before = await getRestaurantCounters(REST);
  const noData = (c: unknown, ...secrets: string[]) =>
    JSON.stringify(Object.keys(c as object).sort()) === JSON.stringify(COUNTER_KEYS) &&
    secrets.every((x) => !JSON.stringify(c).includes(x));

  const added = (await ask(hostB, "waitlist:add", { customerName: "Grupo del mapa", partySize: 3 })) as AnyAck & {
    entry?: { id: string };
    actionId?: string;
  };
  await settle();
  const afterAdd = got[0] as RestaurantCountersT | undefined;
  check("waitlist:add manda contadores a la sala overview", added.ok && got.length === 1 && afterAdd?.restaurantId === REST, `${got.length}`);
  check("  con un cliente más en espera", afterAdd?.waiting === before.waiting + 1, JSON.stringify(afterAdd));
  check("  sin datos del cliente", noData(afterAdd, "Grupo del mapa", added.entry?.id ?? "-"));

  const resolved = (await ask(hostB, "waitlist:resolve", { entryId: added.entry?.id ?? "", status: "ausente" })) as AnyAck & {
    actionId?: string;
  };
  await settle();
  const afterResolve = got[1] as RestaurantCountersT | undefined;
  check("waitlist:resolve manda contadores a la sala overview", resolved.ok && got.length === 2, `${got.length}`);
  check("  y el ausente ya no cuenta en espera", afterResolve?.waiting === before.waiting, JSON.stringify(afterResolve));
  check("  sin datos del cliente", noData(afterResolve, "Grupo del mapa", added.entry?.id ?? "-"));

  const undone = (await ask(hostB, "waitlist:undo", { actionId: resolved.actionId ?? "" })) as AnyAck;
  await settle();
  const afterUndo = got[2] as RestaurantCountersT | undefined;
  check("waitlist:undo manda contadores a la sala overview", undone.ok && got.length === 3, `${got.length}`);
  check("  y el cliente vuelve a contar en espera", afterUndo?.waiting === before.waiting + 1, JSON.stringify(afterUndo));
  check("  sin datos del cliente", noData(afterUndo, "Grupo del mapa", added.entry?.id ?? "-"));

  const failed = await ask(hostB, "waitlist:undo", { actionId: resolved.actionId ?? "" });
  await settle();
  check("una acción que falla no manda contadores", !failed.ok && got.length === 3, `${got.length}`);
}

{
  // Si le quitan el rol con el mapa abierto, deja de recibir y sale de la sala.
  const session = await getAuth().api.getSession({ headers: new Headers({ cookie: cookieAnalitica }) });
  await setUserAccess(session!.user.id, ["restaurante"], [REST_2]);
  const got = counter(analitica, "overview:counters");
  const gotAdmin = counter(hostA, "overview:counters");
  await emitOverview(REST);
  await emitOverview(REST);
  await settle();
  check("sin mapa:ver ya no recibe contadores", got.length === 0 && gotAdmin.length === 2, `${got.length}/${gotAdmin.length}`);
  check("  y ya no puede leer la sala del mapa general", (await allowedRooms({ userId: session!.user.id }, { overview: true })).length === 0);
}

{
  // Desactivado: su sesión se cierra y el socket ya no conecta.
  await setUserActive((await getAuth().api.getSession({ headers: new Headers({ cookie: cookieOtro }) }))!.user.id, false);
  const rejected = await connect(cookieOtro).then(
    (c) => {
      c.close();
      return false;
    },
    () => true,
  );
  check("un usuario desactivado ya no conecta", rejected);
}

// ---------------------------------------------------------------------------
// Zonas de meseros en tiempo real
// ---------------------------------------------------------------------------

section("Zonas de meseros: quién atiende al sentar, y el cambio de configuración");

{
  const { activateWaiterConfig, createWaiterConfig, listWaiterConfigs, saveWaiterConfig } = await import("@/lib/waiters/configs");
  const { listSeatableTables } = await import("@/lib/tables/list");
  const { waiterColorFor, waiterLegend } = await import("@/lib/waiters/legend");
  const { waiterConfigs } = await import("@/lib/db/schema");
  const { and } = await import("drizzle-orm");

  // Mesas y clientes propios: las de antes pueden estar ocupadas.
  await db.insert(tables).values([mesa("w-1"), mesa("w-2"), mesa("w-3"), mesa("w-4")]);
  await db.insert(waitlistEntries).values([cliente("mesero-a"), cliente("mesero-b"), cliente("mesero-c")]);
  await ask(hostA, "restaurant:join", { restaurantId: REST });
  await ask(hostB, "restaurant:join", { restaurantId: REST });

  const sinConfig = await getRestaurantCounters(REST);
  check("sin configuración, los contadores no traen meseros", sinConfig.waitersKey === null);
  check("sin configuración, «Ver clientes» no tiene leyenda de meseros", waiterLegend(await listSeatableTables(REST)).length === 0);

  const dos = await createWaiterConfig({ restaurantId: REST, waiterCount: 2 });
  const tres = await createWaiterConfig({ restaurantId: REST, waiterCount: 3 });
  check("se crean «2 meseros» (activa) y «3 meseros»", dos.ok && tres.ok && dos.config.isActive && !tres.config.isActive);
  if (dos.ok && tres.ok) {
    const conDos = await getRestaurantCounters(REST);
    check("  los contadores dicen cuál está activa (para el plano de analítica)", conDos.waitersKey === `${dos.config.id}:${dos.config.version}`, String(conDos.waitersKey));
    check("  la otra configuración no toca a REST_2", (await getRestaurantCounters(REST_2)).waitersKey === null);

    const WAITER_NAMES = new Set((await import("@/lib/waiters/palette")).WAITER_PALETTE.map((c) => c.name));
    const libres = (await listSeatableTables(REST)).filter((t) => t.id.startsWith("w-"));
    check("cada mesa trae el mesero de la configuración activa", libres.every((t) => WAITER_NAMES.has(t.waiterName ?? "") && t.waiterColor?.startsWith("#")), JSON.stringify(libres.map((t) => t.waiterName)));

    // «Ver clientes»: la leyenda son los meseros de la activa, con sus colores
    // (los mismos del plano en vivo) y en el orden de sus posiciones.
    const zonasDos = [...dos.config.zones].sort((a, b) => a.position - b.position);
    const leyendaDos = waiterLegend(await listSeatableTables(REST));
    check(
      "leyenda de «Ver clientes» = meseros de la configuración activa, con su color",
      JSON.stringify(leyendaDos) === JSON.stringify(zonasDos.map((z) => ({ name: z.waiterName, color: z.color }))),
      JSON.stringify(leyendaDos),
    );

    const avisos = counter(hostA, "table:assigned");
    const mesaA = libres[0];
    const ack = (await ask(hostB, "table:assign", { tableId: mesaA.id, entryId: "mesero-a" })) as AnyAck & { waiterName?: string | null };
    await settle();
    check("al sentar, el ack trae el mesero que lo atiende", ack.ok && ack.waiterName === mesaA.waiterName, JSON.stringify(ack));
    const aviso = avisos.at(-1) as { waiterName?: string | null } | undefined;
    check("  y el aviso a toda la room también", aviso?.waiterName === mesaA.waiterName, JSON.stringify(aviso));
    const [filaA] = await db.select({ waiterName: waitlistEntries.waiterName }).from(waitlistEntries).where(eq(waitlistEntries.id, "mesero-a"));
    check("  y queda guardado en el cliente", filaA?.waiterName === mesaA.waiterName);

    // Un reenvío de la cola offline devuelve el MISMO mesero sin volver a sentar.
    const operationId = crypto.randomUUID();
    const mesaB = libres[1];
    const primero = (await ask(hostB, "table:assign", { tableId: mesaB.id, entryId: "mesero-b", operationId })) as AnyAck & { waiterName?: string | null };
    const repetido = (await ask(hostB, "table:assign", { tableId: mesaB.id, entryId: "mesero-b", operationId })) as AnyAck & { waiterName?: string | null };
    check("un reenvío offline responde lo mismo, mesero incluido", primero.ok && repetido.ok && repetido.waiterName === primero.waiterName);

    // Cambio de configuración: los clientes nuevos se apuntan al mesero nuevo.
    const cambios = counter(hostA, "waiters:changed");
    const activada = await activateWaiterConfig({ restaurantId: REST, configId: tres.config.id });
    await emitToRestaurant(REST, "waiters:changed", { activeConfigId: tres.config.id });
    await settle();
    check("se activa «3 meseros» con una llamada", activada.ok && (await listWaiterConfigs(REST)).find((c) => c.isActive)?.id === tres.config.id);
    check("  la room recibe «waiters:changed» con la activa", (cambios.at(-1) as { activeConfigId?: string } | undefined)?.activeConfigId === tres.config.id);
    check("  y los contadores cambian de clave", (await getRestaurantCounters(REST)).waitersKey === `${tres.config.id}:${tres.config.version}`);
    const zonaNueva = tres.config.zones.find((z) => z.tableIds.includes(libres[2].id));
    const ackC = (await ask(hostB, "table:assign", { tableId: libres[2].id, entryId: "mesero-c" })) as AnyAck & { waiterName?: string | null };
    check("  el siguiente cliente se apunta al mesero de la configuración nueva", ackC.ok && ackC.waiterName === zonaNueva?.waiterName, `${ackC.waiterName} vs ${zonaNueva?.waiterName}`);
    const [filaA2] = await db.select({ waiterName: waitlistEntries.waiterName }).from(waitlistEntries).where(eq(waitlistEntries.id, "mesero-a"));
    check("  y el que ya estaba sentado conserva el suyo", filaA2?.waiterName === mesaA.waiterName);

    // Tras «waiters:changed» el modo sencillo vuelve a leer las mesas: la
    // leyenda y los colores ya son los de la configuración nueva.
    const zonasTres = [...tres.config.zones].sort((a, b) => a.position - b.position);
    const leyendaTres = waiterLegend(await listSeatableTables(REST));
    check(
      "con 3 meseros, la leyenda se pone al día (3 meseros y sus colores)",
      JSON.stringify(leyendaTres) === JSON.stringify(zonasTres.map((z) => ({ name: z.waiterName, color: z.color }))),
      JSON.stringify(leyendaTres),
    );
    check("  el cliente nuevo sale del color de su mesero", waiterColorFor(leyendaTres, ackC.ok ? ackC.waiterName : null) === zonaNueva?.color);
    check("  uno en espera, sin color («Sin mesero»)", waiterColorFor(leyendaTres, null) === null);

    // Conflictos: dos tablets a la vez.
    await Promise.all([
      activateWaiterConfig({ restaurantId: REST, configId: dos.config.id }),
      activateWaiterConfig({ restaurantId: REST, configId: tres.config.id }),
    ]);
    const activas = await db.select({ id: waiterConfigs.id }).from(waiterConfigs).where(and(eq(waiterConfigs.restaurantId, REST), eq(waiterConfigs.isActive, true)));
    check("dos activaciones a la vez dejan UNA sola activa", activas.length === 1, `${activas.length}`);

    const base = (await listWaiterConfigs(REST)).find((c) => c.id === dos.config.id)!;
    const guardar = (nombre: string) =>
      saveWaiterConfig({
        restaurantId: REST,
        configId: base.id,
        version: base.version,
        name: base.name,
        zones: base.zones.map((z) => ({ id: z.id, waiterName: nombre, color: z.color })),
        assignments: base.zones.flatMap((z) => z.tableIds.map((tableId) => ({ tableId, zoneId: z.id }))),
      });
    const [g1, g2] = await Promise.all([guardar("Tablet 1"), guardar("Tablet 2")]);
    check("dos guardados con la misma versión: gana uno y el otro recibe el aviso", [g1, g2].filter((g) => g.ok).length === 1 && [g1, g2].some((g) => !g.ok && g.error.includes("Otro dispositivo")), JSON.stringify([g1, g2]));

    // Liberar las mesas de la prueba.
    for (const [tableId, entryId] of [[mesaA.id, "mesero-a"], [mesaB.id, "mesero-b"], [libres[2].id, "mesero-c"]]) {
      await ask(hostB, "table:release", { tableId, entryId });
    }
  }
}

section("Liberar y limpiar: acciones en grupo, primero liberar y luego eliminar, liberar todas y deshacer");

{
  const { and: y, eq: igual, inArray: entre, sql } = await import("drizzle-orm");
  const H = 3_600_000;
  const hace = (horas: number) => new Date(Date.now() - horas * H);
  await ask(hostA, "restaurant:join", { restaurantId: REST });
  await ask(hostB, "restaurant:join", { restaurantId: REST });
  await db.insert(tables).values([mesa("lim-1"), mesa("lim-2"), mesa("lim-3"), mesa("lim-4"), mesa("lim-ajena", REST_2, "layout-2")]);
  await db.insert(waitlistEntries).values([
    { ...cliente("lim-espera-vieja"), arrivedAt: hace(72) },
    { ...cliente("lim-listo-viejo", REST, "listo"), arrivedAt: hace(48) },
    { ...cliente("lim-espera-nueva"), arrivedAt: hace(1) },
    { ...cliente("lim-sentado-viejo", REST, "sentado"), arrivedAt: hace(241), seatedAt: hace(240) },
    { ...cliente("lim-sentado-nuevo", REST, "sentado"), arrivedAt: hace(2), seatedAt: hace(1) },
    { ...cliente("lim-ajeno", REST_2, "sentado"), arrivedAt: hace(240), seatedAt: hace(240) },
  ]);
  await db.update(tables).set({ currentEntryId: "lim-sentado-viejo", status: "ocupada" }).where(igual(tables.id, "lim-1"));
  await db.update(tables).set({ currentEntryId: "lim-sentado-nuevo", status: "ocupada" }).where(igual(tables.id, "lim-2"));
  await db.update(tables).set({ currentEntryId: "lim-ajeno", status: "ocupada" }).where(igual(tables.id, "lim-ajena"));
  const estado = async (id: string) => (await db.select({ s: waitlistEntries.status }).from(waitlistEntries).where(igual(waitlistEntries.id, id)))[0]?.s ?? null;
  const ocupa = async (tableId: string) => (await db.select({ e: tables.currentEntryId }).from(tables).where(igual(tables.id, tableId)))[0]?.e ?? null;
  const filas = async () => (await db.select({ id: waitlistEntries.id }).from(waitlistEntries)).length;

  // Permisos: analítica no opera; un host de otro restaurante no toca este.
  check("analítica no puede limpiar (no entra en la room)", !(await ask(analitica, "waitlist:cleanup", { hours: 24 })).ok);
  check("  ni liberar todas las mesas", !(await ask(analitica, "tables:release-all", { confirm: "LIBERAR" })).ok);
  check("  ni acciones en grupo", !(await ask(analitica, "waitlist:bulk", { action: "eliminar", entryIds: ["lim-espera-vieja"] })).ok);
  await ask(otro, "restaurant:join", { restaurantId: REST_2 });
  const ajena = await ask(otro, "waitlist:bulk", { action: "eliminar", entryIds: ["lim-espera-vieja", "lim-sentado-viejo"] });
  // (Ese host se desactivó más arriba en esta prueba: según el momento, el
  // servidor lo rechaza o actúa solo en SU restaurante. En los dos casos, aquí
  // no cambia nada, que es lo que importa.)
  check("un host de otro restaurante no toca los clientes de este", (await estado("lim-espera-vieja")) === "esperando" && (await ocupa("lim-1")) === "lim-sentado-viejo", JSON.stringify(ajena));

  // «Limpiar pendientes antiguos» (24 h): primero cuenta, luego aplica.
  const preview = (await ask(hostA, "waitlist:cleanup", { hours: 24, preview: true })) as AnyAck & { preview?: { absent: number; tables: number } };
  check("limpiar (24 h) cuenta antes: 2 en la fila y 1 mesa", preview.ok && preview.preview?.absent === 2 && preview.preview?.tables === 1, JSON.stringify(preview));
  check("  contar no cambia nada", (await estado("lim-espera-vieja")) === "esperando" && (await ocupa("lim-1")) === "lim-sentado-viejo");
  check("  un plazo inventado se rechaza", !(await ask(hostA, "waitlist:cleanup", { hours: 5 })).ok);
  const liberadasB = counter(hostB, "table:released");
  const cambiosB = counter(hostB, "waitlist:changed");
  const antes = await filas();
  const limpio = (await ask(hostA, "waitlist:cleanup", { hours: 24 })) as AnyAck & { changed?: number; released?: number; actionId?: string };
  await settle();
  check("limpiar marca ausentes a los viejos de la fila y libera la mesa vieja", limpio.ok && limpio.changed === 2 && limpio.released === 1, JSON.stringify(limpio));
  check("  los viejos quedan ausentes; el nuevo sigue en la fila", (await estado("lim-espera-vieja")) === "ausente" && (await estado("lim-listo-viejo")) === "ausente" && (await estado("lim-espera-nueva")) === "esperando");
  check("  la mesa vieja quedó libre; la nueva sigue ocupada", (await ocupa("lim-1")) === null && (await ocupa("lim-2")) === "lim-sentado-nuevo");
  check("  no toca otro restaurante", (await ocupa("lim-ajena")) === "lim-ajeno");
  check("  no borra ninguna fila (las cifras se quedan)", (await filas()) === antes);
  check("  la otra tablet se entera en vivo", liberadasB.length >= 1 && cambiosB.length >= 2, `${liberadasB.length} mesas, ${cambiosB.length} cambios`);
  const deshacer = await ask(hostB, "waitlist:undo", { actionId: limpio.actionId });
  await settle();
  check("deshacer la limpieza (desde otra tablet) devuelve todo", deshacer.ok && (await estado("lim-espera-vieja")) === "esperando" && (await estado("lim-listo-viejo")) === "listo" && (await ocupa("lim-1")) === "lim-sentado-viejo", JSON.stringify(deshacer));

  // Acciones en grupo.
  const ausentes = (await ask(hostA, "waitlist:bulk", { action: "ausente", entryIds: ["lim-espera-vieja", "lim-espera-nueva", "lim-sentado-nuevo"] })) as AnyAck & { changed?: number };
  check("«Marcar ausente» en grupo: solo los que siguen en la fila", ausentes.ok && ausentes.changed === 2 && (await estado("lim-sentado-nuevo")) === "sentado", JSON.stringify(ausentes));
  await ask(hostA, "waitlist:undo", { actionId: (ausentes as { actionId?: string }).actionId });
  const liberar = (await ask(hostA, "waitlist:bulk", { action: "liberar", entryIds: ["lim-sentado-viejo", "lim-sentado-nuevo", "lim-espera-vieja"] })) as AnyAck & { released?: number };
  check("«Liberar mesas» en grupo libera las dos mesas", liberar.ok && liberar.released === 2 && (await ocupa("lim-1")) === null && (await ocupa("lim-2")) === null);
  check("  y los clientes siguen en el historial como sentados", (await estado("lim-sentado-viejo")) === "sentado" && (await estado("lim-sentado-nuevo")) === "sentado");
  await ask(hostA, "waitlist:undo", { actionId: (liberar as { actionId?: string }).actionId });
  check("  deshacer vuelve a ocupar las mesas", (await ocupa("lim-1")) === "lim-sentado-viejo" && (await ocupa("lim-2")) === "lim-sentado-nuevo");

  // Primero liberar, luego eliminar.
  const sinLiberar = await ask(hostA, "waitlist:delete", { entryId: "lim-sentado-viejo" });
  check("eliminar a uno que está en una mesa se rechaza y dice en cuál", !sinLiberar.ok && sinLiberar.error === "Este cliente está en la lim-1. Primero libera la mesa para poder eliminarlo.", sinLiberar.error);
  check("  y no toca nada (sigue sentado, con su mesa)", (await estado("lim-sentado-viejo")) === "sentado" && (await ocupa("lim-1")) === "lim-sentado-viejo");
  const viejoLiberar = await ask(hostA, "waitlist:delete", { entryId: "lim-sentado-viejo", releaseTable: true });
  check("  la opción vieja `releaseTable` ya no existe: también se rechaza", !viejoLiberar.ok && (await ocupa("lim-1")) === "lim-sentado-viejo");
  const deshacerB = counter(hostB, "waitlist:undo-state");
  const libera = (await ask(hostA, "table:release", { tableId: "lim-1", entryId: "lim-sentado-viejo", operationId: crypto.randomUUID() })) as AnyAck;
  await settle();
  check("«Liberar mesa» deja la mesa libre", libera.ok && (await ocupa("lim-1")) === null);
  const ofrecido = deshacerB.at(-1) as { actionId: string; label: string } | null | undefined;
  check("  y se puede deshacer (las otras tablets reciben «Deshacer: Liberar lim-1»)", ofrecido?.label === "Liberar lim-1", JSON.stringify(ofrecido));
  const vuelve = await ask(hostB, "waitlist:undo", { actionId: ofrecido?.actionId });
  check("  deshacer la vuelve a ocupar con el mismo cliente", vuelve.ok && (await ocupa("lim-1")) === "lim-sentado-viejo", JSON.stringify(vuelve));
  await ask(hostA, "table:release", { tableId: "lim-1", entryId: "lim-sentado-viejo", operationId: crypto.randomUUID() });
  const ahora = (await ask(hostA, "waitlist:delete", { entryId: "lim-sentado-viejo" })) as AnyAck & { actionId?: string };
  check("ya libre, eliminarlo funciona", ahora.ok && (await estado("lim-sentado-viejo")) === null, JSON.stringify(ahora));
  await ask(hostA, "waitlist:undo", { actionId: ahora.actionId });
  check("  y deshacer lo devuelve (sin mesa: la liberó una acción aparte)", (await estado("lim-sentado-viejo")) === "sentado" && (await ocupa("lim-1")) === null);
  await db.update(tables).set({ currentEntryId: "lim-sentado-viejo", status: "ocupada" }).where(igual(tables.id, "lim-1"));

  // Cola sin conexión: un «eliminar» que se anotó sin red y llega cuando el
  // cliente ya está en una mesa se rechaza igual; el reenvío, también.
  const opCola = crypto.randomUUID();
  const cola1 = await ask(hostA, "waitlist:delete", { entryId: "lim-sentado-nuevo", operationId: opCola });
  const cola2 = await ask(hostA, "waitlist:delete", { entryId: "lim-sentado-nuevo", operationId: opCola });
  check("cola sin conexión: eliminar a uno con mesa se rechaza (y el reenvío da lo mismo)", !cola1.ok && !cola2.ok && cola1.error === cola2.error && (await estado("lim-sentado-nuevo")) === "sentado", cola1.error);

  // Grupo mixto: si alguno está en una mesa, no se elimina a NADIE.
  const filasAntes = await filas();
  const mixto = await ask(hostA, "waitlist:bulk", { action: "eliminar", entryIds: ["lim-espera-vieja", "lim-sentado-nuevo", "lim-sentado-viejo", "lim-listo-viejo", "lim-espera-nueva"] });
  check(
    "«Eliminar seleccionados» con 2 de 5 en una mesa se rechaza y nombra las mesas",
    !mixto.ok && mixto.error === "2 de los 5 clientes seleccionados están en una mesa (lim-1, lim-2). Primero libera sus mesas.",
    mixto.error,
  );
  check("  y no elimina a nadie ni libera mesas", (await filas()) === filasAntes && (await ocupa("lim-1")) === "lim-sentado-viejo" && (await ocupa("lim-2")) === "lim-sentado-nuevo");
  const soloLibres = (await ask(hostA, "waitlist:bulk", { action: "eliminar", entryIds: ["lim-espera-vieja", "lim-espera-nueva"] })) as AnyAck & { removed?: number; released?: number; actionId?: string };
  check("«Eliminar solo los sin mesa» elimina a esos y no libera nada", soloLibres.ok && soloLibres.removed === 2 && soloLibres.released === 0 && (await ocupa("lim-2")) === "lim-sentado-nuevo", JSON.stringify(soloLibres));
  await ask(hostA, "waitlist:undo", { actionId: soloLibres.actionId });
  check("  deshacer los devuelve", (await estado("lim-espera-vieja")) === "esperando" && (await estado("lim-espera-nueva")) === "esperando");
  const susMesas = (await ask(hostA, "waitlist:bulk", { action: "liberar", entryIds: ["lim-sentado-nuevo", "lim-sentado-viejo"] })) as AnyAck & { released?: number };
  const despues = (await ask(hostA, "waitlist:bulk", { action: "eliminar", entryIds: ["lim-sentado-nuevo", "lim-sentado-viejo"] })) as AnyAck & { removed?: number; actionId?: string };
  check("«Liberar sus mesas» y luego eliminar: funciona", susMesas.ok && susMesas.released === 2 && despues.ok && despues.removed === 2, JSON.stringify({ susMesas, despues }));
  await ask(hostA, "waitlist:undo", { actionId: despues.actionId });
  await db.update(tables).set({ currentEntryId: "lim-sentado-viejo", status: "ocupada" }).where(igual(tables.id, "lim-1"));
  await db.update(tables).set({ currentEntryId: "lim-sentado-nuevo", status: "ocupada" }).where(igual(tables.id, "lim-2"));
  check("  (los dos vuelven al deshacer)", (await estado("lim-sentado-nuevo")) === "sentado" && (await estado("lim-sentado-viejo")) === "sentado");

  // Deshacer sobrevive a un reinicio: la última acción se guarda en la base.
  {
    const { dropUndoMemoryForTests, UNDO_PERSIST_MS } = await import("@/lib/waitlist/quick-actions");
    const { waitlistUndo } = await import("@/lib/db/schema");
    const libre = (await ask(hostA, "waitlist:bulk", { action: "liberar", entryIds: ["lim-sentado-nuevo"] })) as AnyAck & { actionId?: string };
    await dropUndoMemoryForTests();
    const otraTablet = await connect(cookieB);
    const ofrecida = counter(otraTablet, "waitlist:undo-state");
    await ask(otraTablet, "restaurant:join", { restaurantId: REST });
    await settle();
    check("tras un reinicio, quien se conecta ve «Deshacer» de la última acción", (ofrecida.at(-1) as { actionId?: string } | undefined)?.actionId === libre.actionId, JSON.stringify(ofrecida.at(-1)));
    const tras = await ask(otraTablet, "waitlist:undo", { actionId: libre.actionId });
    check("  y deshace de verdad (vuelve a ocupar la mesa)", tras.ok && (await ocupa("lim-2")) === "lim-sentado-nuevo", JSON.stringify(tras));
    check("  ya deshecha, la copia guardada se borra", (await db.select().from(waitlistUndo).where(igual(waitlistUndo.restaurantId, REST))).length === 0);
    const vieja = (await ask(hostA, "waitlist:bulk", { action: "liberar", entryIds: ["lim-sentado-nuevo"] })) as AnyAck & { actionId?: string };
    await dropUndoMemoryForTests();
    await db.update(waitlistUndo).set({ createdAt: new Date(Date.now() - UNDO_PERSIST_MS - 1000) }).where(igual(waitlistUndo.restaurantId, REST));
    const caducada = await ask(otraTablet, "waitlist:undo", { actionId: vieja.actionId });
    check("  pasados 10 minutos, ya no se ofrece", !caducada.ok && (await ocupa("lim-2")) === null);
    await db.update(tables).set({ currentEntryId: "lim-sentado-nuevo", status: "ocupada" }).where(igual(tables.id, "lim-2"));
    otraTablet.close();
  }

  // «Liberar todas las mesas»: hay que escribir LIBERAR.
  check("liberar todas sin escribir LIBERAR se rechaza", !(await ask(hostA, "tables:release-all", { confirm: "liberar" })).ok && (await ocupa("lim-1")) === "lim-sentado-viejo");
  const todas = (await ask(hostA, "tables:release-all", { confirm: "LIBERAR" })) as AnyAck & { released?: number; actionId?: string };
  const ocupadasRest = await db.select({ id: tables.id }).from(tables).where(y(igual(tables.restaurantId, REST), sql`${tables.currentEntryId} is not null`));
  check("«Liberar todas las mesas» deja libres todas las de este restaurante", todas.ok && ocupadasRest.length === 0 && (todas.released ?? 0) >= 2, JSON.stringify(todas));
  check("  y no toca las de otro restaurante", (await ocupa("lim-ajena")) === "lim-ajeno");
  await ask(hostA, "waitlist:undo", { actionId: todas.actionId });
  check("  deshacer las vuelve a ocupar", (await ocupa("lim-1")) === "lim-sentado-viejo" && (await ocupa("lim-2")) === "lim-sentado-nuevo");

  // Limpieza de la prueba.
  await db.update(tables).set({ currentEntryId: null, status: "libre" }).where(entre(tables.id, ["lim-1", "lim-2", "lim-3", "lim-4", "lim-ajena"]));
  await db.delete(waitlistEntries).where(entre(waitlistEntries.id, ["lim-espera-vieja", "lim-listo-viejo", "lim-espera-nueva", "lim-sentado-viejo", "lim-sentado-nuevo", "lim-ajeno"]));
}

// ---------------------------------------------------------------------------
section("Ahorros del sondeo");
// ---------------------------------------------------------------------------

{
  // Esperas por condición (no por tiempo fijo): la prueba avanza en cuanto se cumple.
  const waitFor = async (cond: () => boolean, ms = 5000) => {
    const end = Date.now() + ms;
    while (!cond() && Date.now() < end) await new Promise((r) => setTimeout(r, 10));
    return cond();
  };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  // 1. Los permisos reutilizan el usuario ya cargado en la petición.
  const { identifyRequest, canJoinRestaurant } = await import("@/lib/realtime/auth");
  const ident = await identifyRequest(new Headers({ cookie: cookieB }));
  check("identifyRequest devuelve el usuario ya cargado", ident?.user?.email === "rest1@verify.test");
  const fantasma = { id: "no-existe", name: "x", email: "x@x.test", active: true, roles: ["admin" as const], restaurantIds: [] as string[] };
  check("los permisos usan ese usuario sin leerlo otra vez de la base", (await canJoinRestaurant({ userId: "no-existe", user: fantasma }, REST)) === true);
  check("  sin usuario cargado lo leen de la base (uno que no existe no entra)", (await canJoinRestaurant({ userId: "no-existe" }, REST)) === false);

  // 2. cookieCache: tope de 5 min y cortes inmediatos donde importa.
  const opts = (getAuth() as unknown as { options: { session?: { cookieCache?: { enabled?: boolean; maxAge?: number } } } }).options;
  const maxAge = opts.session?.cookieCache?.maxAge ?? Number.POSITIVE_INFINITY;
  check("cookieCache activa y con tope de 5 minutos o menos", opts.session?.cookieCache?.enabled === true && maxAge <= 300, String(maxAge));
  const { deleteUser } = await import("@/lib/auth/users");
  async function fullCookie(email: string) {
    const id = await createUserWithPassword({ name: email, email, password: PASSWORD, roles: ["restaurante"], restaurantIds: [REST] });
    const res = await getAuth().api.signInEmail({ body: { email, password: PASSWORD }, returnHeaders: true });
    return { id, cookie: res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ") };
  }
  const c1 = await fullCookie("cache1@verify.test");
  check("el inicio de sesión deja la cookie de caché", c1.cookie.includes("session_data"));
  check("  con la cookie completa entra", (await identifyRequest(new Headers({ cookie: c1.cookie })))?.userId === c1.id);
  await setUserActive(c1.id, false);
  check("desactivar corta al instante aunque la caché siga vigente", (await identifyRequest(new Headers({ cookie: c1.cookie }))) === null);
  const c2 = await fullCookie("cache2@verify.test");
  check("  la cuenta nueva entra con su cookie completa", (await identifyRequest(new Headers({ cookie: c2.cookie })))?.userId === c2.id);
  await deleteUser(c2.id);
  check("eliminar la cuenta corta al instante aunque la caché siga vigente", (await identifyRequest(new Headers({ cookie: c2.cookie }))) === null);

  // 3. El cliente: pausa con la pantalla oculta, espaciado sin actividad y vuelta al ritmo rápido.
  const quietCookie = (await fullCookie("quiet@verify.test")).cookie;
  const polls: number[] = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = ((input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    if (headers.cookie === quietCookie && String(input).includes("desde=")) polls.push(Date.now());
    return realFetch(input, init);
  }) as typeof fetch;
  const visibility = new Set<() => void>();
  const fakeDocument = {
    visibilityState: "visible" as "visible" | "hidden",
    addEventListener: (_: string, l: () => void) => void visibility.add(l),
    removeEventListener: (_: string, l: () => void) => void visibility.delete(l),
  };
  (globalThis as { document?: unknown }).document = fakeDocument;
  const setVisible = (v: "visible" | "hidden") => {
    fakeDocument.visibilityState = v;
    for (const l of [...visibility]) l();
  };
  const lastGap = () => (polls.length >= 2 ? polls[polls.length - 1] - polls[polls.length - 2] : 0);

  const q = new RealtimeClient({ baseUrl: url, headers: { cookie: quietCookie }, fastMs: 20, slowMs: 300, quietAfter: 3, quietStepMs: 40, resyncAfterHiddenMs: 150, maxBackoffMs: 200 });
  await new Promise<void>((res) => {
    q.once("connect", () => res());
    q.connect();
  });
  check("el cliente de prueba entra a su room", (await ask(q, "restaurant:join", { restaurantId: REST })).ok);
  let connects = 0;
  q.on("connect", () => (connects += 1));
  const remote = counter(q, "waitlist:changed");

  check("sin actividad, el sondeo se espacia poco a poco", await waitFor(() => lastGap() >= 200), `${lastGap()} ms`);
  const base = remote.length;
  await ask(hostA, "waitlist:add", { customerName: "Aviso para el cliente tranquilo", partySize: 2, notes: "" });
  check("  un aviso remoto llega aunque esté espaciado", await waitFor(() => remote.length > base));
  check("  y tras el aviso vuelve al ritmo rápido", await waitFor(() => lastGap() > 0 && lastGap() <= 120), `${lastGap()} ms`);

  await waitFor(() => lastGap() >= 200);
  await ask(q, "restaurant:join", { restaurantId: REST });
  check("  hacer algo aquí (un POST) también vuelve al ritmo rápido", await waitFor(() => lastGap() > 0 && lastGap() <= 120), `${lastGap()} ms`);

  // Oculta: no pregunta.
  setVisible("hidden");
  await sleep(100);
  const parados = polls.length;
  await sleep(500);
  check("con la pantalla oculta o bloqueada no pregunta", polls.length === parados, `${polls.length - parados} preguntas`);
  check("  y aun así puede mandar acciones", (await ask(q, "restaurant:join", { restaurantId: REST })).ok);
  const antes = connects;
  setVisible("visible");
  check("al volver pregunta al instante", await waitFor(() => polls.length > parados, 2000));
  check("  y tras un rato oculta recarga el estado completo (connect)", await waitFor(() => connects > antes, 3000));

  // Una ausencia corta no recarga todo.
  const tras = connects;
  setVisible("hidden");
  await sleep(20);
  setVisible("visible");
  const desde = polls.length;
  await waitFor(() => polls.length >= desde + 3, 3000);
  check("  una ausencia corta no recarga entero", connects === tras, `${connects - tras}`);

  q.close();
  globalThis.fetch = realFetch;
  delete (globalThis as { document?: unknown }).document;
}

hostA.close();
hostB.close();
otro.close();
analitica.close();
await new Promise<void>((r) => httpServer.close(() => r()));

// ---------------------------------------------------------------------------

// Mismo motivo que en verify-editor: en Windows el fichero puede seguir
// pillado por la conexión abierta. Se borra al principio de la siguiente.
try {
  rmSync(DB_FILE, { force: true });
} catch {
  // Deliberadamente ignorado, ver arriba.
}

console.log(`\n${passed} comprobaciones ok, ${failures.length} fallos`);
if (failures.length > 0) {
  console.log(`\nFallan: ${failures.join(", ")}`);
  process.exit(1);
}
console.log("Tiempo real verificado.");
process.exit(0);
