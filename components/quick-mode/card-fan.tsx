"use client";

// Abanico de la fila: al tocar una esquina de la carta de arriba, las cartas
// de los que esperan se abren como una mano de naipes. Tocar una la pasa al
// frente del montón; tocar fuera o Esc lo cierra.
//
// Geometría: todas las cartas giran alrededor de un mismo punto, muy por
// debajo de ellas (`transformOrigin`), así que forman un arco. El ángulo
// entre cartas se calcula para que la mano quepa en el ancho de la pantalla.
// Solo se animan `rotate`, `scale` y `opacity` (transform y opacidad, que la
// tablet pinta sin recalcular el diseño), y `MotionConfig reducedMotion`
// del modo rápido las quita si el sistema pide menos movimiento.

import { useEffect, useRef, useSyncExternalStore } from "react";
import { AnimatePresence, motion } from "motion/react";
import { Clock3, UsersRound, X } from "lucide-react";

import { DemoTag } from "@/components/quick-mode/demo-tag";
import { minutes, minutesBetween, people, waitColor } from "@/components/quick-mode/format";

export const FAN_LIMIT = 7;

export type FanGuest = { id: string; name: string; party: number; arrived: number; demo?: boolean };

type CardFanProps = {
  open: boolean;
  /** Los que esperan, en el orden del montón (el primero es el de arriba). */
  guests: FanGuest[];
  now: number;
  onPick: (id: string) => void;
  onClose: () => void;
  /** «+N»: abre «Ver todas las cartas» con los que esperan. */
  onShowAll: () => void;
};

function subscribeResize(onChange: () => void) {
  window.addEventListener("resize", onChange);
  return () => window.removeEventListener("resize", onChange);
}

function useViewportWidth(): number {
  return useSyncExternalStore(subscribeResize, () => window.innerWidth, () => 1024);
}

/** Tamaño de las cartas y ángulo entre ellas para que la mano quepa. */
function fanGeometry(viewport: number, count: number) {
  const width = Math.round(Math.min(200, Math.max(124, viewport * 0.3)));
  const height = Math.round(width * 1.42);
  // Distancia del borde de abajo de la carta al punto de giro.
  const radius = height * 1.5;
  const reach = radius + height / 2;
  // La esquina de fuera de la última carta, ya girada, no puede pasar del
  // borde: se aleja del centro reach·sen θ + (alto/2)·sen θ + ancho/2.
  const room = Math.max(0, viewport / 2 - width / 2 - 12);
  const maxSpread = 2 * Math.asin(Math.min(1, room / (reach + height / 2))) * (180 / Math.PI);
  const step = count > 1 ? Math.min(13, maxSpread / (count - 1)) : 0;
  // Cuánto se ve de cada carta antes de que la tape la siguiente.
  const visible = count > 1 ? reach * Math.sin((step * Math.PI) / 180) : width;
  return { width, height, radius, step, visible };
}

export function CardFan({ open, guests, now, onPick, onClose, onShowAll }: CardFanProps) {
  const viewport = useViewportWidth();
  const shown = guests.slice(0, FAN_LIMIT);
  const hidden = guests.length - shown.length;
  const { width, height, radius, step, visible } = fanGeometry(viewport, shown.length);
  // Con poco espacio por carta, cada una muestra un índice en la esquina
  // (como un naipe) y el nombre en vertical; la última se ve entera.
  const compact = visible < 112;
  const closeRef = useRef<HTMLButtonElement>(null);
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    closeRef.current?.focus({ preventScroll: true });
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      onCloseRef.current();
    }
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      previous?.focus({ preventScroll: true });
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="La fila en abanico"
          className="fixed inset-0 z-50 overflow-hidden"
        >
          <motion.div
            aria-hidden
            className="absolute inset-0 bg-black/55"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onClick={onClose}
          />
          <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-4 sm:p-6">
            <motion.p
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="rounded-2xl bg-panel/95 px-4 py-2.5 text-sm text-panel-text shadow-lg"
            >
              <span className="font-semibold">{guests.length} {guests.length === 1 ? "grupo esperando" : "grupos esperando"}</span>
              <span className="ml-2 text-panel-muted">Toca una carta para pasarla al frente</span>
            </motion.p>
            <button
              ref={closeRef}
              type="button"
              onClick={onClose}
              className="pointer-events-auto grid h-11 w-11 shrink-0 place-items-center rounded-full bg-panel text-panel-text shadow-lg transition hover:bg-app-border"
              aria-label="Cerrar el abanico"
            >
              <X aria-hidden size={20} />
            </button>
          </div>

          {/* Punto de la mano: centro horizontal, algo por encima del centro vertical. */}
          <div className="pointer-events-none absolute left-1/2 top-[46%]">
            {shown.map((guest, index) => {
              const angle = (index - (shown.length - 1) / 2) * step;
              const waited = minutesBetween(guest.arrived, now);
              const last = index === shown.length - 1;
              return (
                <motion.div
                  key={guest.id}
                  className="absolute"
                  style={{
                    width,
                    height,
                    left: -width / 2,
                    top: -height / 2,
                    zIndex: index + 1,
                    transformOrigin: `50% ${height + radius}px`,
                  }}
                  initial={{ rotate: 0, scale: 0.9, opacity: 0 }}
                  animate={{ rotate: angle, scale: 1, opacity: 1 }}
                  exit={{ rotate: 0, scale: 0.9, opacity: 0, transition: { duration: 0.16 } }}
                  transition={{ type: "spring", stiffness: 300, damping: 28, delay: index * 0.025 }}
                >
                  <motion.button
                    type="button"
                    onClick={() => onPick(guest.id)}
                    whileHover={{ y: -18 }}
                    whileFocus={{ y: -18 }}
                    whileTap={{ scale: 0.97 }}
                    transition={{ type: "spring", stiffness: 500, damping: 30 }}
                    className="pointer-events-auto relative flex h-full w-full flex-col overflow-hidden rounded-[1.4rem] border border-app-border bg-panel p-3 text-left text-panel-text shadow-[0_10px_30px_rgba(0,0,0,0.28)] outline-none focus-visible:ring-4 focus-visible:ring-accent/50"
                    aria-label={`${index === 0 ? "Arriba del montón. " : ""}${guest.name}, ${people(guest.party)}, ${minutes(waited)} esperando. Pasar al frente`}
                  >
                    {compact && !last ? (
                      <CompactFace guest={guest} waited={waited} position={index + 1} />
                    ) : (
                      <FullFace
                        guest={guest}
                        waited={waited}
                        position={index + 1}
                        // Lo que no tapa la carta siguiente, menos el relleno.
                        maxWidth={last ? undefined : Math.max(0, visible - 20)}
                      />
                    )}
                  </motion.button>
                </motion.div>
              );
            })}
          </div>

          {hidden > 0 && (
            <motion.button
              type="button"
              onClick={onShowAll}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 10 }}
              className="absolute bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-1/2 z-[60] -translate-x-1/2 rounded-full bg-accent px-5 py-3 text-sm font-semibold text-accent-text shadow-xl transition hover:bg-accent/85"
            >
              +{hidden} · Ver todas las cartas
            </motion.button>
          )}
        </div>
      )}
    </AnimatePresence>
  );
}

type FaceProps = { guest: FanGuest; waited: number; position: number };

/**
 * Todo arriba a la izquierda, como el índice de un naipe: es lo que queda a
 * la vista cuando la carta siguiente tapa el resto.
 */
function FullFace({ guest, waited, position, maxWidth }: FaceProps & { maxWidth?: number }) {
  return (
    <span className="flex flex-col" style={{ maxWidth }}>
      <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-panel-muted">
        N.º {position}
        {guest.demo && <DemoTag />}
      </span>
      {/* `title`: si el nombre es largo y se corta, al pasar el mouse por
          encima sale entero. */}
      <span title={guest.name} className="mt-1.5 line-clamp-3 break-words text-lg font-bold leading-tight">{guest.name}</span>
      <span className="mt-2 inline-flex items-center gap-1.5 text-sm text-panel-muted">
        <UsersRound aria-hidden size={15} className="shrink-0" />
        <span className="truncate">{people(guest.party)}</span>
      </span>
      <span className={`mt-1 inline-flex items-center gap-1.5 text-sm font-semibold ${waitColor(waited)}`}>
        <Clock3 aria-hidden size={15} className="shrink-0" />
        {waited} min
      </span>
    </span>
  );
}

/** Índice de naipe: número, personas y minutos en la esquina; el nombre, en vertical. */
function CompactFace({ guest, waited, position }: FaceProps) {
  return (
    <span className="flex h-full w-9 flex-col items-center gap-1 -ml-0.5">
      <span className="text-[11px] font-semibold text-panel-muted">{position}</span>
      {guest.demo && <span className="text-[9px] font-bold uppercase text-accent">Demo</span>}
      <span className="inline-flex items-center gap-0.5 text-sm font-bold">
        {guest.party}
        <UsersRound aria-hidden size={12} />
      </span>
      <span className={`text-xs font-bold ${waitColor(waited)}`}>{waited}′</span>
      <span className="mt-1 min-h-0 flex-1 overflow-hidden text-sm font-bold [writing-mode:vertical-rl]">
        <span className="line-clamp-1" title={guest.name}>{guest.name}</span>
      </span>
    </span>
  );
}
