export default function ModoRapidoPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <div>
      <h1 className="text-lg font-semibold">
        Modo rápido — Restaurante {params.id}
      </h1>
      <p className="text-sm text-gray-500">
        [MIEMBRO B] Aquí van las tarjetas deslizables de clientes en espera,
        el botón de deshacer y el acceso a estadísticas/IA.
      </p>
      {/* TODO: swipe cards, historial para Ctrl+Z, estadísticas, IA */}
    </div>
  );
}
