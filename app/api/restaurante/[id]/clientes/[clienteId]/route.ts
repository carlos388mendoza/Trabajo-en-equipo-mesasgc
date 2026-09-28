import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { db } from "@/lib/db";
import { waitlistEntries } from "@/lib/db/schema";

type Context = { params: Promise<{ id: string; clienteId: string }> };
const updateSchema = z.object({ status: z.enum(["sentado", "ausente"]) });

export async function PATCH(request: Request, { params }: Context) {
  const { id, clienteId } = await params;
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "El cuerpo de la solicitud no es válido." }, { status: 400 });
  }
  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Estado de cliente no válido." }, { status: 400 });
  }

  const now = new Date();
  try {
    const updated = await db
      .update(waitlistEntries)
      .set({
        status: parsed.data.status,
        seatedAt: parsed.data.status === "sentado" ? now : null,
        updatedAt: now,
      })
      .where(and(eq(waitlistEntries.id, clienteId), eq(waitlistEntries.restaurantId, id)))
      .returning({ id: waitlistEntries.id });

    if (updated.length === 0) {
      return NextResponse.json({ error: "No se encontró ese cliente." }, { status: 404 });
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to update restaurant waitlist entry", error);
    return NextResponse.json({ error: "No se pudo actualizar el cliente." }, { status: 500 });
  }
}
