// Etiqueta «Demo» de las cartas de los datos de demostración (`is_demo`): el
// host las distingue de un cliente de verdad sin salir del modo sencillo.

export function DemoTag({ className = "" }: { className?: string }) {
  return (
    <span
      title="Cliente de los datos de demostración"
      className={`inline-flex shrink-0 items-center rounded-full border border-accent/40 bg-accent/10 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-accent ${className}`}
    >
      Demo
    </span>
  );
}
