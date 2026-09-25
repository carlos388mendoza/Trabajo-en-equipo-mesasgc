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
      <body>
        <header className="flex items-center justify-between p-4 border-b">
          <span className="font-bold text-lg">Table Waitlist</span>
          {/* TODO (Ambos): nombre del usuario logueado + botón de logout, viene de Better Auth */}
        </header>
        <main className="p-4">{children}</main>
      </body>
    </html>
  );
}
