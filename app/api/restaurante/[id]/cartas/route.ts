// «Ver clientes» del modo rápido: todos los clientes de ESTE
// restaurante en un rango (`?rango=hoy` o `?rango=7dias`), con quién los
// resolvió. Pide "rapido:ver": el admin, en cualquiera; el host, en los suyos;
// analitica no, porque no opera. Sin sesión, 401; sin permiso, 403.
import { NextResponse } from "next/server";
import { z } from "zod";

import { guardApi } from "@/lib/auth/session";
import { CARD_RANGES, listWaitlistCards } from "@/lib/waitlist/cards";

type Context = { params: Promise<{ id: string }> };

const querySchema = z.object({ rango: z.enum(CARD_RANGES).default("hoy") });

export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  const guard = await guardApi(request, "rapido:ver", id);
  if (!guard.ok) return guard.response;

  const parsed = querySchema.safeParse({
    rango: new URL(request.url).searchParams.get("rango") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Rango no válido: usa «hoy» o «7dias»." }, { status: 400 });
  }

  try {
    return NextResponse.json({ entries: await listWaitlistCards(id, parsed.data.rango) });
  } catch (error) {
    console.error("Failed to load waitlist cards", error);
    return NextResponse.json({ error: "No se pudieron cargar los clientes." }, { status: 500 });
  }
}
