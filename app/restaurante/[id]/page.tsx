export default function RestaurantePage({
  params,
}: {
  params: { id: string };
}) {
  return (
    <div>
      <h1 className="text-xl font-semibold">Restaurante {params.id}</h1>
      <p>Elige un modo desde el menú de arriba.</p>
    </div>
  );
}
