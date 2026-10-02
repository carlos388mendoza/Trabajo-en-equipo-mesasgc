"use client";

// Datos de demostración: cuántos hay en cada restaurante y, si eres admin,
// borrarlos (todos, o los de un restaurante).
//
// El borrado es la operación que más filas elimina de golpe, así que:
//
//  - Los botones SOLO se pintan si la página le dijo que el usuario puede
//    borrar (`puedeBorrar`). Eso es presentación, no seguridad: la
//    comprobación de verdad la hace la server action (`demo:borrar`).
//  - La confirmación dice EXACTAMENTE cuánto se va a borrar y pide escribir
//    BORRAR antes de habilitar el botón. Un Enter distraído no borra nada, y
//    un POST a mano sin la palabra tampoco (el servidor la vuelve a pedir).
//  - Solo se borra lo marcado como demo (`is_demo`): nunca datos reales,
//    restaurantes, marcas ni usuarios.
//
// Cuando termina bien, el servidor revalida las pantallas que muestran clientes
// y mesas; esta solo avisa del resultado y deja que el router refresque.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Eraser, FlaskConical } from "lucide-react";

import { deleteDemoDataAction } from "@/app/admin/demo-actions";
import { Button, ConfirmDialog } from "@/components/admin/ui";
import type { DemoBreakdown, DemoCounts } from "@/lib/demo/summary";
import { DEMO_DELETE_WORD } from "@/lib/demo/fixtures";

type Target = { kind: "todo" } | { kind: "restaurante"; restaurantId: string; name: string };

const fmt = (n: number) => n.toLocaleString("es-HN");

function describe(c: DemoCounts): string {
  return `${fmt(c.clientes)} cliente(s), ${fmt(c.historial)} del historial, ${fmt(c.mesas)} mesa(s) y ${fmt(c.zonas)} zona(s)`;
}

export function AdminDemoData({ breakdown, puedeBorrar }: { breakdown: DemoBreakdown; puedeBorrar: boolean }) {
  const router = useRouter();
  const [target, setTarget] = useState<Target | null>(null);
  const [palabra, setPalabra] = useState("");
  const [mensaje, setMensaje] = useState<{ ok: boolean; text: string } | null>(null);
  const [pendiente, startTransition] = useTransition();
  const { totales, restaurantes } = breakdown;
  const listo = palabra.trim() === DEMO_DELETE_WORD;

  // Lo que se va a borrar con el botón que se pulsó: el total, o un restaurante.
  const scope = target?.kind === "restaurante" ? restaurantes.find((r) => r.restaurantId === target.restaurantId) : totales;

  function cerrar() {
    setTarget(null);
    setPalabra("");
  }

  function borrar() {
    if (!target) return;
    startTransition(async () => {
      const resultado = await deleteDemoDataAction({
        confirmacion: palabra,
        restaurantId: target.kind === "restaurante" ? target.restaurantId : undefined,
      });
      if (resultado.ok) {
        cerrar();
        setMensaje({ ok: true, text: resultado.message });
        // Los contadores de esta pantalla vienen del servidor.
        router.refresh();
      } else {
        setMensaje({ ok: false, text: resultado.error });
      }
    });
  }

  return (
    <section id="datos-demo" className="scroll-mt-24 space-y-3 rounded-2xl border border-app-border bg-panel p-4 text-panel-text">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <FlaskConical aria-hidden size={20} strokeWidth={2} />
            Datos de demostración
          </h2>
          <p className="mt-1 text-sm text-panel-muted">
            Clientes, historial, mesas y zonas falsos para probar estadísticas, mapa y asistente sin
            esperar al piloto. En el modo sencillo cada carta de demostración lleva la etiqueta «Demo».
          </p>
        </div>
        {puedeBorrar && totales.total > 0 ? (
          <Button icon={Eraser} danger onClick={() => { setMensaje(null); setTarget({ kind: "todo" }); }}>
            Borrar todos los datos de demostración
          </Button>
        ) : null}
      </div>

      {totales.total > 0 ? (
        <>
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {([
              ["Clientes", totales.clientes],
              ["Historial", totales.historial],
              ["Mesas", totales.mesas],
              ["Zonas", totales.zonas],
            ] as const).map(([label, value]) => (
              <div key={label} className="rounded-xl bg-app-border/40 px-3 py-2">
                <dt className="text-xs text-panel-muted">{label}</dt>
                <dd className="text-lg font-bold tabular-nums">{fmt(value)}</dd>
              </div>
            ))}
          </dl>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <caption className="sr-only">Datos de demostración por restaurante</caption>
              <thead className="text-left text-xs text-panel-muted">
                <tr>
                  <th className="py-2 pr-3 font-medium">Restaurante</th>
                  <th className="px-2 py-2 text-right font-medium">Clientes</th>
                  <th className="px-2 py-2 text-right font-medium">Historial</th>
                  <th className="px-2 py-2 text-right font-medium">Mesas</th>
                  <th className="px-2 py-2 text-right font-medium">Zonas</th>
                  {puedeBorrar ? <th className="py-2 pl-3"><span className="sr-only">Acciones</span></th> : null}
                </tr>
              </thead>
              <tbody>
                {restaurantes.map((r) => (
                  <tr key={r.restaurantId} className="border-t border-app-border">
                    <td className="py-2 pr-3">
                      <span className="font-medium">{r.name}</span>
                      {r.brand ? <span className="ml-1.5 text-xs text-panel-muted">{r.brand}</span> : null}
                    </td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmt(r.clientes)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmt(r.historial)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmt(r.mesas)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{fmt(r.zonas)}</td>
                    {puedeBorrar ? (
                      <td className="py-2 pl-3 text-right">
                        <button
                          type="button"
                          onClick={() => { setMensaje(null); setTarget({ kind: "restaurante", restaurantId: r.restaurantId, name: r.name }); }}
                          className="min-h-10 rounded-xl border border-estado-ocupada/50 px-3 text-xs font-semibold text-estado-ocupada transition hover:bg-estado-ocupada/10"
                        >
                          Borrar demo de este restaurante
                        </button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="flex items-start gap-2 text-sm text-panel-muted">
            <AlertTriangle aria-hidden size={18} strokeWidth={2} className="mt-0.5 shrink-0" />
            <span>
              Borrar quita SOLO lo marcado como demostración: sus zonas, mesas, clientes e historial.
              Ninguna marca, restaurante, usuario, catálogo, plano ni cliente real se toca.
            </span>
          </p>
        </>
      ) : (
        <p className="rounded-xl bg-app-border/40 px-3 py-2 text-sm text-panel-muted">
          No hay datos de demostración cargados. Para cargarlos:{" "}
          <code className="rounded bg-app-border/60 px-1">npm run db:demo</code>.
        </p>
      )}

      {!puedeBorrar ? (
        <p className="text-sm text-panel-muted">Solo un administrador puede borrar los datos de demostración.</p>
      ) : null}

      {mensaje ? (
        <p
          role="status"
          className={`rounded-xl px-3 py-2 text-sm ${mensaje.ok ? "bg-accent/15 text-accent" : "bg-estado-ocupada/15 text-estado-ocupada"}`}
        >
          {mensaje.text}
        </p>
      ) : null}

      {target && scope ? (
        <ConfirmDialog
          title={target.kind === "todo" ? "Borrar todos los datos de demostración" : `Borrar el demo de ${target.name}`}
          pending={pendiente}
          // El botón solo se habilita con la palabra escrita: un Enter distraído
          // no borra nada. El servidor la vuelve a pedir (ver demo-actions.ts).
          confirmDisabled={!listo}
          confirmLabel={pendiente ? "Borrando…" : "Borrar"}
          onCancel={() => { cerrar(); setMensaje(null); }}
          onConfirm={borrar}
          danger
        >
          <p>
            Se borrarán <strong>{fmt(scope.clientes + scope.historial + scope.mesas + scope.zonas)}</strong> filas
            marcadas como demostración{target.kind === "restaurante" ? ` de ${target.name}` : ""}: {describe(scope)}.
          </p>
          <p>Las marcas, los restaurantes, los usuarios, los planos y los clientes reales no se tocan.</p>
          <p className="font-semibold">Escribe {DEMO_DELETE_WORD} para confirmar:</p>
          <input
            // El valor va en un input normal: es la única forma de comprobar
            // que alguien lo escribió a conciencia.
            value={palabra}
            onChange={(event) => setPalabra(event.target.value)}
            disabled={pendiente}
            autoComplete="off"
            aria-label={`Escribe ${DEMO_DELETE_WORD} para confirmar`}
            className="h-11 w-full rounded-xl border border-app-border bg-panel px-3 text-panel-text"
          />
        </ConfirmDialog>
      ) : null}
    </section>
  );
}
