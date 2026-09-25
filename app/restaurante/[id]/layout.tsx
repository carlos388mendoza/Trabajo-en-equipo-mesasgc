export default function RestauranteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div>
      <nav className="flex gap-4 mb-4 text-sm">
        <a href="editor" className="underline">Editor de mesas</a>
        <a href="rapido" className="underline">Modo rápido</a>
      </nav>
      {children}
    </div>
  );
}
