// Tarea diaria en Vercel (ver `vercel.json` → `crons`): la retención del
// historial de clientes y la limpieza de los avisos de tiempo real viejos. En
// local y en un servidor propio la hace `server.ts`.
//
// Vercel llama a esta ruta con `Authorization: Bearer <CRON_SECRET>`. Sin esa
// variable configurada, o con otra cabecera, no hace nada: nadie de fuera
// puede lanzar la anonimización a mano.

import { timingSafeEqual } from "node:crypto";

import { logServerError } from "@/lib/log";
import { prune } from "@/lib/realtime/bus";
import { anonymizeExpiredEntries } from "@/lib/settings/privacy";

export const dynamic = "force-dynamic";

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "No autorizado" }, { status: 401 });
  try {
    const run = await anonymizeExpiredEntries();
    await prune();
    return Response.json({ ok: true, retention: run.retention, anonymized: run.anonymized });
  } catch (err) {
    logServerError("[retención] no se pudo aplicar", err);
    return Response.json({ ok: false }, { status: 500 });
  }
}
