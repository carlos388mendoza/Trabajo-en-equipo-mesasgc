// La puerta HTTP del tiempo real: lo que antes entraba por el socket.
//
//   POST /api/tiempo-real   { event, payload, restaurantId }  → { ack, self, cursor? }
//   GET  /api/tiempo-real?restaurante=<id>&mapa=1&desde=<n>  → { events, cursor, reset }
//
// El POST hace la acción (sentar, agregar a la lista...) y deja el aviso en la
// base; el GET es el sondeo: «dame los avisos de mis salas después de N».
// Sin `desde`, el GET solo comprueba la sesión y dice desde dónde escuchar
// (es el «conectar» del cliente).
//
// Funciones con `Request`/`Response` estándar y sin nada de Next: las usan la
// ruta `app/api/tiempo-real/route.ts` y el servidor de `verify-realtime`.

import { identifyRequest } from "./auth";
import { currentCursor, readSince } from "./bus";
import { allowedRooms, handleRealtimeEvent } from "./handlers";

/** Un evento nunca debería pesar tanto (50 clientes de golpe caben de sobra). */
const MAX_BODY_BYTES = 256 * 1024;

const json = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

const unauthorized = () => json({ error: "No autorizado" }, 401);

export async function handleRealtimePost(request: Request): Promise<Response> {
  const identity = await identifyRequest(request.headers);
  if (!identity) return unauthorized();
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: "Petición demasiado grande." }, 413);
  let body: { event?: unknown; payload?: unknown; restaurantId?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "Petición no válida." }, 400);
  }
  const event = typeof body?.event === "string" ? body.event : "";
  const restaurantId = typeof body?.restaurantId === "string" && body.restaurantId.length <= 200 ? body.restaurantId : null;
  // Al entrar en una sala, el cursor se toma ANTES de leer el estado: así un
  // aviso que llegue entre medias se recibe (a lo sumo, dos veces) y nunca se
  // pierde.
  const joining = event === "restaurant:join" || event === "overview:join";
  const cursor = joining ? await currentCursor() : undefined;
  const reply = await handleRealtimeEvent(identity, restaurantId, event, body.payload);
  return json({ ...reply, cursor });
}

export async function handleRealtimeGet(request: Request): Promise<Response> {
  const identity = await identifyRequest(request.headers);
  if (!identity) return unauthorized();
  const url = new URL(request.url);
  const desde = url.searchParams.get("desde");
  if (desde === null) return json({ events: [], cursor: await currentCursor(), reset: false });
  const after = Number.parseInt(desde, 10);
  if (!Number.isFinite(after) || after < 0) return json({ error: "Cursor no válido." }, 400);
  const rooms = await allowedRooms(identity, {
    restaurantId: url.searchParams.get("restaurante"),
    overview: url.searchParams.get("mapa") === "1",
  });
  return json(await readSince(rooms, after));
}
