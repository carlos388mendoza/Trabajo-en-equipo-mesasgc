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
const { io: ioClient } = await import("socket.io-client");
const { db } = await import("@/lib/db");
const { elementTypes, restaurants, tableLayouts, tables, waitlistEntries } = await import(
  "@/lib/db/schema"
);
const { assignTable, releaseTable } = await import("@/lib/tables/assign");
const { attachRealtime } = await import("@/lib/realtime/server");
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

section("Socket.IO: rooms y avisos");

const httpServer = createServer();
const io = attachRealtime(httpServer);
await new Promise<void>((r) => httpServer.listen(0, r));
const url = `http://localhost:${(httpServer.address() as AddressInfo).port}`;

type Client = ReturnType<typeof ioClient>;
type AnyAck = { ok: boolean; error?: string };

/** Conecta con la cookie de sesión de `cookie` (o sin ella). */
function connect(cookie?: string): Promise<Client> {
  return new Promise((res, rej) => {
    const c = ioClient(url, {
      transports: ["websocket"],
      reconnection: false,
      extraHeaders: cookie ? { cookie } : {},
    });
    c.once("connect", () => res(c));
    c.once("connect_error", rej);
  });
}

// El handshake exige sesión de Better Auth: tres usuarios de prueba.
//  - hostA: admin (entra en cualquier restaurante).
//  - hostB: rol restaurante en REST.
//  - otro:  rol restaurante en REST_2.
const { createUserWithPassword, setUserAccess, setUserActive } = await import("@/lib/auth/users");
const { getAuth } = await import("@/lib/auth/auth");
async function sessionCookie(email: string, roles: ("admin" | "restaurante" | "analitica")[], restaurantIds: string[]) {
  await createUserWithPassword({ name: email, email, password: "12345abc", roles, restaurantIds });
  const res = await getAuth().api.signInEmail({
    body: { email, password: "12345abc" },
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
  return c.timeout(3000).emitWithAck(event, payload);
}
/** Cuenta los avisos que recibe un cliente. */
function counter(c: Client, event: string) {
  const got: unknown[] = [];
  c.on(event, (p: unknown) => got.push(p));
  return got;
}
const settle = () => new Promise((r) => setTimeout(r, 300));

const hostA = await connect(cookieA);
const hostB = await connect(cookieB);
const otro = await connect(cookieOtro);
const analitica = await connect(cookieAnalitica);
check("cuatro clientes conectados por WebSocket", hostA.connected && hostB.connected && otro.connected && analitica.connected);

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
// «Ver todas las cartas»: quién resolvió, volver a la espera y deshacerlo
// ---------------------------------------------------------------------------

section("Ver todas las cartas: volver a la espera");

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

// ---------------------------------------------------------------------------
// «Ver todas las cartas»: eliminar un cliente de la fila
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
  check("un cliente con mesa ocupada no se elimina", !seated.ok && /mesa ocupada/.test(seated.error ?? ""), seated.error);
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
  hostA.emit("table:assign", { tableId: "m2", entryId: "pepa" });
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
  emitToRestaurant(REST, "layout:updated", { layoutId: "layout-1", version: 7 });
  await settle();
  check("emitToRestaurant llega a la room por globalThis", layoutA.length === 1);
  check("  y no a otros restaurantes", layoutOtro.length === 0);
}

{
  // Un socket está en un solo restaurante: cambiar sale del anterior.
  await ask(hostA, "restaurant:join", { restaurantId: REST_2 });
  const layoutA = counter(hostA, "layout:updated");
  emitToRestaurant(REST, "layout:updated", { layoutId: "layout-1", version: 8 });
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
  emitToRestaurant(REST, "layout:updated", { layoutId: "layout-1", version: 20 });
  await settle();
  check("  y recibe sus avisos", layouts.length === 1);
  check("  cambia al segundo", (await ask(varios, "restaurant:join", { restaurantId: REST_2 })).ok);
  emitToRestaurant(REST, "layout:updated", { layoutId: "layout-1", version: 21 });
  emitToRestaurant(REST_2, "layout:updated", { layoutId: "layout-2", version: 5 });
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
  check("  y no avisa a nadie de su room", changesOtro.length === 0);

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

const COUNTER_KEYS = ["averageArrivedAt", "restaurantId", "tablesOccupied", "tablesReserved", "tablesTotal", "waiting"];

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
  check("emitOverview llega a la sala por globalThis", got.length === 1 && (got[0] as { restaurantId?: string }).restaurantId === REST_2);
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
  check("  y sale de la sala overview", !(await io.in("overview").fetchSockets()).some((s) => s.data.userId === session!.user.id));
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

hostA.close();
hostB.close();
otro.close();
analitica.close();
await new Promise<void>((r) => io.close(() => r()));

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
