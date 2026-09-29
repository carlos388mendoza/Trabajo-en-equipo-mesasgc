// Demo del tiempo real: hace de "otro host" contra un servidor ya arrancado.
//
// Sirve para ver la asignación en vivo mientras no exista la UI del modo
// rápido: abre el editor en el navegador y lanza esto desde otra terminal.
//
//   npm run demo:host -- sentar  <mesa> <cliente>
//   npm run demo:host -- liberar <mesa> <cliente>
//   npm run demo:host -- carrera <mesa> <clienteA> <clienteB>   (dos hosts a la vez)
//
// Con el seed: mesas `tbl_c_1`, `tbl_c_2`... y clientes `wl_1`, `wl_2`, `wl_3`
// del restaurante `rest_centro`. Variables opcionales: URL (por defecto
// http://localhost:3000) y RESTAURANTE (por defecto rest_centro).
//
// Pasa por los mismos eventos y permisos que el navegador: no toca la base de
// datos directamente. Por eso inicia sesión primero: el socket exige una
// sesión de Better Auth. Por defecto entra con el admin de los usuarios de
// prueba del seed (solo desarrollo); DEMO_EMAIL y DEMO_PASSWORD lo cambian.

import { io } from "socket.io-client";

const URL = process.env.URL ?? `http://localhost:${process.env.PORT ?? 3000}`;
const RESTAURANT = process.env.RESTAURANTE ?? "rest_centro";
const EMAIL = process.env.DEMO_EMAIL ?? "admin@grupocomidas.test";
const PASSWORD = process.env.DEMO_PASSWORD ?? "12345abc";
const [mode, tableId, entryA, entryB] = process.argv.slice(2);

const USAGE =
  "Uso: npm run demo:host -- sentar|liberar <mesa> <cliente>\n" +
  "     npm run demo:host -- carrera <mesa> <clienteA> <clienteB>";

/** Inicia sesión y devuelve la cookie para el handshake del socket. */
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
  return (response.headers.get("set-cookie") ?? "").split(";")[0];
}

let cookie;

async function host(name) {
  cookie ??= await login();
  const socket = io(URL, {
    transports: ["websocket"],
    reconnection: false,
    extraHeaders: { cookie },
  });
  await new Promise((resolve, reject) => {
    socket.once("connect", resolve);
    socket.once("connect_error", (err) =>
      reject(new Error(`${name}: el servidor rechazó la conexión (${err.message}).`)),
    );
  });
  const join = await socket
    .timeout(3000)
    .emitWithAck("restaurant:join", { restaurantId: RESTAURANT });
  if (!join.ok) throw new Error(`${name}: ${join.error}`);
  return socket;
}

function show(name, res) {
  console.log(
    res.ok
      ? `${name}: OK -> mesa ${res.table.tableId} ${res.table.status} (v${res.table.version})`
      : `${name}: RECHAZADO -> ${res.error}`,
  );
}

try {
  if ((mode === "sentar" || mode === "liberar") && tableId && entryA) {
    const socket = await host("host");
    const event = mode === "sentar" ? "table:assign" : "table:release";
    show("host", await socket.timeout(3000).emitWithAck(event, { tableId, entryId: entryA }));
    socket.close();
  } else if (mode === "carrera" && tableId && entryA && entryB) {
    const [a, b] = await Promise.all([host("host A"), host("host B")]);
    // Las dos peticiones salen antes de esperar a ninguna.
    const [resA, resB] = await Promise.all([
      a.timeout(3000).emitWithAck("table:assign", { tableId, entryId: entryA }),
      b.timeout(3000).emitWithAck("table:assign", { tableId, entryId: entryB }),
    ]);
    show(`host A (${entryA})`, resA);
    show(`host B (${entryB})`, resB);
    a.close();
    b.close();
  } else {
    console.log(USAGE);
    process.exitCode = 1;
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
}
