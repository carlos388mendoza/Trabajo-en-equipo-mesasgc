import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { waitlistEntries } from "@/lib/db/schema";

export const runtime = "nodejs";

export async function PATCH(request: Request, { params }: { params: { id: string; clienteId: string } }) {
  let body: { status?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "La solicitud no tiene un formato válido." }, { status: 400 }); }

  if (body.status !== "listo" && body.status !== "ausente") {
    return NextResponse.json({ error: "El estado no es válido." }, { status: 400 });
  }

  try {
    const updated = await db.update(waitlistEntries)
      .set({ status: body.status, seatedAt: body.status === "listo" ? Date.now() : null })
      .where(and(eq(waitlistEntries.id, params.clienteId), eq(waitlistEntries.restaurantId, params.id)))
      .returning();
    if (!updated.length) return NextResponse.json({ error: "No se encontró ese cliente." }, { status: 404 });
    return NextResponse.json({ entry: updated[0] });
  } catch {
    return NextResponse.json({ error: "No se pudo actualizar el cliente en Turso." }, { status: 503 });
  }
}
