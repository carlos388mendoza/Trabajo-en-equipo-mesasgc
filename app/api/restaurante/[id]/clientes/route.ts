import { NextResponse } from "next/server";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { waitlistEntries } from "@/lib/db/schema";

export const runtime = "nodejs";

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const entries = await db.select().from(waitlistEntries)
      .where(eq(waitlistEntries.restaurantId, params.id))
      .orderBy(asc(waitlistEntries.arrivedAt));
    return NextResponse.json({ entries });
  } catch {
    return NextResponse.json({ error: "No se pudo leer la lista de espera." }, { status: 503 });
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  let body: { customerName?: unknown; partySize?: unknown; note?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: "La solicitud no tiene un formato válido." }, { status: 400 }); }

  const customerName = typeof body.customerName === "string" ? body.customerName.trim() : "";
  const partySize = Number(body.partySize);
  const note = typeof body.note === "string" ? body.note.trim() : "";
  if (!customerName || customerName.length > 100 || !Number.isInteger(partySize) || partySize < 1 || partySize > 20 || note.length > 200) {
    return NextResponse.json({ error: "Revisa el nombre, el tamaño del grupo y la nota." }, { status: 400 });
  }

  const entry = {
    id: crypto.randomUUID(), restaurantId: params.id, customerName, partySize, note,
    status: "esperando", arrivedAt: Date.now(), seatedAt: null,
  };
  try {
    await db.insert(waitlistEntries).values(entry);
    return NextResponse.json({ entry }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "No se pudo guardar el cliente en Turso." }, { status: 503 });
  }
}
