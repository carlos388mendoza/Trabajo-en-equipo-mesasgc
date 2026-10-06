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

import { rmSync } from "node:fs";
import { resolve } from "node:path";

import { config } from "dotenv";

// Tiene que ir ANTES de cualquier acceso a `db`, que es un proxy perezoso: lee
// la variable en el primer uso, no al importar el módulo.
config({ path: resolve(process.cwd(), ".env.local"), quiet: true });
const DB_FILE = resolve(process.cwd(), ".verify-editor.db");
rmSync(DB_FILE, { force: true });
process.env.TURSO_DATABASE_URL = `file:${DB_FILE}`;

const { applyAllMigrations } = await import("./migrations.mts");
const { db } = await import("@/lib/db");
const { elementTypes, restaurants, tableLayouts, tables } = await import(
  "@/lib/db/schema"
);
const { applyLayoutStructure } = await import("@/lib/layout/save");
const { saveLayoutInputSchema } = await import("@/lib/layout/validation");
const { copyLayoutToRestaurant, copyZoneIntoLayout, getStructureCounts } =
  await import("@/lib/layout/copy");
const { getLayout } = await import("@/lib/db/queries/layouts");
const { planToRotated, rotatedSize, rotatedToPlan } = await import("@/lib/layout/geometry");
const { ELEMENT_TYPE_KEYS, asLayoutRotation, isSeatableElement } = await import("@/lib/db/enums");
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

const applied = await applyAllMigrations(`file:${DB_FILE}`);
check(`las migraciones del repo se aplican (${applied.length})`, applied.length > 0);

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
  { id: TYPES.mesa, key: "mesa-sillas", label: "Mesa con sillas", color: "#3b82f6", icon: "utensils", defaultCapacity: 4, sortOrder: 0 },
  { id: TYPES.butacas, key: "mesa-butacas", label: "Mesa con butacas", color: "#8b5cf6", icon: "sofa", defaultCapacity: 6, sortOrder: 1 },
  { id: TYPES.juegos, key: "area-juegos", label: "Área de juegos", color: "#22c55e", icon: "puzzle", defaultCapacity: null, sortOrder: 2 },
  { id: TYPES.bano, key: "bano", label: "Baños", color: "#06b6d4", icon: "toilet", defaultCapacity: null, sortOrder: 3 },
  { id: TYPES.caja, key: "caja", label: "Caja", color: "#ef4444", icon: "banknote", defaultCapacity: null, sortOrder: 4 },
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

section("Leyenda de meseros de «Ver clientes» (lib/waiters/legend.ts)");
{
  const { waiterLegend, waiterColorFor } = await import("@/lib/waiters/legend");
  const t = (waiterName: string | null, waiterColor: string | null) => ({ waiterName, waiterColor });
  check("sin zonas de meseros, no hay leyenda", waiterLegend([t(null, null), t(null, null)]).length === 0);
  const legend = waiterLegend([t("Marta", "#a855f7"), t("Luis", "#f59e0b"), t("Ana", "#3b82f6"), t("Luis", "#f59e0b"), t(null, null)]);
  check(
    "un mesero por nombre, todos los de la activa (también los de otra zona) y en el orden de su color",
    JSON.stringify(legend) === JSON.stringify([{ name: "Ana", color: "#3b82f6" }, { name: "Luis", color: "#f59e0b" }, { name: "Marta", color: "#a855f7" }]),
    JSON.stringify(legend),
  );
  check("el color de un cliente es el de su mesero", waiterColorFor(legend, "Luis") === "#f59e0b");
  check("  sin mesero, o con uno que ya no está en la activa: sin color (gris)", waiterColorFor(legend, null) === null && waiterColorFor(legend, "Pedro") === null);
}

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
  icon: "utensils",
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
// Paso 3: copiar estructura entre restaurantes
// ---------------------------------------------------------------------------

section("Copia entre restaurantes (paso 3)");

const COPY_FROM = "copy-src";
const COPY_TO_VACIA = "copy-dest-vacia";
const COPY_TO_LLENO = "copy-dest-lleno";
const COPY_TO_OCUPADA = "copy-dest-ocupada";

await db.insert(restaurants).values([
  { id: COPY_FROM, name: "Origen", slug: "copia-origen" },
  { id: COPY_TO_VACIA, name: "Destino Vacio", slug: "copia-vacio" },
  { id: COPY_TO_LLENO, name: "Destino Lleno", slug: "copia-lleno" },
  { id: COPY_TO_OCUPADA, name: "Destino Ocupado", slug: "copia-ocupado" },
]);

// El origen: 2 zonas y 3 elementos, uno de ellos ocupado a propósito.
const ORIG_A = "lay-orig-a";
const ORIG_B = "lay-orig-b";
await db.insert(tableLayouts).values([
  { id: ORIG_A, restaurantId: COPY_FROM, name: "Comedor", width: 1200, height: 800, isDefault: true, sortOrder: 0, version: 1 },
  { id: ORIG_B, restaurantId: COPY_FROM, name: "Terraza", width: 800, height: 600, isDefault: false, sortOrder: 1, version: 1 },
]);
await db.insert(tables).values([
  { id: "t-orig-1", restaurantId: COPY_FROM, layoutId: ORIG_A, elementTypeId: TYPES.mesa, label: "Mesa 1", x: 10, y: 20, width: 80, height: 80, capacity: 4, rotation: 0 },
  { id: "t-orig-2", restaurantId: COPY_FROM, layoutId: ORIG_A, elementTypeId: TYPES.caja, label: "Caja 1", x: 300, y: 40, width: 60, height: 40, capacity: null, rotation: 0 },
  // Esta mesa está ocupada. Si al copiarla se "!colara" su ocupación, el
  // destino aparecería con una mesa ocupada sin ningún cliente esperando.
  { id: "t-orig-3", restaurantId: COPY_FROM, layoutId: ORIG_B, elementTypeId: TYPES.mesa, label: "Mesa T1", x: 5, y: 5, width: 100, height: 60, capacity: 6, rotation: 0, status: "ocupada", currentEntryId: "entry-origen" },
]);

// El destino lleno: 1 zona con 1 mesa, y una zona con el MISMO nombre que una
// del origen, para chocar contra el índice único.
const LLENO_LAYOUT = "lay-lleno";
await db.insert(tableLayouts).values([
  { id: LLENO_LAYOUT, restaurantId: COPY_TO_LLENO, name: "Terraza", width: 400, height: 400, isDefault: true, version: 1 },
]);
await db.insert(tables).values([
  { id: "t-vieja", restaurantId: COPY_TO_LLENO, layoutId: LLENO_LAYOUT, elementTypeId: TYPES.mesa, label: "Vieja", x: 1, y: 1, width: 50, height: 50, capacity: 2, rotation: 0 },
]);

// El destino ocupado: su sustitución tiene que ser rechazada.
const OCUP_LAYOUT = "lay-ocup";
await db.insert(tableLayouts).values([
  { id: OCUP_LAYOUT, restaurantId: COPY_TO_OCUPADA, name: "Salon", width: 600, height: 600, isDefault: true, version: 1 },
]);
await db.insert(tables).values([
  { id: "t-con-gente", restaurantId: COPY_TO_OCUPADA, layoutId: OCUP_LAYOUT, elementTypeId: TYPES.mesa, label: "Con gente", x: 1, y: 1, width: 50, height: 50, capacity: 2, rotation: 0, status: "ocupada", currentEntryId: "entry-destino" },
]);

// Un tercer restaurante para el caso "la zona por defecto NO es la primera".
// El `select` no garantiza orden, así que una implementación que asuma que la
// por defecto es la fila 0 acierta aquí por casualidad y falla al reordenar.
const COPY_DEF_AL_TERIOR = "copy-def-al-terior";
await db.insert(restaurants).values([
  { id: COPY_DEF_AL_TERIOR, name: "Definitiva al final", slug: "copia-def-terior" },
]);
await db.insert(tableLayouts).values([
  { id: "lay-def-1", restaurantId: COPY_DEF_AL_TERIOR, name: "Almacen", width: 500, height: 400, isDefault: false, sortOrder: 0, version: 1 },
  { id: "lay-def-2", restaurantId: COPY_DEF_AL_TERIOR, name: "Comedor", width: 900, height: 700, isDefault: true, sortOrder: 1, version: 1 },
]);
await db.insert(tables).values([
  { id: "t-def-1", restaurantId: COPY_DEF_AL_TERIOR, layoutId: "lay-def-2", elementTypeId: TYPES.mesa, label: "Mesa D", x: 10, y: 10, width: 80, height: 80, capacity: 2, rotation: 0 },
]);

const copyDefault = await copyLayoutToRestaurant({
  sourceRestaurantId: COPY_DEF_AL_TERIOR,
  targetRestaurantId: "copy-def-destino",
  replace: false,
});
// El destino no existe, así que esto debe fallar y no crear nada.
check(
  "no se inventa un restaurante que no existe al copiar",
  !copyDefault.ok && copyDefault.error.includes("destino no existe"),
);

await db.insert(restaurants).values([
  { id: "copy-def-destino", name: "Destino De Def", slug: "copia-def-destino" },
]);
const copyDefaultOk = await copyLayoutToRestaurant({
  sourceRestaurantId: COPY_DEF_AL_TERIOR,
  targetRestaurantId: "copy-def-destino",
  replace: false,
});
check("copia de un origen con ladefault al final", copyDefaultOk.ok, copyDefaultOk.ok ? "" : copyDefaultOk.error);

const defLayouts = await db.query.tableLayouts.findMany({
  where: (l, { eq }) => eq(l.restaurantId, "copy-def-destino"),
});
const defDefaults = defLayouts.filter((l) => l.isDefault);
check(
  "la zona por defecto se copia aunque no sea la primera",
  defDefaults.length === 1 && defDefaults[0].name === "Comedor",
  defLayouts.map((l) => `${l.name}:${l.isDefault}`).join(" | "),
);

// --- rechazos ---

const sameOnBoth = await copyLayoutToRestaurant({
  sourceRestaurantId: COPY_FROM,
  targetRestaurantId: COPY_FROM,
  replace: false,
});
check(
  "copiar a sí mismo se rechaza",
  !sameOnBoth.ok && sameOnBoth.error.includes("distinto"),
);

const missingTarget = await copyLayoutToRestaurant({
  sourceRestaurantId: COPY_FROM,
  targetRestaurantId: "no-existe",
  replace: false,
});
check(
  "destino inexistente se rechaza",
  !missingTarget.ok && missingTarget.error.includes("destino no existe"),
);

const toFullNoReplace = await copyLayoutToRestaurant({
  sourceRestaurantId: COPY_FROM,
  targetRestaurantId: COPY_TO_LLENO,
  replace: false,
});
check(
  "destino con estructura y sin `replace` se rechaza",
  !toFullNoReplace.ok && toFullNoReplace.error.includes("ya tiene"),
);
check(
  "el mensaje dice cuántas zonas hay",
  !toFullNoReplace.ok && toFullNoReplace.error.includes("1 zona(s)"),
);
const fullIntact = await getStructureCounts(COPY_TO_LLENO);
check(
  "y el destino intacto tras el rechazo",
  fullIntact.zones === 1 && fullIntact.elements === 1,
  `zonas=${fullIntact.zones} elementos=${fullIntact.elements}`,
);

const toOccupied = await copyLayoutToRestaurant({
  sourceRestaurantId: COPY_FROM,
  targetRestaurantId: COPY_TO_OCUPADA,
  replace: true,
});
check(
  "destino con mesas ocupadas se rechaza aunque venga replace",
  !toOccupied.ok && toOccupied.error.includes("sentados"),
  toOccupied.ok ? "lo aceptó" : toOccupied.error,
);
const occupiedIntact = await db.query.tables.findMany({
  where: (t, { eq }) => eq(t.restaurantId, COPY_TO_OCUPADA),
});
check(
  "y sus mesas ocupadas siguen ahí",
  occupiedIntact.length === 1 && occupiedIntact[0].currentEntryId === "entry-destino",
);

// --- copia a un destino vacío ---

const copied = await copyLayoutToRestaurant({
  sourceRestaurantId: COPY_FROM,
  targetRestaurantId: COPY_TO_VACIA,
  replace: false,
});

check("copia a destino vacío", copied.ok, copied.ok ? "" : copied.error);
if (copied.ok) {
  check("  copia 2 zonas", copied.zones === 2, `zones=${copied.zones}`);
  check("  copia 3 elementos", copied.elements === 3, `elements=${copied.elements}`);
  check("  marca que no sustituyó", copied.replaced === false);
  check("  dice el nombre del destino", copied.targetName === "Destino Vacio");
}

const destLayouts = await db.query.tableLayouts.findMany({
  where: (l, { eq }) => eq(l.restaurantId, COPY_TO_VACIA),
});
check(
  "las zonas del destino heredan nombre y tamaño del origen",
  destLayouts.length === 2 &&
    destLayouts.some((l) => l.name === "Comedor" && l.width === 1200 && l.height === 800) &&
    destLayouts.some((l) => l.name === "Terraza" && l.width === 800 && l.height === 600),
  destLayouts.map((l) => `${l.name} ${l.width}x${l.height}`).join(" | "),
);
check(
  "la zona por defecto se copia",
  destLayouts.filter((l) => l.isDefault).length === 1,
);

const destElements = await db.query.tables.findMany({
  where: (t, { eq }) => eq(t.restaurantId, COPY_TO_VACIA),
});
check("los 3 elementos están en el destino", destElements.length === 3, `n=${destElements.length}`);

const sourceElementIds = (
  await db.query.tables.findMany({ where: (t, { eq }) => eq(t.restaurantId, COPY_FROM) })
).map((t) => t.id);
const destElementIds = destElements.map((t) => t.id);
check(
  "CRÍTICO: los ids son nuevos, ninguno se repite",
  destElementIds.every((id) => !sourceElementIds.includes(id)),
);
check(
  "CRÍTICO: las mesas del destino nacen LIBRES",
  destElements.every((t) => t.status === "libre" && t.currentEntryId === null),
  destElements.map((t) => `${t.label}:${t.status}`).join(","),
);
check(
  "la geometría y los puestos se copian tal cual",
  destElements.some((t) => t.label === "Mesa 1" && t.x === 10 && t.y === 20 && t.capacity === 4) &&
    destElements.some((t) => t.label === "Caja 1" && t.width === 60 && t.height === 40 && t.capacity === null),
);

// --- copia con reemplazo ---

const replaced = await copyLayoutToRestaurant({
  sourceRestaurantId: COPY_FROM,
  targetRestaurantId: COPY_TO_LLENO,
  replace: true,
});
check("copia con reemplazo", replaced.ok, replaced.ok ? "" : replaced.error);
if (replaced.ok) {
  check("  avisa de que sustituyó", replaced.replaced === true);
}

const afterReplace = await db.query.tableLayouts.findMany({
  where: (l, { eq }) => eq(l.restaurantId, COPY_TO_LLENO),
});
const afterReplaceElements = await db.query.tables.findMany({
  where: (t, { eq }) => eq(t.restaurantId, COPY_TO_LLENO),
});
check(
  "sustituye TODO lo del destino, no añade encima",
  afterReplace.length === 2 && afterReplaceElements.length === 3,
  `zonas=${afterReplace.length} elementos=${afterReplaceElements.length}`,
);
check(
  "la mesa Vieja desapareció",
  !afterReplaceElements.some((t) => t.label === "Vieja"),
);
check(
  "los nombres del origen se reutilizan tal cual, porque el destino se vació antes",
  afterReplace.some((l) => l.name === "Terraza") &&
    afterReplace.some((l) => l.name === "Comedor"),
  afterReplace.map((l) => l.name).join(" | "),
);
check(
  "sigue habiendo una sola zona por defecto",
  afterReplace.filter((l) => l.isDefault).length === 1,
);

// --- modo zona: encajar en una zona existente ---

const zoneTarget = "lay-encaje";
await db.insert(tableLayouts).values([
  { id: zoneTarget, restaurantId: COPY_TO_VACIA, name: "Pasillo", width: 300, height: 200, version: 1 },
]);

const zoneCopy = await copyZoneIntoLayout({
  sourceRestaurantId: COPY_FROM,
  sourceLayoutId: ORIG_A,
  targetLayoutId: zoneTarget,
});
check("copia una zona a otra existente", zoneCopy.ok, zoneCopy.ok ? "" : zoneCopy.error);

const fitted = await db.query.tables.findMany({
  where: (t, { eq }) => eq(t.layoutId, zoneTarget),
});
check("  copia sus 2 elementos", fitted.length === 2, `n=${fitted.length}`);

const fittedBoxes = fitted.map((t) => ({ x: t.x, y: t.y, w: t.width, h: t.height }));
check(
  "  TODO cabe dentro de la zona de destino (300x200)",
  fittedBoxes.every((b) => b.x >= 0 && b.y >= 0 && b.x + b.w <= 300 && b.y + b.h <= 200),
  JSON.stringify(fittedBoxes),
);
const originBoxes = (await db.query.tables.findMany({ where: (t, { eq }) => eq(t.layoutId, ORIG_A) }))
  .map((t) => ({ x: t.x, y: t.y, w: t.width, h: t.height }));
const sameRatio =
  originBoxes.length === fittedBoxes.length &&
  originBoxes.every((o, i) => {
    const f = fittedBoxes[i];
    return Math.abs(o.w / o.h - f.w / f.h) < 0.15;
  });
check("  y conserva la proporción (no deforma las mesas)", sameRatio);
check(
  "  conserva el orden de posiciones relativas",
  fitted[0].x <= fitted[1].x,
  `${fitted[0].label}@${fitted[0].x} ${fitted[1].label}@${fitted[1].x}`,
);
check(
  "  la zona de destino conserva su nombre y su tamaño",
  (await db.query.tableLayouts.findFirst({ where: (l, { eq }) => eq(l.id, zoneTarget) }))?.width === 300,
);
check(
  "  y su versión sube",
  (await db.query.tableLayouts.findFirst({ where: (l, { eq }) => eq(l.id, zoneTarget) }))?.version === 2,
);

const zoneBusy = await copyZoneIntoLayout({
  sourceRestaurantId: COPY_FROM,
  sourceLayoutId: ORIG_A,
  targetLayoutId: OCUP_LAYOUT,
});
check(
  "copiar a una zona ocupada se rechaza",
  !zoneBusy.ok && zoneBusy.error.includes("sentados"),
  zoneBusy.ok ? "lo aceptó" : zoneBusy.error,
);


// ---------------------------------------------------------------------------
// Giro del plano completo (table_layouts.rotation)
// ---------------------------------------------------------------------------

section("Giro del plano completo");

const ROT_REST = "rot-rest";
const ROT_DEST = "rot-dest";
const ROT_LAYOUT = "rot-layout";
await db.insert(restaurants).values([
  { id: ROT_REST, name: "Giro", slug: "giro" },
  { id: ROT_DEST, name: "Giro destino", slug: "giro-destino" },
]);
await db.insert(tableLayouts).values([
  { id: ROT_LAYOUT, restaurantId: ROT_REST, name: "Comedor", width: 1000, height: 700, isDefault: true, version: 1 },
]);
const rotElements = [
  { id: "rot-mesa", elementTypeId: TYPES.mesa, label: "Mesa 1", x: 50, y: 50, width: 80, height: 80, rotation: 0, capacity: 4 },
];
const rotPayload = (rotation?: number) =>
  saveLayoutInputSchema.safeParse({
    layoutId: ROT_LAYOUT,
    restaurantId: ROT_REST,
    width: 1000,
    height: 700,
    ...(rotation === undefined ? {} : { rotation }),
    elements: rotElements,
  });

check("una zona nueva nace sin girar", (await getLayout(ROT_LAYOUT, ROT_REST))?.rotation === 0);

{
  const parsed = rotPayload(90);
  const saved = parsed.success ? await applyLayoutStructure(parsed.data) : null;
  const reloaded = await getLayout(ROT_LAYOUT, ROT_REST);
  check("el giro se guarda con el guardado normal", Boolean(saved?.ok), saved && !saved.ok ? saved.error : "");
  check("  y se recarga igual (90°)", reloaded?.rotation === 90, String(reloaded?.rotation));
  check("  y sube la versión (los demás reciben layout:updated)", reloaded?.version === 2, String(reloaded?.version));
}

{
  const parsed = rotPayload(undefined);
  if (parsed.success) await applyLayoutStructure(parsed.data);
  check("guardar sin `rotation` conserva el giro que había", (await getLayout(ROT_LAYOUT, ROT_REST))?.rotation === 90);
}

check("un giro que no es un cuarto de vuelta se rechaza (45°)", !rotPayload(45).success);
check("  y 360° también (se guarda como 0)", !rotPayload(360).success);
check("asLayoutRotation lee un valor raro como 0", asLayoutRotation(45) === 0 && asLayoutRotation(270) === 270);

// Geometría del minimapa: gira igual que el lienzo, y un toque en el minimapa
// girado vuelve al punto correcto del plano.
{
  const W = 1000;
  const H = 700;
  const near = (a: { x: number; y: number }, b: { x: number; y: number }) =>
    Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
  const size90 = rotatedSize(W, H, 90);
  check("girado 90° o 270°, el minimapa cruza ancho y alto", size90.width === H && size90.height === W && rotatedSize(W, H, 270).width === H);
  check("  y con 0° o 180° se queda igual", rotatedSize(W, H, 180).width === W && rotatedSize(W, H, 0).height === H);
  // Esquina superior izquierda del plano: a 90° a derechas acaba arriba a la
  // derecha; a 180°, abajo a la derecha; a 270°, abajo a la izquierda.
  const corner = { x: 0, y: 0 };
  check(
    "  la esquina superior izquierda va a su sitio con cada giro",
    near(planToRotated(corner, W, H, 0), { x: 0, y: 0 }) &&
      near(planToRotated(corner, W, H, 90), { x: H, y: 0 }) &&
      near(planToRotated(corner, W, H, 180), { x: W, y: H }) &&
      near(planToRotated(corner, W, H, 270), { x: 0, y: W }),
  );
  const probe = { x: 123, y: 456 };
  check(
    "  ida y vuelta: tocar el minimapa girado lleva al mismo punto del plano",
    [0, 90, 180, 270].every((r) => near(rotatedToPlan(planToRotated(probe, W, H, r), W, H, r), probe)),
  );
}

{
  const parsed = rotPayload(270);
  if (parsed.success) await applyLayoutStructure(parsed.data);
  const copied = await copyLayoutToRestaurant({ sourceRestaurantId: ROT_REST, targetRestaurantId: ROT_DEST, replace: false });
  const destLayout = await db.query.tableLayouts.findFirst({ where: (l, { eq }) => eq(l.restaurantId, ROT_DEST) });
  check("copiar el plano a otro restaurante copia el giro", copied.ok && destLayout?.rotation === 270, String(destLayout?.rotation));
}


// ---------------------------------------------------------------------------
// Barra, puerta y pared
// ---------------------------------------------------------------------------

section("Barra, puerta y pared");

const NEW_TYPES = [
  { id: "type-barra", key: "barra", label: "Barra", color: "#d97706", icon: "wine", width: 220, height: 56, defaultCapacity: null, sortOrder: 5 },
  { id: "type-puerta", key: "puerta", label: "Puerta", color: "#0d9488", icon: "door-open", width: 80, height: 80, defaultCapacity: null, sortOrder: 6 },
  { id: "type-pared", key: "pared", label: "Pared", color: "#64748b", icon: "brick-wall", width: 240, height: 18, defaultCapacity: null, sortOrder: 7 },
] as const;
await db.insert(elementTypes).values([...NEW_TYPES]);

check(
  "barra, puerta y pared están en ELEMENT_TYPE_KEYS",
  ["barra", "puerta", "pared"].every((k) => (ELEMENT_TYPE_KEYS as readonly string[]).includes(k)),
);
check("  y ninguna admite clientes", ["barra", "puerta", "pared"].every((k) => !isSeatableElement(k)));
{
  const shapes = NEW_TYPES.map((t) => elementStyle({ ...t, defaultCapacity: null }).shape).join(",");
  check("  cada una con su forma (bar, door, wall)", shapes === "bar,door,wall", shapes);
  const wall = elementStyle({ ...NEW_TYPES[2], defaultCapacity: null });
  check("  la pared no lleva etiqueta encima (la taparía)", wall.showLabel === false && elementStyle({ ...NEW_TYPES[0], defaultCapacity: null }).showLabel);
  check("  numeración propia: Barra 1, Puerta 2, Pared 1", nextLabel("barra", []) === "Barra 1" && nextLabel("puerta", ["Puerta 1"]) === "Puerta 2" && nextLabel("pared", []) === "Pared 1");
}

const EST_REST = "est-rest";
const EST_DEST = "est-dest";
const EST_LAYOUT = "est-layout";
await db.insert(restaurants).values([
  { id: EST_REST, name: "Estructura", slug: "estructura" },
  { id: EST_DEST, name: "Estructura destino", slug: "estructura-destino" },
]);
await db.insert(tableLayouts).values([
  { id: EST_LAYOUT, restaurantId: EST_REST, name: "Salón", width: 1200, height: 800, isDefault: true, version: 1 },
]);
const structure = [
  { id: "est-barra", elementTypeId: "type-barra", label: "Barra 1", x: 100, y: 60, width: 220, height: 56, rotation: 0, capacity: null },
  { id: "est-puerta", elementTypeId: "type-puerta", label: "Puerta 1", x: 600, y: 700, width: 80, height: 80, rotation: 90, capacity: null },
  { id: "est-pared", elementTypeId: "type-pared", label: "Pared 1", x: 400, y: 300, width: 240, height: 18, rotation: 0, capacity: null },
  { id: "est-mesa", elementTypeId: TYPES.mesa, label: "Mesa 1", x: 200, y: 300, width: 80, height: 80, rotation: 0, capacity: 4 },
];
{
  const parsed = saveLayoutInputSchema.safeParse({
    layoutId: EST_LAYOUT,
    restaurantId: EST_REST,
    width: 1200,
    height: 800,
    elements: structure,
  });
  const saved = parsed.success ? await applyLayoutStructure(parsed.data) : null;
  check("se añaden y se guardan una barra, una puerta y una pared", Boolean(saved?.ok) && saved?.ok === true && saved.saved === 4, saved && !saved.ok ? saved.error : JSON.stringify(saved));

  const reloaded = await getLayout(EST_LAYOUT, EST_REST);
  const byId = new Map((reloaded?.elements ?? []).map((e) => [e.id, e]));
  check(
    "  y se recargan con su tipo, tamaño y giro",
    byId.get("est-barra")?.elementTypeId === "type-barra" &&
      byId.get("est-puerta")?.rotation === 90 &&
      byId.get("est-pared")?.height === 18,
  );
  check("  sin capacidad ni estado de mesa", ["est-barra", "est-puerta", "est-pared"].every((id) => byId.get(id)?.capacity === null && byId.get(id)?.status === "libre"));
}

{
  const copied = await copyLayoutToRestaurant({ sourceRestaurantId: EST_REST, targetRestaurantId: EST_DEST, replace: false });
  const destRows = await db.query.tables.findMany({ where: (t, { eq }) => eq(t.restaurantId, EST_DEST) });
  const destTypes = destRows.map((r) => r.elementTypeId).sort().join(",");
  check("copiar el plano copia la barra, la puerta y la pared", copied.ok && destTypes === ["type-barra", "type-pared", "type-puerta", TYPES.mesa].sort().join(","), destTypes);
  check("  con ids nuevos", destRows.every((r) => !r.id.startsWith("est-")));
}

console.log("\nCatálogo de elementos (db:catalog, también en producción)");

{
  // Aquí la base ya tiene los 8 tipos con ids propios del test y mesas que
  // apuntan a ellos: el catálogo tiene que actualizarlos por clave, no
  // duplicarlos ni cambiarles el id.
  const { ELEMENT_TYPE_CATALOG, upsertElementTypeCatalog } = await import("@/lib/layout/catalog");
  const tablesBefore = await db.select({ id: tables.id, elementTypeId: tables.elementTypeId }).from(tables);
  await upsertElementTypeCatalog();
  await upsertElementTypeCatalog();
  const rows = await db.select().from(elementTypes);
  const tablesAfter = await db.select({ id: tables.id, elementTypeId: tables.elementTypeId }).from(tables);
  check("el catálogo trae todos los ELEMENT_TYPE_KEYS", ELEMENT_TYPE_KEYS.every((key) => ELEMENT_TYPE_CATALOG.some((type) => type.key === key)));
  check("  repetirlo no duplica ningún tipo", rows.length === ELEMENT_TYPE_KEYS.length, `${rows.length}`);
  check("  conserva el id de los tipos que ya existían", rows.find((row) => row.key === "mesa-sillas")?.id === TYPES.mesa);
  check("  y actualiza sus datos por clave", rows.find((row) => row.key === "bano")?.label === "Baño");
  check("  no toca ninguna mesa", JSON.stringify(tablesAfter) === JSON.stringify(tablesBefore));
}

console.log("\nRestaurantes base (db:restaurantes, también en producción)");

{
  // Se simula una base que ya tiene datos reales: `rest_centro` existe con
  // otro nombre, su propia zona y sin ubicación (anterior a la migración
  // 0004); `rest_tgu_dennys` existe con otra ubicación; y otro restaurante
  // ocupa el slug de KFC Río Piedras. Solo se puede rellenar lo que falta.
  const { BASE_BRANDS, BASE_RESTAURANTS, ensureBaseRestaurants } = await import("@/lib/layout/base-restaurants");
  const { brands, user, waitlistEntries } = await import("@/lib/db/schema");
  const { eq, inArray, sql } = await import("drizzle-orm");
  await db.insert(restaurants).values([
    { id: "rest_centro", name: "Nombre puesto a mano", slug: "slug-propio" },
    { id: "rest-ocupa-slug", name: "Otro local", slug: "kfc-rio-piedras" },
    { id: "rest_tgu_dennys", name: "Denny's con su ubicación", slug: "dennys-propio", latitude: 14.5, longitude: -87.5 },
  ]);
  await db.insert(tableLayouts).values({ id: "zona-propia", restaurantId: "rest_centro", name: "Terraza dibujada", isDefault: true });
  const count = async (table: typeof tables | typeof waitlistEntries | typeof user) =>
    Number((await db.select({ n: sql<number>`count(*)` }).from(table))[0].n);
  const before = { tables: await count(tables), entries: await count(waitlistEntries), users: await count(user) };

  const first = await ensureBaseRestaurants();
  const second = await ensureBaseRestaurants();
  const created = BASE_RESTAURANTS.filter((r) => !["rest_centro", "rest_sps_kfc", "rest_tgu_dennys"].includes(r.id));
  const zonesOf = async (restaurantId: string) => db.select().from(tableLayouts).where(eq(tableLayouts.restaurantId, restaurantId));
  const centro = (await db.select().from(restaurants).where(eq(restaurants.id, "rest_centro")))[0];

  // Zonas: una por cada restaurante nuevo y otra para rest_tgu_dennys, que ya
  // existía pero sin ninguna.
  check("crea las 4 marcas, los restaurantes que faltan y una zona a quien no tiene",
    first.brandsCreated === BASE_BRANDS.length && first.restaurantsCreated === created.length && first.zonesCreated === created.length + 1,
    JSON.stringify(first));
  check("  repetirlo no crea nada", second.brandsCreated === 0 && second.restaurantsCreated === 0 && second.zonesCreated === 0 && second.locationsFilled === 0, JSON.stringify(second));
  const baseCentro = BASE_RESTAURANTS.find((r) => r.id === "rest_centro")!;
  check("  a un restaurante sin ubicación le pone la real", first.locationsFilled === 1 && centro?.latitude === baseCentro.latitude && centro?.longitude === baseCentro.longitude, JSON.stringify(first));
  const dennys = (await db.select().from(restaurants).where(eq(restaurants.id, "rest_tgu_dennys")))[0];
  check("  pero no pisa una ubicación que ya tenía", dennys?.latitude === 14.5 && dennys?.longitude === -87.5 && dennys.name === "Denny's con su ubicación");
  check("  las marcas quedan con su id", (await db.select().from(brands)).length === BASE_BRANDS.length);
  check("  no pisa un restaurante que ya existía", centro?.name === "Nombre puesto a mano" && centro.slug === "slug-propio");
  check("  ni le añade zona si ya tenía una", (await zonesOf("rest_centro")).map((z) => z.id).join(",") === "zona-propia");
  check("  si otro restaurante ocupa su slug, no lo crea ni le hace zona",
    (await db.select().from(restaurants).where(eq(restaurants.id, "rest_sps_kfc"))).length === 0 && (await zonesOf("rest_sps_kfc")).length === 0);
  const newZones = await Promise.all(created.map((r) => zonesOf(r.id)));
  check("  cada restaurante nuevo tiene una sola zona, vacía y predeterminada",
    newZones.every((z) => z.length === 1 && z[0].isDefault && z[0].rotation === 0));
  const createdRows = await db.select().from(restaurants).where(inArray(restaurants.id, created.map((r) => r.id)));
  check("  con su marca, ciudad y posición del mapa",
    createdRows.length === created.length && createdRows.every((r) => r.brandId && r.city && r.mapX !== null && r.mapY !== null && r.latitude !== null && r.longitude !== null));
  check("  no crea mesas, clientes ni usuarios",
    (await count(tables)) === before.tables && (await count(waitlistEntries)) === before.entries && (await count(user)) === before.users);
}

console.log("\nProyección del mapa de Honduras");

{
  const { MAP_HEIGHT, MAP_WIDTH, kmToUnits, project, restaurantPosition, unproject } = await import("@/lib/map/projection");
  const { BASE_RESTAURANTS } = await import("@/lib/layout/base-restaurants");
  const { CITIES, DEPARTMENTS, HONDURAS_PATH, NEIGHBORS } = await import("@/lib/map/world");
  const tgu = { lat: 14.0723, lng: -87.1921 };
  const back = unproject(project(tgu));
  check("project y unproject son inversas", Math.abs(back.lat - tgu.lat) < 1e-9 && Math.abs(back.lng - tgu.lng) < 1e-9);
  const corners = [{ lat: 12.98, lng: -89.36 }, { lat: 16.52, lng: -83.13 }, { lat: 17.41, lng: -83.93 }].map(project);
  check("  todo Honduras, con las Islas del Cisne, cae dentro del lienzo", corners.every((p) => p.x > 0 && p.x < MAP_WIDTH && p.y > 0 && p.y < MAP_HEIGHT));
  check("  San Pedro Sula queda al noroeste de Tegucigalpa", (() => { const a = project({ lat: 15.5042, lng: -88.025 }); const b = project(tgu); return a.x < b.x && a.y < b.y; })());
  const cityOf = (name: string) => CITIES.find((c) => c.name === name)!;
  check("  cada restaurante está a menos de 6 km del centro de su ciudad",
    BASE_RESTAURANTS.every((r) => { const p = project({ lat: r.latitude, lng: r.longitude }); const c = cityOf(r.city); return Math.hypot(p.x - c.x, p.y - c.y) < kmToUnits(6); }));
  check("  y su mapX/mapY es la proyección de su latitud y longitud",
    BASE_RESTAURANTS.every((r) => { const p = project({ lat: r.latitude, lng: r.longitude }); return Math.abs(p.x - r.mapX) <= 0.5 && Math.abs(p.y - r.mapY) <= 0.5; }));
  check("restaurantPosition prefiere latitud y longitud, y si no usa map_x/map_y",
    restaurantPosition({ latitude: 14.0723, longitude: -87.1921, mapX: 1, mapY: 1 })!.x === project(tgu).x &&
    restaurantPosition({ latitude: null, longitude: null, mapX: 12, mapY: 34 })!.y === 34 &&
    restaurantPosition({ latitude: null, longitude: null, mapX: null, mapY: null }) === null);
  check("el mapa trae los 18 departamentos, la silueta y los vecinos",
    DEPARTMENTS.length === 18 && DEPARTMENTS.every((d) => d.path.startsWith("M")) && HONDURAS_PATH.length > 1000 &&
    ["Guatemala", "El Salvador", "Nicaragua"].every((n) => NEIGHBORS.some((x) => x.name === n)));
  check("  y las 11 ciudades principales", CITIES.length === 11 && CITIES.every((c) => c.x > 0 && c.x < MAP_WIDTH && c.y > 0 && c.y < MAP_HEIGHT));
}

console.log("\nMarcas y restaurantes desde /admin (lib/layout/catalog-admin)");

{
  const catalog = await import("@/lib/layout/catalog-admin");
  const { restaurantInputSchema } = await import("@/lib/layout/catalog-input");
  const { listRestaurants } = await import("@/lib/auth/users");
  const { getMapRestaurants } = await import("@/lib/map/queries");
  const { project } = await import("@/lib/map/projection");
  const { brands, waitlistEntries } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const fails = async (work: () => Promise<unknown>) => {
    try {
      await work();
      return false;
    } catch (error) {
      return error instanceof catalog.CatalogInputError;
    }
  };

  const brandId = await catalog.createBrand({ name: "Marca de Prueba Ñandú", accentColor: "#123abc" });
  check("createBrand crea la marca con un id legible", brandId === "brand_marca_de_prueba_nandu");
  check("  no deja repetir el nombre", await fails(() => catalog.createBrand({ name: "Marca de Prueba Ñandú", accentColor: "#000000" })));
  await catalog.updateBrand(brandId, { name: "Marca Prueba", accentColor: "#654321" });
  const [edited] = await db.select().from(brands).where(eq(brands.id, brandId));
  check("updateBrand cambia nombre y color", edited?.name === "Marca Prueba" && edited.accentColor === "#654321");

  const input = { name: "Local de Prueba", brandId, city: "Tegucigalpa", latitude: 14.1, longitude: -87.2 };
  const restId = await catalog.createRestaurant(input);
  const [created] = await db.select().from(restaurants).where(eq(restaurants.id, restId));
  const zones = await db.select().from(tableLayouts).where(eq(tableLayouts.restaurantId, restId));
  const at = project({ lat: 14.1, lng: -87.2 });
  check("createRestaurant crea el restaurante activo, con su slug", created?.active === true && created.slug === "local-de-prueba");
  check("  con su posición del mapa calculada de la latitud y la longitud", created?.mapX === Math.round(at.x) && created?.mapY === Math.round(at.y));
  check("  y una zona vacía y predeterminada para el editor", zones.length === 1 && zones[0].isDefault && (await db.select().from(tables).where(eq(tables.restaurantId, restId))).length === 0);
  const twinId = await catalog.createRestaurant(input);
  const [twin] = await db.select().from(restaurants).where(eq(restaurants.id, twinId));
  check("  otro con el mismo nombre recibe otro id y otro slug", twinId !== restId && twin?.slug === "local-de-prueba-2");

  await catalog.updateRestaurant(restId, { ...input, name: "Local Renombrado", city: "San Pedro Sula", latitude: 15.5, longitude: -88.02 });
  const [renamed] = await db.select().from(restaurants).where(eq(restaurants.id, restId));
  check("updateRestaurant cambia nombre, ciudad y posición, pero no el id ni el slug",
    renamed?.name === "Local Renombrado" && renamed.slug === "local-de-prueba" && renamed.mapX === Math.round(project({ lat: 15.5, lng: -88.02 }).x));

  check("la ubicación tiene que caer dentro de Honduras", !restaurantInputSchema.safeParse({ ...input, latitude: 40, longitude: -3.7 }).success);

  await catalog.setBrandActive(brandId, false);
  check("con la marca desactivada no se crean restaurantes nuevos", await fails(() => catalog.createRestaurant(input)));
  check("  pero el que ya la tenía se puede seguir editando", !(await fails(() => catalog.updateRestaurant(restId, { ...input, name: "Local Renombrado" }))));
  await catalog.setBrandActive(brandId, true);

  await db.insert(waitlistEntries).values({ id: "wl-catalogo", restaurantId: restId, customerName: "Cliente de prueba", status: "sentado" });
  await catalog.setRestaurantActive(restId, false);
  check("un restaurante desactivado no se ofrece en los accesos", !(await listRestaurants()).some((r) => r.id === restId) && (await listRestaurants({ includeInactive: true })).some((r) => r.id === restId && !r.active));
  check("  ni sale en el mapa general", !(await getMapRestaurants()).some((r) => r.id === restId));
  check("  pero no se borra nada: ni él, ni su zona, ni su historial",
    (await db.select().from(restaurants).where(eq(restaurants.id, restId))).length === 1 &&
    (await db.select().from(tableLayouts).where(eq(tableLayouts.restaurantId, restId))).length === 1 &&
    (await db.select().from(waitlistEntries).where(eq(waitlistEntries.id, "wl-catalogo"))).length === 1);
  await catalog.setRestaurantActive(restId, true);
  check("  y al reactivarlo vuelve al mapa", (await getMapRestaurants()).some((r) => r.id === restId));
  check("listAdminRestaurants cuenta sus zonas", (await catalog.listAdminRestaurants()).find((r) => r.id === restId)?.zones === 1);
  check("listAdminBrands cuenta sus restaurantes", (await catalog.listAdminBrands()).find((b) => b.id === brandId)?.restaurants === 2);
  check("no se puede editar un restaurante que no existe", await fails(() => catalog.updateRestaurant("no-existe", input)));
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Zonas de meseros (requisito del enunciado)
// ---------------------------------------------------------------------------

section("Zonas de meseros");

{
  const { autoBalance, MAX_WAITERS } = await import("@/lib/waiters/balance");
  const waiters = await import("@/lib/waiters/configs");
  const { saveWaiterConfigSchema, createWaiterConfigSchema } = await import("@/lib/waiters/validation");
  const { waiterConfigs, waiterZoneTables } = await import("@/lib/db/schema");
  const { and, eq } = await import("drizzle-orm");

  // Reparto automático: equilibrado y por bloques de mesas vecinas.
  const grid = Array.from({ length: 7 }, (_, i) => ({ id: `g${i}`, layoutId: "z", x: i * 100, y: 0 }));
  const reparto = autoBalance(grid, 3, ["z"]);
  const tamaños = [0, 1, 2].map((z) => [...reparto.values()].filter((v) => v === z).length);
  check("autoBalance reparte 7 mesas entre 3: 3, 2 y 2", JSON.stringify(tamaños) === "[3,2,2]", JSON.stringify(tamaños));
  check("  en bloques contiguos de izquierda a derecha", ["g0", "g1", "g2"].every((id) => reparto.get(id) === 0) && reparto.get("g6") === 2);
  check("  sin mesas no reparte nada", autoBalance([], 3).size === 0);
  check("Zod no deja crear 0 meseros ni más del tope", !createWaiterConfigSchema.safeParse({ restaurantId: "r", waiterCount: 0 }).success && !createWaiterConfigSchema.safeParse({ restaurantId: "r", waiterCount: MAX_WAITERS + 1 }).success);
  check("Zod rechaza un color que no es #rrggbb", !saveWaiterConfigSchema.safeParse({ restaurantId: "r", configId: "c", version: 1, name: "x", zones: [{ id: "z", waiterName: "Ana", color: "red" }], assignments: [] }).success);

  // Un restaurante propio: 6 mesas, un baño, y otro restaurante con una mesa.
  const R = "rest-meseros";
  const R2 = "rest-meseros-otro";
  await db.insert(restaurants).values([
    { id: R, name: "Meseros", slug: "meseros" },
    { id: R2, name: "Otro", slug: "meseros-otro" },
  ]);
  await db.insert(tableLayouts).values([
    { id: "lay-m1", restaurantId: R, name: "Comedor", width: 1200, height: 800, isDefault: true, version: 1 },
    { id: "lay-m2", restaurantId: R, name: "Terraza", width: 800, height: 600, sortOrder: 1, version: 1 },
    { id: "lay-otro", restaurantId: R2, name: "Comedor", width: 800, height: 600, isDefault: true, version: 1 },
  ]);
  const m = (id: string, x: number, layoutId = "lay-m1", restaurantId = R, elementTypeId: string = TYPES.mesa) =>
    ({ id, restaurantId, layoutId, elementTypeId, label: id, x, y: 0, width: 80, height: 80, rotation: 0, capacity: 4 });
  await db.insert(tables).values([
    m("wm-1", 0), m("wm-2", 100), m("wm-3", 200), m("wm-4", 300),
    m("wm-5", 0, "lay-m2"), m("wm-6", 100, "lay-m2"),
    { ...m("wm-bano", 400), elementTypeId: TYPES.bano, capacity: null },
    m("wm-ajena", 0, "lay-otro", R2),
  ]);

  const dos = await waiters.createWaiterConfig({ restaurantId: R, waiterCount: 2 });
  check("crear «2 meseros» la deja activa (no había ninguna)", dos.ok && dos.config.isActive && dos.config.name === "2 meseros");
  if (!dos.ok) throw new Error("no se pudo crear la configuración");
  const asignadas = dos.config.zones.flatMap((z) => z.tableIds);
  check("  reparte las 6 mesas, 3 y 3, y no el baño", asignadas.length === 6 && !asignadas.includes("wm-bano") && dos.config.zones.every((z) => z.tableIds.length === 3), JSON.stringify(dos.config.zones.map((z) => z.tableIds)));
  check("  cada mesero con nombre y color distintos", new Set(dos.config.zones.map((z) => z.color)).size === 2 && dos.config.zones.every((z) => z.waiterName.length > 0));
  const tres = await waiters.createWaiterConfig({ restaurantId: R, waiterCount: 3 });
  check("crear «3 meseros» NO cambia la activa", tres.ok && !tres.config.isActive && (await waiters.listWaiterConfigs(R)).find((c) => c.isActive)?.id === dos.config.id);
  if (!tres.ok) throw new Error("no se pudo crear la configuración");

  const marcas = await waiters.getActiveWaiterMarks(R);
  check("las marcas del plano son las de la configuración activa", Object.keys(marcas).length === 6 && marcas["wm-1"].zoneId === dos.config.zones[0].id);
  check("  y no salen marcas de otro restaurante", Object.keys(await waiters.getActiveWaiterMarks(R2)).length === 0);

  // Activar: un toque, y solo una activa.
  check("activar «3 meseros»", (await waiters.activateWaiterConfig({ restaurantId: R, configId: tres.config.id })).ok);
  const activas = await db.select({ id: waiterConfigs.id }).from(waiterConfigs).where(and(eq(waiterConfigs.restaurantId, R), eq(waiterConfigs.isActive, true)));
  check("  queda UNA sola activa, la nueva", activas.length === 1 && activas[0].id === tres.config.id);
  check("no se activa la configuración de un restaurante desde otro", !(await waiters.activateWaiterConfig({ restaurantId: R2, configId: dos.config.id })).ok);

  // Guardar: integridad.
  const actual = (await waiters.listWaiterConfigs(R)).find((c) => c.id === dos.config.id)!;
  const valido = {
    restaurantId: R,
    configId: actual.id,
    version: actual.version,
    name: "Fin de semana",
    zones: actual.zones.map((z, i) => ({ id: z.id, waiterName: ["Ana", "Luis"][i], color: z.color })),
    assignments: [
      { tableId: "wm-1", zoneId: actual.zones[0].id },
      { tableId: "wm-2", zoneId: actual.zones[1].id },
    ],
  };
  const err = async (patch: Partial<typeof valido>, texto: string) => {
    const res = await waiters.saveWaiterConfig({ ...valido, ...patch });
    return !res.ok && res.error.includes(texto);
  };
  check("no se guarda una mesa de otro restaurante", await err({ assignments: [{ tableId: "wm-ajena", zoneId: actual.zones[0].id }] }, "no es de este restaurante"));
  check("ni un baño (no admite clientes)", await err({ assignments: [{ tableId: "wm-bano", zoneId: actual.zones[0].id }] }, "no admite clientes"));
  check("ni la misma mesa con dos meseros", await err({ assignments: [{ tableId: "wm-1", zoneId: actual.zones[0].id }, { tableId: "wm-1", zoneId: actual.zones[1].id }] }, "dos meseros"));
  check("ni una zona de otra configuración", await err({ assignments: [{ tableId: "wm-1", zoneId: tres.config.zones[0].id }] }, "no coinciden"));
  check("ni con un mesero de menos", await err({ zones: valido.zones.slice(0, 1) }, "no coinciden"));
  check("ni desde otro restaurante", await err({ restaurantId: R2 }, "no existe en este restaurante"));
  check("ni con una versión vieja", await err({ version: actual.version - 1 }, "Otro dispositivo"));
  const guardado = await waiters.saveWaiterConfig(valido);
  check("un guardado válido sube la versión", guardado.ok && guardado.version === actual.version + 1);
  const tras = (await waiters.listWaiterConfigs(R)).find((c) => c.id === actual.id)!;
  check("  y guarda nombre, meseros y reparto", tras.name === "Fin de semana" && tras.zones.map((z) => z.waiterName).join() === "Ana,Luis" && tras.zones[0].tableIds.join() === "wm-1" && tras.zones[1].tableIds.join() === "wm-2");
  check("  repetirlo con la versión de antes ya no pisa nada", !(await waiters.saveWaiterConfig(valido)).ok);

  // El reparto no toca las mesas, y el editor no toca el reparto (salvo que
  // la mesa se borre, que sale de su zona sola).
  const [mesa1] = await db.select().from(tables).where(eq(tables.id, "wm-1"));
  check("guardar meseros no cambia ni la mesa ni su ocupación", mesa1.status === "libre" && mesa1.currentEntryId === null && mesa1.version === 1);
  const layoutM1 = await getLayout("lay-m1", R);
  const sinW2 = (layoutM1?.elements ?? []).filter((e) => e.id !== "wm-2").map(({ id, elementTypeId, label, x, y, width, height, rotation, capacity }) => ({ id, elementTypeId, label, x, y, width, height, rotation, capacity }));
  const quitada = await applyLayoutStructure({ layoutId: "lay-m1", restaurantId: R, width: 1200, height: 800, elements: sinW2 });
  const enlaces = await db.select({ tableId: waiterZoneTables.tableId }).from(waiterZoneTables).where(eq(waiterZoneTables.configId, actual.id));
  check("borrar una mesa en el editor la saca de su zona de mesero", quitada.ok && enlaces.map((e) => e.tableId).join() === "wm-1");

  // Borrar la activa deja activa otra.
  check("borrar la configuración activa…", (await waiters.deleteWaiterConfig({ restaurantId: R, configId: tres.config.id })).ok);
  check("  …pasa a activa la que queda", (await waiters.listWaiterConfigs(R)).map((c) => `${c.id}:${c.isActive}`).join() === `${actual.id}:true`);
  check("no se borra la de otro restaurante", !(await waiters.deleteWaiterConfig({ restaurantId: R2, configId: actual.id })).ok);

  // El contador [−][+]: si NO existe la configuración con ese número de
  // meseros, el selector la crea (con las mesas repartidas por autoBalance)
  // y la activa; si ya existe, la reutiliza sin duplicar. Es la misma
  // secuencia que hace `WaiterSelector.setWaiterCount`.
  const cinco = await waiters.createWaiterConfig({ restaurantId: R, waiterCount: 5 });
  check("crear la configuración que faltaba deja 5 meseros con mesas repartidas",
    cinco.ok && cinco.config.zones.length === 5 && cinco.config.zones.every((z) => z.tableIds.length === 1),
    cinco.ok ? JSON.stringify(cinco.config.zones.map((z) => z.tableIds)) : "no se pudo crear");
  if (cinco.ok) {
    check("  y activándola es la ÚNICA activa",
      (await waiters.activateWaiterConfig({ restaurantId: R, configId: cinco.config.id })).ok &&
        (await waiters.listWaiterConfigs(R)).filter((c) => c.isActive).map((c) => c.id).join() === cinco.config.id);
    const total = (await waiters.listWaiterConfigs(R)).length;
    check("  volver a «2 meseros» reutiliza la existente, sin crear otra",
      (await waiters.activateWaiterConfig({ restaurantId: R, configId: actual.id })).ok &&
        (await waiters.listWaiterConfigs(R)).length === total);
    // Se retira para no alterar las comprobaciones siguientes.
    await waiters.deleteWaiterConfig({ restaurantId: R, configId: cinco.config.id });
  }

  // Plano por defecto.
  const { setDefaultLayout, ensureDefaultLayout } = await import("@/lib/layout/default");
  const defaults = async (restaurantId: string) =>
    (await db.select({ id: tableLayouts.id }).from(tableLayouts).where(and(eq(tableLayouts.restaurantId, restaurantId), eq(tableLayouts.isDefault, true)))).map((r) => r.id);
  check("marcar la Terraza como plano por defecto", (await setDefaultLayout({ restaurantId: R, layoutId: "lay-m2" })).ok && (await defaults(R)).join() === "lay-m2");
  check("  y sigue habiendo UNA sola", (await defaults(R)).length === 1);
  check("no se marca la zona de otro restaurante", !(await setDefaultLayout({ restaurantId: R, layoutId: "lay-otro" })).ok && (await defaults(R2)).join() === "lay-otro");
  await db.update(tableLayouts).set({ isDefault: false }).where(eq(tableLayouts.restaurantId, R));
  check("si un restaurante se queda sin plano por defecto, se marca la primera zona", (await ensureDefaultLayout(R)) === "lay-m1" && (await defaults(R)).join() === "lay-m1");
  check("  y si ya tiene, no la cambia", (await ensureDefaultLayout(R2)) === "lay-otro");
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Copiar y pegar elementos
// ---------------------------------------------------------------------------

section("Copiar y pegar elementos");

{
  const { pastedCopy, PASTE_OFFSET } = await import("@/lib/layout/clipboard");
  const { eq } = await import("drizzle-orm");
  const R = "rest-pegar";
  await db.insert(restaurants).values({ id: R, name: "Pegar", slug: "pegar" });
  await db.insert(tableLayouts).values({ id: "lay-pegar", restaurantId: R, name: "Comedor", width: 600, height: 400, isDefault: true, version: 1 });
  await db.insert(tables).values({
    id: "pg-1", restaurantId: R, layoutId: "lay-pegar", elementTypeId: TYPES.mesa, label: "Mesa 1",
    x: 100, y: 50, width: 90, height: 70, rotation: 45, capacity: 6, status: "ocupada", currentEntryId: "cliente-pg",
  });
  const zona = await getLayout("lay-pegar", R);
  const original = zona!.elements.find((e) => e.id === "pg-1")!;
  check("la mesa original está ocupada (para ver que eso NO se copia)", original.status === "ocupada" && original.currentEntryId === "cliente-pg");

  const copia = pastedCopy(original, { id: "pg-copia", typeKey: "mesa-sillas", labelsOfType: ["Mesa 1"], zoneWidth: 600, zoneHeight: 400 });
  check("la copia tiene un id nuevo y el siguiente nombre", copia.id === "pg-copia" && copia.label === "Mesa 2");
  check("  y las mismas propiedades visuales (tipo, tamaño, giro, puestos)",
    copia.elementTypeId === original.elementTypeId && copia.width === 90 && copia.height === 70 && copia.rotation === 45 && copia.capacity === 6);
  check("  desplazada para que se vean las dos", copia.x === original.x + PASTE_OFFSET && copia.y === original.y + PASTE_OFFSET);
  check("  y NO copia las relaciones: nace libre, sin cliente", copia.status === "libre" && copia.currentEntryId === null && copia.occupantName === null && copia.seatedAt === null);
  const enElBorde = pastedCopy({ ...original, x: 590, y: 390 }, { id: "x", typeKey: "mesa-sillas", labelsOfType: [], zoneWidth: 600, zoneHeight: 400 });
  check("  pegada junto al borde, no se sale de la zona", enElBorde.x === 600 - 90 && enElBorde.y === 400 - 70);
  const junto = pastedCopy(original, { id: "y", typeKey: "mesa-sillas", labelsOfType: [], anchor: { x: 10, y: 20 }, zoneWidth: 600, zoneHeight: 400 });
  check("  y se puede pegar junto a otro elemento", junto.x === 10 + PASTE_OFFSET && junto.y === 20 + PASTE_OFFSET);

  // Guardar la copia (después de «modificarla»: otro nombre y girada) es un
  // guardado normal: entra como elemento nuevo y libre, y la original sigue
  // ocupada con su cliente.
  const modificada = { ...copia, label: "Mesa terraza", rotation: 90 };
  const payload = [original, modificada].map(({ id, elementTypeId, label, x, y, width, height, rotation, capacity }) => ({ id, elementTypeId, label, x, y, width, height, rotation, capacity }));
  const guardado = await applyLayoutStructure({ layoutId: "lay-pegar", restaurantId: R, width: 600, height: 400, elements: payload });
  check("la copia se guarda como cualquier elemento", guardado.ok);
  const [filaCopia] = await db.select().from(tables).where(eq(tables.id, "pg-copia"));
  check("  en la base: libre, sin cliente, con su nombre y su giro", filaCopia?.status === "libre" && filaCopia.currentEntryId === null && filaCopia.label === "Mesa terraza" && filaCopia.rotation === 90);
  const [filaOriginal] = await db.select().from(tables).where(eq(tables.id, "pg-1"));
  check("  y la original sigue ocupada con su cliente", filaOriginal?.status === "ocupada" && filaOriginal.currentEntryId === "cliente-pg");
  const sinCopia = await applyLayoutStructure({ layoutId: "lay-pegar", restaurantId: R, width: 600, height: 400, elements: payload.slice(0, 1) });
  check("eliminar la copia y guardar la quita", sinCopia.ok && (await db.select().from(tables).where(eq(tables.id, "pg-copia"))).length === 0);
}

// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Colocación dentro del recuadro y límites de la zona
// ---------------------------------------------------------------------------

section("Colocación dentro del recuadro y límites");

{
  const { placeInView, clampToZone, occupiedBox, halfExtent } = await import("@/lib/layout/placement");
  const { pastedCopy } = await import("@/lib/layout/clipboard");
  const zone = { width: 1200, height: 800 };
  const mesa = { width: 80, height: 80, rotation: 0 };
  const dentro = (b: { left: number; top: number; right: number; bottom: number }, v: { left: number; top: number; right: number; bottom: number }) =>
    b.left >= v.left - 0.5 && b.top >= v.top - 0.5 && b.right <= v.right + 0.5 && b.bottom <= v.bottom + 0.5;
  const solapan = (a: { left: number; top: number; right: number; bottom: number }, b: { left: number; top: number; right: number; bottom: number }) =>
    a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;

  // 1. En el centro de lo que se ve, si está libre.
  const visible = { left: 300, top: 200, right: 700, bottom: 500 };
  const p1 = placeInView(mesa, { x: 500, y: 350 }, visible, zone, []);
  check("una mesa nueva cae en el centro de lo que se ve", p1.x === 460 && p1.y === 310, JSON.stringify(p1));

  // 2. Si ahí ya hay una, en el hueco libre más cercano, sin solaparse y visible.
  const ocupada = { ...mesa, x: 460, y: 310 };
  const p2 = placeInView(mesa, { x: 500, y: 350 }, visible, zone, [ocupada]);
  const caja2 = occupiedBox({ ...mesa, ...p2 });
  check("si el centro está ocupado, busca el hueco libre más cercano", !solapan(caja2, occupiedBox(ocupada)) && dentro(caja2, visible), JSON.stringify(p2));
  check("  y cerca (no en la otra punta)", Math.hypot(p2.x - 460, p2.y - 310) < 150, JSON.stringify(p2));

  // 3. Lleno de mesas alrededor: aun así queda dentro de lo visible.
  const llenas = [];
  for (let x = 300; x < 700; x += 90) for (let y = 200; y < 500; y += 90) llenas.push({ ...mesa, x, y });
  const p3 = placeInView(mesa, { x: 500, y: 350 }, visible, zone, llenas);
  check("sin ningún hueco libre, la mesa sigue dentro de lo visible", dentro(occupiedBox({ ...mesa, ...p3 }), visible), JSON.stringify(p3));

  // 4. Lo visible se recorta a la zona: con el plano desplazado, nunca fuera.
  const fuera = { left: 1100, top: 700, right: 1500, bottom: 1000 };
  const p4 = placeInView(mesa, { x: 1300, y: 850 }, fuera, zone, []);
  check("con el plano desplazado, la mesa nueva queda dentro de la zona", dentro(occupiedBox({ ...mesa, ...p4 }), { left: 0, top: 0, right: 1200, bottom: 800 }), JSON.stringify(p4));

  // 5. Mucho zoom (se ve menos que una mesa): queda centrada en lo visible.
  const diminuto = { left: 500, top: 300, right: 540, bottom: 330 };
  const p5 = placeInView(mesa, { x: 520, y: 315 }, diminuto, zone, []);
  check("con mucho zoom, la mesa nueva queda centrada en la pantalla", p5.x + 40 === 520 && p5.y + 40 === 315, JSON.stringify(p5));

  // 6. Límites al arrastrar (lo que aplica cada mesa al moverse) y al girar.
  check("arrastrada más allá del borde, vuelve dentro", JSON.stringify(clampToZone({ ...mesa, x: 1190, y: -30 }, zone)) === JSON.stringify({ x: 1120, y: 0 }));
  const larga = { width: 200, height: 60, rotation: 90, x: 50, y: 400 };
  const { hx, hy } = halfExtent(larga);
  check("una mesa larga girada 90° ocupa alto × ancho", Math.round(hx) === 30 && Math.round(hy) === 100);
  const girada = clampToZone({ ...larga, y: 760 }, zone);
  check("  y girada junto al borde no se sale de la zona", dentro(occupiedBox({ ...larga, ...girada }), { left: 0, top: 0, right: 1200, bottom: 800 }), JSON.stringify(girada));
  const g45 = clampToZone({ width: 80, height: 80, rotation: 45, x: 1150, y: 760 }, zone);
  check("  también a 45°", dentro(occupiedBox({ width: 80, height: 80, rotation: 45, ...g45 }), { left: 0, top: 0, right: 1200, bottom: 800 }), JSON.stringify(g45));

  // 7. Pegar: junto al original y dentro de lo que se ve, sin pisarlo.
  const original = { id: "o", elementTypeId: "t", label: "Mesa 1", x: 640, y: 440, width: 80, height: 80, rotation: 0, capacity: 4, status: "ocupada", currentEntryId: "c", occupantName: "Ana", seatedAt: 1 };
  const copia = pastedCopy(original, { id: "c2", typeKey: "mesa-sillas", labelsOfType: ["Mesa 1"], zoneWidth: 1200, zoneHeight: 800 });
  const p7 = placeInView(copia, { x: copia.x + 40, y: copia.y + 40 }, visible, zone, [original]);
  const caja7 = occupiedBox({ ...copia, ...p7 });
  check("pegar deja la copia dentro de lo que se ve", dentro(caja7, visible), JSON.stringify(p7));
  check("  junto al original y sin pisarlo", !solapan(caja7, occupiedBox(original)) && Math.hypot(p7.x - original.x, p7.y - original.y) < 200, JSON.stringify(p7));
}

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
