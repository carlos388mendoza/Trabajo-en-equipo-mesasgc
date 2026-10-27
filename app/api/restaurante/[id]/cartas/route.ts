// «Ver clientes» del modo rápido: los clientes de ESTE restaurante, paginados y
// filtrados en el servidor (ver `queryWaitlistCards`):
//
//   ?rango=hoy|7dias|30dias|todos  &estado=todas|esperando|listo|ausente|ocupando
//   &q=nombre  &mesero=Ana  &antes=<cursor>  &limite=50
//
// Devuelve una página (50 por defecto), los conteos de cada filtro y el cursor
// de «Ver más». Pide "rapido:ver": el admin, en cualquiera; el host, en los
// suyos; analitica no, porque no opera. Sin sesión, 401; sin permiso, 403.
import { NextResponse } from "next/server";
import { z } from "zod";

import { guardApi } from "@/lib/auth/session";
import { CARD_FILTERS, CARD_PAGE_MAX, CARD_PAGE_SIZE, CARD_RANGES, decodeCardCursor } from "@/lib/waitlist/card-options";
import { queryWaitlistCards } from "@/lib/waitlist/cards";
import { logServerError } from "@/lib/log";

type Context = { params: Promise<{ id: string }> };

const querySchema = z.object({
  rango: z.enum(CARD_RANGES).default("hoy"),
  estado: z.enum(CARD_FILTERS).default("todas"),
  q: z.string().trim().max(100).default(""),
  mesero: z.string().trim().max(60).default(""),
  antes: z.string().max(120).default(""),
  limite: z.coerce.number().int().min(1).max(CARD_PAGE_MAX).default(CARD_PAGE_SIZE),
});

export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  const guard = await guardApi(request, "rapido:ver", id);
  if (!guard.ok) return guard.response;

  const search = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse(Object.fromEntries([...search.entries()].filter(([, v]) => v !== "")));
  if (!parsed.success) {
    return NextResponse.json({ error: "Filtro no válido." }, { status: 400 });
  }
  const { rango, estado, q, mesero, antes, limite } = parsed.data;
  const before = antes ? decodeCardCursor(antes) : null;
  if (antes && !before) return NextResponse.json({ error: "Filtro no válido." }, { status: 400 });

  try {
    const page = await queryWaitlistCards(id, { range: rango, filter: estado, query: q, waiter: mesero || null, before, limit: limite });
    return NextResponse.json(page);
  } catch (error) {
    logServerError("Failed to load waitlist cards", error);
    return NextResponse.json({ error: "No se pudieron cargar los clientes." }, { status: 500 });
  }
}
