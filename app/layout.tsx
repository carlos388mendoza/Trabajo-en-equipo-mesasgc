import "./globals.css";

export const metadata = {
  title: "Table Waitlist",
  description: "Sistema de manejo de listas de espera en restaurantes",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es">
      {/* Extensiones como Grammarly añaden atributos al <body> antes de que
          React hidrate, y eso daba un error de hydration que no es nuestro.
          Solo afecta a los atributos de este elemento, no a sus hijos. */}
      <body suppressHydrationWarning>
        <header className="flex items-center justify-between p-4 border-b">
          <a href="/" className="text-lg font-bold tracking-tight text-slate-900">Table<span className="text-emerald-700">Waitlist</span></a>
          {/* TODO (Ambos): nombre del usuario logueado + botón de logout, viene de Better Auth */}
        </header>
        <main className="min-h-[calc(100vh-65px)] bg-slate-50">{children}</main>
      </body>
    </html>
  );
}
