export default function EditorPage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <div>
      <h1 className="text-lg font-semibold">
        Editor de mesas — Restaurante {params.id}
      </h1>
      <p className="text-sm text-gray-500">
        [MIEMBRO A] Aquí va el canvas con react-konva para arrastrar y soltar
        mesas, más la conexión a Socket.IO para tiempo real.
      </p>
      {/* TODO: canvas de mesas, drag & drop, websocket, resolución de conflictos */}
    </div>
  );
}
