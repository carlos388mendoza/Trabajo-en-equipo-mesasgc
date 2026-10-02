// Mesas de ESTE restaurante para «Sentar» del modo sencillo. Pide
// "rapido:ver" (el admin, en cualquiera; el host, en los suyos; analitica no,
// porque no opera). Sentar y liberar van por el socket (`table:assign` /
// `table:release`, con "mesas:asignar"). Sin sesión, 401; sin permiso, 403.
import { NextResponse } from "next/server";

import { guardApi } from "@/lib/auth/session";
import { listSeatableTables } from "@/lib/tables/list";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: Context) {
  const { id } = await params;
  const guard = await guardApi(request, "rapido:ver", id);
  if (!guard.ok) return guard.response;
  try {
    return NextResponse.json({ tables: await listSeatableTables(id) });
  } catch (error) {
    console.error("Failed to load seatable tables", error);
    return NextResponse.json({ error: "No se pudieron cargar las mesas." }, { status: 500 });
  }
}
