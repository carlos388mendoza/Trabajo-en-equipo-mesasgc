// Demo del tiempo real: hace de "otro host" contra un servidor ya arrancado.
//
// Sirve para ver la asignación en vivo: abre el editor o el modo rápido en el
// navegador y lanza esto desde otra terminal.
//
//   npm run demo:host -- sentar  <mesa> <cliente>
//   npm run demo:host -- liberar <mesa> <cliente>
//   npm run demo:host -- carrera <mesa> <clienteA> <clienteB>   (dos hosts a la vez)
//
// Con el seed: mesas `tbl_c_1`, `tbl_c_2`... y clientes `wl_1`, `wl_2`, `wl_3`
// del restaurante `rest_centro`. Variables opcionales: URL (por defecto
// http://localhost:3000) y RESTAURANTE (por defecto rest_centro).
//
// Pasa por los mismos eventos y permisos que el navegador (`POST
// /api/tiempo-real`): no toca la base de datos directamente. Por eso inicia
// sesión primero. Por defecto entra con el admin de los usuarios de prueba del
// seed (solo desarrollo); DEMO_EMAIL y DEMO_PASSWORD (o SEED_PASSWORD) lo cambian.

const URL = process.env.URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
const RESTAURANT = process.env.RESTAURANTE ?? "rest_centro";
const EMAIL = process.env.DEMO_EMAIL ?? "admin@grupocomidas.test";
const PASSWORD = process.env.DEMO_PASSWORD ?? process.env.SEED_PASSWORD;
if (!PASSWORD) throw new Error("Define DEMO_PASSWORD o SEED_PASSWORD (la del seed de desarrollo).");
const [mode, tableId, entryA, entryB] = process.argv.slice(2);

const USAGE =
  "Uso: npm run demo:host -- sentar|liberar <mesa> <cliente>\n" +
  "     npm run demo:host -- carrera <mesa> <clienteA> <clienteB>";

/** Inicia sesión y devuelve la cookie de sesión. */
async function login() {
  let response;
  try {
    response = await fetch(`${URL}/api/auth/sign-in/email`, {
      method: "POST",
      // Better Auth rechaza peticiones sin un Origin de confianza.
      headers: { "Content-Type": "application/json", Origin: URL },
      body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
    });
  } catch {
    throw new Error(`No hay servidor en ${URL}. ¿Está corriendo \`npm run dev\`?`);
  }
  if (!response.ok) {
    throw new Error(`No se pudo iniciar sesión como ${EMAIL} (HTTP ${response.status}).`);
  }
  return response.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

/** Manda un evento como lo hace el navegador y devuelve el acuse del servidor. */
async function send(cookie, event, payload) {
  const response = await fetch(`${URL}/api/tiempo-real`, {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify({ event, payload, restaurantId: RESTAURANT }),
  });
  if (!response.ok) throw new Error(`${event}: el servidor respondió HTTP ${response.status}.`);
  return (await response.json()).ack;
}

/** Entra a la sala del restaurante (hace falta antes de sentar o liberar). */
async function host(name, cookie) {
  const join = await send(cookie, "restaurant:join", { restaurantId: RESTAURANT });
  if (!join.ok) throw new Error(`${name}: ${join.error}`);
  return cookie;
}

function show(name, res) {
  console.log(
    res.ok
      ? `${name}: OK -> mesa ${res.table.tableId} ${res.table.status} (v${res.table.version})`
      : `${name}: RECHAZADO -> ${res.error}`,
  );
}

try {
  const cookie = await login();
  if ((mode === "sentar" || mode === "liberar") && tableId && entryA) {
    await host("host", cookie);
    const event = mode === "sentar" ? "table:assign" : "table:release";
    show("host", await send(cookie, event, { tableId, entryId: entryA }));
  } else if (mode === "carrera" && tableId && entryA && entryB) {
    await Promise.all([host("host A", cookie), host("host B", cookie)]);
    // Las dos peticiones salen antes de esperar a ninguna.
    const [resA, resB] = await Promise.all([
      send(cookie, "table:assign", { tableId, entryId: entryA }),
      send(cookie, "table:assign", { tableId, entryId: entryB }),
    ]);
    show(`host A (${entryA})`, resA);
    show(`host B (${entryB})`, resB);
  } else {
    console.log(USAGE);
    process.exitCode = 1;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
