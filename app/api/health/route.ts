/** Healthcheck público de Railway: no consulta la sesión ni la base de datos. */
export function GET() {
  return Response.json({ ok: true });
}
