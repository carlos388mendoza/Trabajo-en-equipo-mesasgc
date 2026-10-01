"use client";

// Datos de demostración: contarlos y, si eres admin, borrarlos.
//
// El borrado es la única operación de la app que elimina filas, así que:
//
//  - El botón SOLO se pinta si la página le dijo que el usuario puede borrar
//    (`puedeBorrar`). Eso es presentación, no seguridad: la comprobación de
//    verdad la hace la server action.
//  - Pide escribir BORRAR antes de habilitar el botón. Un Enter distraído no
//    borra nada, y un POST a mano sin la palabra tampoco (el servidor la
//    vuelve a pedir).
//
// Cuando termina bien, el servidor revalida las pantallas que muestran clientes
// y mesas; esta solo avisa del resultado y deja que el router refresque.

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Eraser, FlaskConical } from "lucide-react";

import { deleteDemoDataAction } from "@/app/admin/demo-actions";
import { Button, ConfirmDialog } from "@/components/admin/ui";
import { DEMO_DELETE_WORD } from "@/lib/demo/fixtures";

export type AdminDemoSummary = {
  zonas: number;
  mesas: number;
  clientes: number;
  total: number;
};

export function AdminDemoData({
  summary,
  puedeBorrar,
}: {
  summary: AdminDemoSummary;
  puedeBorrar: boolean;
}) {
  const router = useRouter();
  const [confirmando, setConfirmando] = useState(false);
  const [palabra, setPalabra] = useState("");
  const [mensaje, setMensaje] = useState<{ ok: true; text: string } | { ok: false; text: string } | null>(null);
  const [pendiente, startTransition] = useTransition();

  const listo = palabra.trim() === DEMO_DELETE_WORD;

  function borrar() {
    startTransition(async () => {
      const resultado = await deleteDemoDataAction({ confirmacion: palabra });
      if (resultado.ok) {
        setConfirmando(false);
        setPalabra("");
        setMensaje({ ok: true, text: resultado.message });
        // Los contadores de esta pantalla vienen del servidor.
        router.refresh();
      } else {
        setMensaje({ ok: false, text: resultado.error });
      }
    });
  }

  return (
    <section className="space-y-3 rounded-2xl border border-app-border bg-panel p-4 text-panel-text">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold">
            <FlaskConical aria-hidden size={20} strokeWidth={2} />
            Datos de demostración
          </h2>
          <p className="mt-1 text-sm text-panel-muted">
            Clientes, mesas y zonas falsos, cargados con <code>npm run db:demo</code> para
            poder probar estadísticas, mapa y asistente sin esperar al piloto.
          </p>
        </div>
        {puedeBorrar && summary.total > 0 ? (
          <Button icon={Eraser} danger onClick={() => setConfirmando(true)}>
            Borrar datos demo
          </Button>
        ) : null}
      </div>

      {summary.total > 0 ? (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-xl bg-app-border/40 px-3 py-2">
            <dt className="text-xs text-panel-muted">Total de filas</dt>
            <dd className="text-lg font-bold">{summary.total}</dd>
          </div>
          <div className="rounded-xl bg-app-border/40 px-3 py-2">
            <dt className="text-xs text-panel-muted">Zonas</dt>
            <dd className="text-lg font-bold">{summary.zonas}</dd>
          </div>
          <div className="rounded-xl bg-app-border/40 px-3 py-2">
            <dt className="text-xs text-panel-muted">Mesas</dt>
            <dd className="text-lg font-bold">{summary.mesas}</dd>
          </div>
          <div className="rounded-xl bg-app-border/40 px-3 py-2">
            <dt className="text-xs text-panel-muted">Clientes</dt>
            <dd className="text-lg font-bold">{summary.clientes}</dd>
          </div>
        </dl>
      ) : (
        <p className="rounded-xl bg-app-border/40 px-3 py-2 text-sm text-panel-muted">
          No hay datos de demostración cargados. Para cargarlos:{" "}
          <code className="rounded bg-app-border/60 px-1">npm run db:demo</code>.
        </p>
      )}

      {summary.total > 0 ? (
        <p className="flex items-start gap-2 text-sm text-panel-muted">
          <AlertTriangle aria-hidden size={18} strokeWidth={2} className="mt-0.5 shrink-0" />
          <span>
            Borrarlos quita las zonas de demostración, sus mesas y sus clientes (incluido el
            historial de ocho semanas). No se toca ninguna marca, restaurante, usuario, catálogo
            ni plano real.
          </span>
        </p>
      ) : null}

      {!puedeBorrar ? (
        <p className="text-sm text-panel-muted">
          Solo un administrador puede borrar los datos de demostración.
        </p>
      ) : null}

      {mensaje ? (
        <p
          role="status"
          className={`rounded-xl px-3 py-2 text-sm ${
            mensaje.ok ? "bg-accent/15 text-accent" : "bg-estado-ocupada/15 text-estado-ocupada"
          }`}
        >
          {mensaje.text}
        </p>
      ) : null}

      {confirmando ? (
        <ConfirmDialog
          title="Borrar los datos de demostración"
          pending={pendiente}
          // El botón solo se habilita con la palabra escrita: un Enter distraído
          // no borra nada. El servidor la vuelve a pedir (ver demo-actions.ts).
          confirmDisabled={!listo}
          confirmLabel={pendiente ? "Borrando…" : "Borrar"}
          onCancel={() => {
            setConfirmando(false);
            setPalabra("");
            setMensaje(null);
          }}
          onConfirm={borrar}
          danger
        >
          <p>
            Se borrarán <strong>{summary.total}</strong> filas marcadas como demostración:{" "}
            {summary.zonas} zona(s), {summary.mesas} mesa(s) y {summary.clientes} cliente(s).
          </p>
          <p>Las marcas, los restaurantes, los usuarios y los planos reales no se tocan.</p>
          <p className="font-semibold">
            Escribe {DEMO_DELETE_WORD} para confirmar:
          </p>
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