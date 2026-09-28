export default async function ModoRapidoPage({
  params,
}: {
  // Next 16: `params` es una Promise (ver app/restaurante/[id]/page.tsx).
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div>
      <h1 className="text-lg font-semibold">
        Modo rápido — Restaurante {id}
      </h1>
      <p className="text-sm text-gray-500">
        [MIEMBRO B] Aquí van las tarjetas deslizables de clientes en espera,
        el botón de deshacer y el acceso a estadísticas/IA.
      </p>
      {/* TODO: swipe cards, historial para Ctrl+Z, estadísticas, IA */}
    </div>
  );
}
