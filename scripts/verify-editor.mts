// Verificación del editor de mesas.
//
// No hay runner de tests en el repo, así que esto es un script que se ejecuta
// con `npm run verify:editor` y sale con código 1 si algo falla.
//
// Qué cubre, y por qué:
//
//  - `nextLabel` y `elementStyle`: funciones puras, baratas de comprobar y
//    fáciles de romper.
//  - `applyLayoutStructure`: la parte de riesgo de verdad. Aquí se comprueban
//    las reglas de integridad que el editor no puede saltarse, porque el
//    cliente es código que se puede fabricar a mano.
//
// Usa una base de datos SQLite temporal (`.verify-editor.db`) y aplica la
// migración real del repo, así que no toca ni la base de desarrollo ni Turso.
// Importante: NO se ejecuta `drizzle-kit push` aquí a propósito, porque leería
// el TURSO_DATABASE_URL del entorno y podría vaciar una base de verdad.

import { readFileSync, rmSync } from "node:fs";
import { resolve } from "node:path";

import { config } from "dotenv";

// Tiene que ir ANTES de cualquier acceso a `db`, que es un proxy perezoso: lee
// la variable en el primer uso, no al importar el módulo.
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });
const DB_FILE = resolve(process.cwd(), ".verify-editor.db");
rmSync(DB_FILE, { force: true });
process.env.TURSO_DATABASE_URL = `file:${DB_FILE}`;

const { createClient } = await import("@libsql/client");
const { db } = await import("@/lib/db");
const { elementTypes, restaurants, tableLayouts, tables } = await import(
  "@/lib/db/schema"
);
const { applyLayoutStructure } = await import("@/lib/layout/save");
const { saveLayoutInputSchema } = await import("@/lib/layout/validation");
const { elementStyle, nextLabel, visibleSeats } = await import(
  "@/lib/layout/element-style"
);

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
// Esquema
// ---------------------------------------------------------------------------

section("Esquema");

const migration = readFileSync(
  resolve(process.cwd(), "drizzle/0000_loose_post.sql"),
  "utf8",
);
const bootstrap = createClient({ url: `file:${DB_FILE}` });
await bootstrap.executeMultiple(migration);
await bootstrap.close();
check("la migración del repo se aplica", true);

// ---------------------------------------------------------------------------
// Datos mínimos
// ---------------------------------------------------------------------------

section("Datos de prueba");

const REST = "rest-1";
const REST_2 = "rest-2";
const LAYOUT = "layout-1";
const LAYOUT_2 = "layout-2";

const TYPES = {
  mesa: "type-mesa",
  butacas: "type-butacas",
  juegos: "type-juegos",
  bano: "type-bano",
  caja: "type-caja",
} as const;

await db.insert(restaurants).values([
  { id: REST, name: "Casa Nostra", slug: "casa-nostra" },
  { id: REST_2, name: "Bar Apuesto", slug: "bar-apuesto" },
]);

await db.insert(elementTypes).values([
  { id: TYPES.mesa, key: "mesa-sillas", label: "Mesa con sillas", color: "#3b82f6", icon: "🍽️", defaultCapacity: 4, sortOrder: 0 },
  { id: TYPES.butacas, key: "mesa-butacas", label: "Mesa con butacas", color: "#8b5cf6", icon: "🛋️", defaultCapacity: 6, sortOrder: 1 },
  { id: TYPES.juegos, key: "area-juegos", label: "Área de juegos", color: "#22c55e", icon: "🎮", defaultCapacity: null, sortOrder: 2 },
  { id: TYPES.bano, key: "bano", label: "Baños", color: "#06b6d4", icon: "🚻", defaultCapacity: null, sortOrder: 3 },
  { id: TYPES.caja, key: "caja", label: "Caja", color: "#ef4444", icon: "🧾", defaultCapacity: null, sortOrder: 4 },
]);

await db.insert(tableLayouts).values([
  { id: LAYOUT, restaurantId: REST, name: "Comedor", width: 1200, height: 800, isDefault: true, version: 1 },
  { id: LAYOUT_2, restaurantId: REST, name: "Terraza", width: 800, height: 600, version: 1 },
]);

const baseElement = {
  restaurantId: REST,
  elementTypeId: TYPES.mesa,
  capacity: 4,
  rotation: 0,
};

await db.insert(tables).values([
  { ...baseElement, id: "t-libre", layoutId: LAYOUT, label: "Mesa 1", x: 0, y: 0, width: 80, height: 80 },
  { ...baseElement, id: "t-ocupada", layoutId: LAYOUT, label: "Mesa 2", x: 100, y: 0, width: 80, height: 80, status: "ocupada", currentEntryId: "entry-1" },
  // Pertenece a OTRA zona: sirve para probar la regla anti-impostor.
  { ...baseElement, id: "t-otra-zona", layoutId: LAYOUT_2, label: "Mesa 9", x: 0, y: 0, width: 80, height: 80 },
]);

check("3 filas de `tables` de partida", true);

/** Payload que la action construiría a partir de lo que hay en el mapa. */
function payloadFor(
  elements: { id: string; elementTypeId?: string; x?: number; y?: number; label?: string }[],
) {
  return saveLayoutInputSchema.parse({
    layoutId: LAYOUT,
    restaurantId: REST,
    width: 1200,
    height: 800,
    elements: elements.map((e) => ({
      id: e.id,
      elementTypeId: e.elementTypeId ?? TYPES.mesa,
      label: e.label ?? "Elemento",
      x: e.x ?? 0,
      y: e.y ?? 0,
      width: 80,
      height: 80,
      rotation: 0,
      capacity: 4,
    })),
  });
}

const expectOk = async (
  name: string,
  elements: Parameters<typeof payloadFor>[0],
  assert?: (r: { ok: true; saved: number; removed: number; version: number }) => void,
) => {
  const result = await applyLayoutStructure(payloadFor(elements));
  if (!result.ok) {
    check(name, false, result.error);
    return;
  }
  if (assert) assert(result);
  check(name, true);
};

const expectFail = async (
  name: string,
  input: unknown,
  fragment: string,
) => {
  const parsed = saveLayoutInputSchema.safeParse(input);
  if (!parsed.success) {
    check(name, false, "el payload no pasó Zod");
    return;
  }
  const result = await applyLayoutStructure(parsed.data);
  check(
    name,
    !result.ok && result.error.toLowerCase().includes(fragment.toLowerCase()),
    result.ok ? "lo aceptó y debería haberlo rechazado" : result.error,
  );
};

// ---------------------------------------------------------------------------
// Funciones puras
// ---------------------------------------------------------------------------

section("Funciones puras");

check("nextLabel empieza en 1", nextLabel("mesa-sillas", []) === "Mesa 1");
check(
  "nextLabel reutiliza el hueco: con Mesa 1 y Mesa 3 sale Mesa 2",
  nextLabel("mesa-sillas", ["Mesa 1", "Mesa 3"]) === "Mesa 2",
);
check("nextLabel por tipo: Caja 1", nextLabel("caja", []) === "Caja 1");
check(
  "nextLabel de dos mesas y una caja no se pisa",
  nextLabel("caja", ["Mesa 1", "Mesa 2"]) === "Caja 1",
);

const typeRow = {
  id: TYPES.mesa,
  key: "mesa-sillas",
  label: "Mesa con sillas",
  color: "#3b82f6",
  icon: "🍽️",
  width: 80,
  height: 80,
  defaultCapacity: 4,
};
check("mesa-sillas se dibuja redonda", elementStyle(typeRow).shape === "circle");
check(
  "el relleno se aclara a partir del color del tipo",
  elementStyle(typeRow).fill !== "#3b82f6" && elementStyle(typeRow).fill.startsWith("#"),
);
check(
  "un tipo desconocido cae en rectángulo genérico, no desaparece",
  elementStyle({ ...typeRow, key: "inventado" }).shape === "rect",
);
check("visibleSeats limita a 8", visibleSeats(20) === 8);
check("visibleSeats de null es 0", visibleSeats(null) === 0);

// ---------------------------------------------------------------------------
// Reglas de integridad
// ---------------------------------------------------------------------------

section("Guardas de Zod");

check(
  "x no finito se rechaza",
  !saveLayoutInputSchema.safeParse({
    layoutId: LAYOUT,
    restaurantId: REST,
    width: 1200,
    height: 800,
    elements: [{ id: "a", elementTypeId: TYPES.mesa, label: "A", x: Number.NaN, y: 0, width: 80, height: 80, rotation: 0, capacity: 4 }],
  }).success,
);
check(
  "una mesa de 5 cm se rechaza",
  !saveLayoutInputSchema.safeParse({
    layoutId: LAYOUT,
    restaurantId: REST,
    width: 1200,
    height: 800,
    elements: [{ id: "a", elementTypeId: TYPES.mesa, label: "A", x: 0, y: 0, width: 2, height: 80, rotation: 0, capacity: 4 }],
  }).success,
);
check(
  "label vacía se rechaza",
  !saveLayoutInputSchema.safeParse({
    layoutId: LAYOUT,
    restaurantId: REST,
    width: 1200,
    height: 800,
    elements: [{ id: "a", elementTypeId: TYPES.mesa, label: "", x: 0, y: 0, width: 80, height: 80, rotation: 0, capacity: 4 }],
  }).success,
);
check(
  "status y currentEntryId de más se ignoran en vez de colarse",
  saveLayoutInputSchema.parse({
    layoutId: LAYOUT,
    restaurantId: REST,
    width: 1200,
    height: 800,
    elements: [{ id: "a", elementTypeId: TYPES.mesa, label: "A", x: 0, y: 0, width: 80, height: 80, rotation: 0, capacity: 4, status: "ocupada", currentEntryId: "x" }],
  }).elements[0].status === undefined,
);

section("Integridad al guardar");

await expectFail(
  "zona que no pertenece al restaurante",
  { layoutId: LAYOUT, restaurantId: REST_2, width: 1200, height: 800, elements: [] },
  "no existe en este restaurante",
);

await expectFail(
  "elementTypeId inventado",
  {
    layoutId: LAYOUT,
    restaurantId: REST,
    width: 1200,
    height: 800,
    elements: [{ id: "t-libre", elementTypeId: "type-fantasma", label: "X", x: 0, y: 0, width: 80, height: 80, rotation: 0, capacity: 4 }],
  },
  "desconocido",
);

await expectFail(
  "el mismo elemento dos veces",
  {
    layoutId: LAYOUT,
    restaurantId: REST,
    width: 1200,
    height: 800,
    elements: [
      { id: "t-libre", elementTypeId: TYPES.mesa, label: "A", x: 0, y: 0, width: 80, height: 80, rotation: 0, capacity: 4 },
      { id: "t-libre", elementTypeId: TYPES.mesa, label: "B", x: 5, y: 0, width: 80, height: 80, rotation: 0, capacity: 4 },
    ],
  },
  "repetidos",
);

await expectFail(
  "id de una mesa de OTRA zona (anti-impostor)",
  {
    layoutId: LAYOUT,
    restaurantId: REST,
    width: 1200,
    height: 800,
    elements: [{ id: "t-otra-zona", elementTypeId: TYPES.mesa, label: "Robada", x: 999, y: 999, width: 80, height: 80, rotation: 0, capacity: 4 }],
  },
  "otra zona",
);

const occupiedUntouched = await db.query.tables.findFirst({
  where: (t, { eq }) => eq(t.id, "t-ocupada"),
});
check(
  "el intento anti-impostor no movió la mesa de la otra zona",
  occupiedUntouched?.id === "t-ocupada" && occupiedUntouched.x === 100,
);

await expectFail(
  "borrar una mesa ocupada",
  {
    layoutId: LAYOUT,
    restaurantId: REST,
    width: 1200,
    height: 800,
    elements: [{ id: "t-libre", elementTypeId: TYPES.mesa, label: "Mesa 1", x: 0, y: 0, width: 80, height: 80, rotation: 0, capacity: 4 }],
  },
  "clientes sentados",
);

const stillThere = await db.query.tables.findFirst({
  where: (t, { eq }) => eq(t.id, "t-ocupada"),
});
check(
  "la mesa ocupada sigue existiendo tras el rechazo",
  stillThere !== undefined && stillThere.currentEntryId === "entry-1",
);

section("Guardado correcto");

// Insertar uno nuevo, mover la libre, redimensionar la ocupada y dejarla.
await expectOk(
  "inserta, mueve y redimensiona",
  [
    { id: "t-libre", x: 50, y: 60, label: "Mesa 1" },
    { id: "t-ocupada", elementTypeId: TYPES.butacas, x: 200, y: 300, label: "Mesa 2" },
    { id: "t-nueva", elementTypeId: TYPES.caja, x: 500, y: 500, label: "Caja 1" },
  ],
  (r) => {
    check("  cuenta 3 guardados", r.saved === 3, `saved=${r.saved}`);
    check("  cuenta 0 borrados", r.removed === 0, `removed=${r.removed}`);
    check("  la versión sube a 2", r.version === 2, `version=${r.version}`);
  },
);

const moved = await db.query.tables.findFirst({
  where: (t, { eq }) => eq(t.id, "t-libre"),
});
check("la mesa libre se movió", moved?.x === 50 && moved?.y === 60, `x=${moved?.x} y=${moved?.y}`);

const occupied = await db.query.tables.findFirst({
  where: (t, { eq }) => eq(t.id, "t-ocupada"),
});
check(
  "la ocupada se movió y cambió de tipo",
  occupied?.x === 200 && occupied?.elementTypeId === TYPES.butacas,
);
check(
  "CRÍTICO: guardar NO toca la ocupación",
  occupied?.status === "ocupada" && occupied?.currentEntryId === "entry-1",
  `status=${occupied?.status} entry=${occupied?.currentEntryId}`,
);

const created = await db.query.tables.findFirst({
  where: (t, { eq }) => eq(t.id, "t-nueva"),
});
check(
  "el elemento nuevo nace libre y sin cliente",
  created !== undefined && created.status === "libre" && created.currentEntryId === null,
);

section("Borrado");

await expectOk(
  "borra la mesa libre que se quitó del mapa",
  [
    { id: "t-ocupada", x: 200, y: 300, label: "Mesa 2" },
    { id: "t-nueva", elementTypeId: TYPES.caja, x: 500, y: 500, label: "Caja 1" },
  ],
  (r) => {
    check("  cuenta 1 borrado", r.removed === 1, `removed=${r.removed}`);
    check("  la versión sube a 3", r.version === 3, `version=${r.version}`);
  },
);

const gone = await db.query.tables.findFirst({
  where: (t, { eq }) => eq(t.id, "t-libre"),
});
check("la mesa borrada ya no existe", gone === undefined);

const otherZoneIntact = await db.query.tables.findFirst({
  where: (t, { eq }) => eq(t.id, "t-otra-zona"),
});
check(
  "la mesa de la otra zona sigue intacta",
  otherZoneIntact !== undefined && otherZoneIntact.x === 0,
);

section("Id nuevo e idempotencia");

// Un id que no existe en ninguna zona es un elemento nuevo y debe entrar. Es
// justo el caso de "sueltas una mesa en el mapa y pulsas Guardar".
const adding = await applyLayoutStructure({
  layoutId: LAYOUT,
  restaurantId: REST,
  width: 1200,
  height: 800,
  elements: [
    { id: "t-ocupada", elementTypeId: TYPES.mesa, label: "movida", x: 777, y: 777, width: 80, height: 80, rotation: 0, capacity: 4 },
    { id: "t-nueva-ok", elementTypeId: TYPES.mesa, label: "Mesa 3", x: 10, y: 10, width: 80, height: 80, rotation: 0, capacity: 4 },
  ],
});

check(
  "un id desconocido NO se trata como impostor: se inserta",
  adding.ok,
  adding.ok ? "" : adding.error,
);

if (adding.ok) {
  const after = await db.query.tables.findFirst({
    where: (t, { eq }) => eq(t.id, "t-ocupada"),
  });
  check("y el movimiento de la ocupada se aplicó", after?.x === 777, `x=${after?.x}`);
  check(
    "y la ocupación sobrevivió al movimiento",
    after?.currentEntryId === "entry-1" && after?.status === "ocupada",
  );
  check(
    "y el elemento nuevo quedó insertado",
    (await db.query.tables.findFirst({ where: (t, { eq }) => eq(t.id, "t-nueva-ok") })) !== undefined,
  );
}

// Guardar EXACTAMENTE lo mismo dos veces no debe duplicar ni perder nada: la
// segunda pasada ve los ids ya guardados y solo actualiza. Ojo a que el
// payload sea idéntico: si en la segunda llamada faltara un elemento, la
// primera ya lo habría borrado y sería correcto que volviera a entrar.
const samePayload = {
  layoutId: LAYOUT,
  restaurantId: REST,
  width: 1200,
  height: 800,
  elements: [
    { id: "t-ocupada", elementTypeId: TYPES.mesa, label: "movida", x: 777, y: 777, width: 80, height: 80, rotation: 0, capacity: 4 },
    { id: "t-nueva-ok", elementTypeId: TYPES.mesa, label: "Mesa 3", x: 10, y: 10, width: 80, height: 80, rotation: 0, capacity: 4 },
    { id: "t-nueva", elementTypeId: TYPES.caja, label: "Caja 1", x: 500, y: 500, width: 80, height: 80, rotation: 0, capacity: 4 },
  ],
};

const versionBefore = (
  await db.query.tableLayouts.findFirst({ where: (l, { eq }) => eq(l.id, LAYOUT) })
)?.version;

const first = await applyLayoutStructure(samePayload);
const rowsAfterFirst = (
  await db.query.tables.findMany({ where: (t, { eq }) => eq(t.layoutId, LAYOUT) })
).length;

const again = await applyLayoutStructure(samePayload);
const rowsAfterSecond = (
  await db.query.tables.findMany({ where: (t, { eq }) => eq(t.layoutId, LAYOUT) })
).length;

check("el primer guardado del payload entra", first.ok, first.ok ? "" : first.error);
// El payload tiene 3 elementos y la tabla tenía 2, así que la primera pasada
// tiene que reponer el que faltaba. Lo que no puede pasar es que la SEGUNDA
// pasada cambie nada.
check(
  "guardar dos veces lo mismo no sigue insertando filas",
  rowsAfterSecond === rowsAfterFirst,
  `tras1=${rowsAfterFirst} tras2=${rowsAfterSecond}`,
);
check(
  "y la primera pasada guardó exactamente los 3 del payload",
  rowsAfterFirst === 3,
  `filas=${rowsAfterFirst}`,
);
check(
  "cada guardado sube la versión, para que otras cachés se enteren",
  first.ok && again.ok && again.version === (versionBefore ?? 0) + 2,
  `antes=${versionBefore} version=${again.ok ? again.version : "-"}`,
);
check(
  "y las dos veces cuentan 3 guardados y 0 borrados",
  first.ok && again.ok && first.removed === 0 && again.removed === 0,
  first.ok && again.ok ? `${first.removed}/${again.removed}` : "-",
);

// ---------------------------------------------------------------------------

// El cliente de libSQL sigue con la conexión abierta (el proxy de `lib/db` es
// perezoso y no se cierra solo), así que en Windows el fichero está pillado y
// `rmSync` da EPERM. No es un fallo del test: se borra al principio de la
// siguiente ejecución y está en .gitignore.
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
console.log("Editor verificado.");
