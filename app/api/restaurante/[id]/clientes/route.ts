// TODO(auth): validar sesión Better Auth y permisos sobre el restaurante en GET y POST.
import { asc, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { waitlistEntries } from "@/lib/db/schema";

type Context = { params: Promise<{ id: string }> };

const newEntrySchema = z.object({
  customerName: z.string().trim().min(1).max(100),
  partySize: z.number().int().min(1).max(10),
  notes: z.string().trim().max(500).optional().default(""),
});

export async function GET(_request: Request, { params }: Context) {
  const { id } = await params;
  try {
    const entries = await db
      .select()
      .from(waitlistEntries)
      .where(eq(waitlistEntries.restaurantId, id))
      .orderBy(asc(waitlistEntries.arrivedAt));

    return NextResponse.json({
      entries: entries.map((entry) => ({
        ...entry,
        arrivedAt: entry.arrivedAt.getTime(),
        calledAt: entry.calledAt?.getTime() ?? null,
        seatedAt: entry.seatedAt?.getTime() ?? null,
      })),
    });
  } catch (error) {
    console.error("Failed to load restaurant waitlist", error);
    return NextResponse.json({ error: "No se pudo cargar la lista de clientes." }, { status: 500 });
  }
}

export async function POST(request: Request, { params }: Context) {
  const { id } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "El cuerpo de la solicitud no es válido." }, { status: 400 });
  }
  const parsed = newEntrySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Revisa el nombre y la cantidad de personas." }, { status: 400 });
  }

  const now = new Date();
  const entry = {
    id: crypto.randomUUID(),
    restaurantId: id,
    customerName: parsed.data.customerName,
    partySize: parsed.data.partySize,
    notes: parsed.data.notes || null,
    status: "esperando",
    arrivedAt: now,
    createdAt: now,
    updatedAt: now,
  };

  try {
    await db.insert(waitlistEntries).values(entry);
    return NextResponse.json({
      entry: { ...entry, arrivedAt: now.getTime() },
    }, { status: 201 });
  } catch (error) {
    console.error("Failed to add restaurant waitlist entry", error);
    return NextResponse.json({ error: "No se pudo guardar el cliente." }, { status: 500 });
  }
}
