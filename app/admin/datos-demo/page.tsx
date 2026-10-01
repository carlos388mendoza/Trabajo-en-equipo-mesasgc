import Link from "next/link";
import { ArrowLeft } from "lucide-react";

import { AdminDemoData } from "@/components/admin/admin-demo";
import { requirePage } from "@/lib/auth/session";
import { can } from "@/lib/auth/rbac";
import { demoSummary } from "@/lib/demo/load";
import { DEMO_BATCH_ID, DEMO_HISTORY_DAYS } from "@/lib/demo/fixtures";

// Datos de demostración (/admin/datos-demo).
//
// Ver los conteos es para cualquier usuario con sesión (`demo:ver`): quien esté
// mirando el mapa o las estadísticas tiene derecho a saber si lo que ve es real
// o de mentira. BORRAR es solo del admin (`demo:borrar`), y la comprobación se
// repite en la server action (`app/admin/demo-actions.ts`), que es la que vale:
// esta página es solo presentación.
//
// La ruta del admin es `/admin` (llámalo como quieras en el enlace).

export const metadata = { title: "Datos demo · Administración · Table Waitlist" };

export default async function DatosDemoPage() {
  const me = await requirePage("/admin/datos-demo", "demo:ver");
  const [summary] = await Promise.all([demoSummary()]);

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div>
        <Link
          href="/admin"
          className="inline-flex items-center gap-1.5 text-sm text-panel-muted hover:text-panel-text"
        >
          <ArrowLeft aria-hidden size={16} strokeWidth={2} />
          Administración
        </Link>
        <h1 className="mt-2 text-2xl font-bold">Datos de demostración</h1>
        <p className="text-sm text-app-muted">
          Qué hay cargado ahora mismo y cómo quitarlo.
        </p>
      </div>

      <AdminDemoData
        summary={{ zonas: summary.zonas, mesas: summary.mesas, clientes: summary.clientes, total: summary.total }}
        puedeBorrar={can(me, "demo:borrar")}
      />

      <section className="space-y-2 rounded-2xl border border-app-border bg-panel p-4 text-sm text-panel-muted">
        <h2 className="text-base font-semibold text-panel-text">Cómo funciona</h2>
        <p>
          El lote se marca en la base de datos con <code>is_demo</code> y{" "}
          <code>demo_batch_id</code> (<code>{DEMO_BATCH_ID}</code>). El borrado solo toca filas con
          esa marca, nunca por el nombre: renombrar una zona de demostración no la salva, ni
          renombrar una real la mete en el lote.
        </p>
        <p>
          Los planos de demostración son zonas <strong>propias</strong> de cada restaurante, con la
          sala completa (mesas con sillas, bancada, baños, caja y zona de juegos). La zona real de
          cada local —y cualquier plano que se haya dibujado a mano— no se lee ni se toca.
        </p>
        <p>
          El historial cubre {DEMO_HISTORY_DAYS} días (ocho semanas) para que las estadísticas y el
          asistente tengan algo que contar. Los clientes llevan teléfonos de mentira y una nota que
          lo dice.
        </p>
        <p>
          Si algo <strong>real</strong> depende de algo de demostración, el borrado no lo resuelve
          a la fuerza: se niega y explica qué bloquea. Es preferible a dejar un cliente real sin su
          mesa sin que nadie lo hubiera pedido.
        </p>
        <p>
          Desde la terminal se hace lo mismo, con <code>npm run db:demo</code> y{" "}
          <code>npm run db:demo:borrar</code> (pide escribir <code>BORRAR</code>). Los dos caminos
          llaman al mismo servicio.
        </p>
      </section>
    </div>
  );
}