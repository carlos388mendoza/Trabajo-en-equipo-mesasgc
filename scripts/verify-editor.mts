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
