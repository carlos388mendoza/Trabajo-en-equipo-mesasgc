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
//
// Usa una base SQLite temporal (`.verify-realtime.db`) con la migración real
// del repo. NO ejecuta `drizzle-kit push`, por lo mismo que `verify-editor`:
// leería el TURSO_DATABASE_URL del entorno y podría vaciar una base de verdad.

import { readFileSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { resolve } from "node:path";

import { config } from "dotenv";

// Antes de cualquier acceso a `db`, que lee la variable en el primer uso.
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });
const DB_FILE = resolve(process.cwd(), ".verify-realtime.db");
rmSync(DB_FILE, { force: true });
process.env.TURSO_DATABASE_URL = `file:${DB_FILE}`;

const { createClient } = await import("@libsql/client");
const { eq } = await import("drizzle-orm");
const { io: ioClient } = await import("socket.io-client");
const { db } = await import("@/lib/db");
const { elementTypes, restaurants, tableLayouts, tables, waitlistEntries } = await import(
  "@/lib/db/schema"
);
const { assignTable, releaseTable } = await import("@/lib/tables/assign");
const { attachRealtime } = await import("@/lib/realtime/server");
const { emitToRestaurant } = await import("@/lib/realtime/registry");

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

const migration = readFileSync(resolve(process.cwd(), "drizzle/0000_loose_post.sql"), "utf8");
const bootstrap = createClient({ url: `file:${DB_FILE}` });
await bootstrap.executeMultiple(migration);
await bootstrap.close();
check("la migración del repo se aplica", true);

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

function connect(): Promise<Client> {
  return new Promise((res, rej) => {
    const c = ioClient(url, { transports: ["websocket"], reconnection: false });
    c.once("connect", () => res(c));
    c.once("connect_error", rej);
  });
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

const hostA = await connect();
const hostB = await connect();
const otro = await connect();
check("tres clientes conectados por WebSocket", hostA.connected && hostB.connected && otro.connected);

{
  const r = await ask(hostA, "table:assign", { tableId: "m-socket", entryId: "socket-a" });
  check("asignar sin haber entrado en un restaurante se rechaza", !r.ok && /Primero/.test(r.error ?? ""));
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

hostA.close();
hostB.close();
otro.close();
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
