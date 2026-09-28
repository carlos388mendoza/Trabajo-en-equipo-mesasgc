export default async function RestaurantePage({
  params,
}: {
  // Next 16: `params` es una Promise. El acceso síncrono se eliminó por
  // completo en la 16 (en la 15 había un periodo de compatibilidad).
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div>
      <h1 className="text-xl font-semibold">Restaurante {id}</h1>
      <p>Elige un modo desde el menú de arriba.</p>
    </div>
  );
}
