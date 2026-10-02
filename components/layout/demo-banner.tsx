import Link from "next/link";
import { FlaskConical, ShieldCheck } from "lucide-react";

import { can } from "@/lib/auth/rbac";
import { getCurrentUser } from "@/lib/auth/session";
import { demoSummary } from "@/lib/demo/load";

// Aviso global de que hay datos de demostración.
//
// Es una franja discreta, sin modal y sin bloquear nada: no tapa el contenido, no
// steals el foco y no impide usar el Modo rápido ni el mapa. Solo avisa, que es
// lo que hace falta para que nadie tome por reales unos números que no lo son.
//
// Lo ven el admin y analítica (`demo:ver`). El host no: en el modo sencillo
// cada carta de demostración lleva su etiqueta «Demo».
//
//  - Admin: el aviso lleva a la sección «Datos de demostración» de /admin, con
//    los botones para borrarlos.
//  - Analítica: a /admin/datos-demo, para ver los conteos (sin borrar).
//
// Desaparece solo en cuanto no queda nada marcado como demo: la página se
// renderiza en el servidor, así que `demoSummary()` se consulta en cada carga y
// no hay estado que sincronizar.

export async function DemoBanner() {
  const user = await getCurrentUser();
  if (!user || !can(user, "demo:ver")) return null;
  const summary = await demoSummary();
  if (!summary.activo) return null;

  const puedeBorrar = can(user, "demo:borrar");

  return (
    <div
      // `role="status"` (no `alert`): avisa sin robar el foco ni interrumpir lo
      // que el usuario estuviera haciendo.
      role="status"
      className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-app-border bg-accent/15 px-4 py-1.5 text-center text-xs text-accent"
    >
      <span className="inline-flex items-center gap-1.5 font-medium">
        <FlaskConical aria-hidden size={14} strokeWidth={2} />
        Hay datos de demostración cargados ({summary.total} filas): los clientes, las mesas y las
        cifras que ves ahora no son reales.
      </span>
      <Link
        href={puedeBorrar ? "/admin#datos-demo" : "/admin/datos-demo"}
        className="inline-flex items-center gap-1 rounded-lg px-2 py-0.5 font-semibold underline underline-offset-2 hover:bg-accent/15"
      >
        {puedeBorrar ? <ShieldCheck aria-hidden size={13} strokeWidth={2} /> : null}
        {puedeBorrar ? "Administrar datos demo" : "Ver datos de demostración"}
      </Link>
    </div>
  );
}