export default function HomePage() {
  return (
    <div>
      <h1 className="text-2xl font-bold">Bienvenido a Table Waitlist</h1>
      <p>Inicia sesión para continuar.</p>
      {/* TODO (Ambos): si no hay sesión activa, redirigir a /login */}
    </div>
  );
}
