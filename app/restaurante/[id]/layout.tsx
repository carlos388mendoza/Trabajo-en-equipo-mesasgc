export default function RestauranteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div>
      <nav className="mb-4 flex flex-wrap gap-2 text-sm">
        <a href="editor" className="rounded-full px-3 py-2 text-slate-600 hover:bg-slate-100">Editor de mesas</a>
        <a href="rapido" className="rounded-full bg-emerald-50 px-3 py-2 font-semibold text-emerald-800">Modo sencillo</a>
        <a href="/analiticas" className="rounded-full px-3 py-2 text-slate-600 hover:bg-slate-100">Estadísticas e IA</a>
      </nav>
      {children}
    </div>
  );
}
