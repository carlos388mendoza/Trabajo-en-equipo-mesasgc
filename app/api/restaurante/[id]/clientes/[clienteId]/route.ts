// Permisos: "rapido:modificar" sobre ESTE restaurante. Sin sesión, 401; sin
// permiso, 403.
import { and, eq, inArray } from "drizzle-orm";
import { NextResponse } from "next/server";
import { z } from "zod";

import { guardApi } from "@/lib/auth/session";
import { db } from "@/lib/db";
import { ACTIVE_WAITLIST_STATUSES } from "@/lib/db/enums";
import { waitlistEntries } from "@/lib/db/schema";

type Context = { params: Promise<{ id: string; clienteId: string }> };
const updateSchema = z.object({ status: z.enum(["listo", "ausente"]) });

export async function PATCH(request: Request, { params }: Context) {
  const { id, clienteId } = await params;
  const guard = await guardApi(request, "rapido:modificar", id);
  if (!guard.ok) return guard.response;
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
        ...(parsed.data.status === "listo" ? { calledAt: now } : {}),
        seatedAt: null,
        updatedAt: now,
      })
      .where(and(
        eq(waitlistEntries.id, clienteId),
        eq(waitlistEntries.restaurantId, id),
        inArray(waitlistEntries.status, ACTIVE_WAITLIST_STATUSES),
      ))
      .returning({ id: waitlistEntries.id });

    if (updated.length === 0) {
      return NextResponse.json(
        { error: "Este cliente ya fue atendido por otro dispositivo" },
        { status: 409 },
      );
    }
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Failed to update restaurant waitlist entry", error);
    return NextResponse.json({ error: "No se pudo actualizar el cliente." }, { status: 500 });
  }
}
