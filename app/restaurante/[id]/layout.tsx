export default function RestauranteLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div>
      <nav className="mb-4 flex flex-wrap gap-2 text-sm">
        <a href="editor" className="rounded-full px-3 py-2 text-app-muted hover:bg-app-border/60">Editor de mesas</a>
        <a href="rapido" className="rounded-full bg-accent/15 px-3 py-2 font-semibold text-accent">Modo sencillo</a>
        <a href="/analiticas" className="rounded-full px-3 py-2 text-app-muted hover:bg-app-border/60">Estadísticas e IA</a>
      </nav>
      {children}
    </div>
  );
}
