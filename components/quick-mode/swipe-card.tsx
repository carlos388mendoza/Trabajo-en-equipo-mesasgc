"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useDragControls,
  useMotionValue,
  useTransform,
} from "motion/react";
import { Clock3, UsersRound } from "lucide-react";

export type SwipeGuest = {
  id: string;
  name: string;
  party: number;
  arrived: number;
  note: string;
};

export type SwipeDecision = "listo" | "ausente";

/** Dónde se tocó la carta sin arrastrarla: el centro agrega un cliente, una esquina abre el abanico. */
export type CardTapZone = "centro" | "esquina";

/**
 * Un toque es un toque si el dedo (o el ratón o el lápiz) se movió menos de
 * esto y se levantó pronto. Más, y es un arrastre: deslizar nunca abre nada.
 */
const TAP_MAX_MOVE = 10;
const TAP_MAX_MS = 600;
/** Zona de cada esquina, en px: la que pide el dedo en una tablet. */
export const CORNER_SIZE = 48;

export type SwipeCardHandle = {
  swipe: (decision: SwipeDecision) => Promise<void>;
};

type SwipeCardProps = {
  guest: SwipeGuest;
  depth: number;
  isTop: boolean;
  now: number;
  enterFrom?: number;
  onResolve: (entryId: string, decision: SwipeDecision, direction: number) => Promise<boolean>;
  /** Solo la de arriba: un toque sin arrastrar. */
  onTap?: (zone: CardTapZone) => void;
};

const SwipeCard = forwardRef<SwipeCardHandle, SwipeCardProps>(function SwipeCard(
  { guest, depth, isTop, now, enterFrom = 0, onResolve, onTap },
  ref,
) {
  const x = useMotionValue(enterFrom * 280);
  const opacity = useMotionValue(enterFrom ? 0.35 : 1);
  const swipeBusy = useRef(false);
  const tapStart = useRef<{ x: number; y: number; at: number; pointerId: number } | null>(null);
  const dragControls = useDragControls();
  const rotate = useTransform(x, [-360, 360], [-15, 15]);
  const readyOpacity = useTransform(x, [0, 120], [0, 1]);
  const absentOpacity = useTransform(x, [-120, 0], [1, 0]);
  const waitingMinutes = Math.max(0, Math.floor((now - guest.arrived) / 60_000));
  const waitingColor = waitingMinutes < 10
    ? "text-estado-libre"
    : waitingMinutes <= 20
      ? "text-estado-reservada"
      : "text-estado-ocupada";

  useEffect(() => {
    if (!enterFrom) return;
    x.set(enterFrom * 280);
    opacity.set(0.35);
    const xAnimation = animate(x, 0, { type: "spring", stiffness: 360, damping: 25, bounce: 0.35 });
    const opacityAnimation = animate(opacity, 1, { type: "spring", stiffness: 360, damping: 25 });
    return () => {
      xAnimation.stop();
      opacityAnimation.stop();
    };
  }, [enterFrom, opacity, x]);

  const swipe = useCallback(async (decision: SwipeDecision) => {
    if (!isTop || swipeBusy.current) return;
    swipeBusy.current = true;
    const direction = decision === "listo" ? 1 : -1;
    await Promise.all([
      animate(x, direction * Math.max(900, window.innerWidth), { type: "tween", duration: 0.24, ease: "easeOut" }),
      animate(opacity, 0, { duration: 0.2 }),
    ]);
    const resolved = await onResolve(guest.id, decision, direction);
    if (!resolved) {
      await Promise.all([
        animate(x, 0, { type: "spring", stiffness: 420, damping: 23, bounce: 0.45 }),
        animate(opacity, 1, { type: "spring", stiffness: 420, damping: 23 }),
      ]);
      swipeBusy.current = false;
    }
  }, [guest.id, isTop, onResolve, opacity, x]);

  useImperativeHandle(ref, () => ({ swipe }), [swipe]);

  return (
    <motion.article
      layout
      drag={isTop ? "x" : false}
      dragControls={dragControls}
      dragListener={false}
      dragConstraints={{ left: -520, right: 520 }}
      dragElastic={0.82}
      dragMomentum={false}
      onPointerDown={(event) => {
        if (isTop && event.isPrimary && event.button === 0) {
          tapStart.current = { x: event.clientX, y: event.clientY, at: Date.now(), pointerId: event.pointerId };
          dragControls.start(event);
        }
      }}
      onPointerUp={(event) => {
        const start = tapStart.current;
        tapStart.current = null;
        if (!start || start.pointerId !== event.pointerId || !isTop || !onTap || swipeBusy.current) return;
        const moved = Math.hypot(event.clientX - start.x, event.clientY - start.y);
        if (moved > TAP_MAX_MOVE || Date.now() - start.at > TAP_MAX_MS) return;
        const rect = event.currentTarget.getBoundingClientRect();
        const px = event.clientX - rect.left;
        const py = event.clientY - rect.top;
        const nearX = px < CORNER_SIZE || px > rect.width - CORNER_SIZE;
        const nearY = py < CORNER_SIZE || py > rect.height - CORNER_SIZE;
        onTap(nearX && nearY ? "esquina" : "centro");
      }}
      // El navegador se quedó el gesto (desplazar la página): no es un toque.
      onPointerCancel={() => {
        tapStart.current = null;
      }}
      onDragEnd={(_, info) => {
        if (Math.abs(info.offset.x) >= 120) {
          void swipe(info.offset.x > 0 ? "listo" : "ausente");
        } else {
          void Promise.all([
            animate(x, 0, { type: "spring", stiffness: 420, damping: 23, bounce: 0.45 }),
            animate(opacity, 1, { type: "spring", stiffness: 420, damping: 23 }),
          ]);
        }
      }}
      initial={{
        opacity: 1 - depth * 0.16,
        scale: 1 - depth * 0.055,
        y: depth * 18,
      }}
      animate={{ y: depth * 18, scale: 1 - depth * 0.055 }}
      variants={{
        exit: (directions: Record<string, number>) => {
          const direction = directions[guest.id] ?? 1;
          return { x: direction * 950, opacity: 0, rotate: direction * 18, transition: { type: "tween", duration: 0.24 } };
        },
      }}
      exit="exit"
      transition={{ layout: { type: "spring", stiffness: 420, damping: 32 }, y: { type: "spring", stiffness: 420, damping: 32 }, scale: { type: "spring", stiffness: 420, damping: 32 } }}
      style={{ x, rotate, opacity, zIndex: 10 - depth, touchAction: isTop ? "pan-y" : "auto" }}
      className={`absolute inset-x-0 top-0 mx-auto flex h-[360px] w-full max-w-[560px] select-none flex-col overflow-hidden rounded-[2rem] border border-app-border bg-panel p-7 text-panel-text shadow-xl movil-horizontal:!h-[252px] movil-horizontal:!p-4 sm:h-[400px] sm:p-9 ${isTop ? "cursor-grab active:cursor-grabbing" : "pointer-events-none"}`}
      aria-label={`${guest.name}, ${waitingMinutes} ${waitingMinutes === 1 ? "minuto" : "minutos"} esperando`}
    >
      {isTop && <CornerMarks />}
      <AnimatePresence>
        {isTop && (
          <>
            <motion.span
              style={{ opacity: readyOpacity }}
              className="pointer-events-none absolute right-5 top-5 rotate-[-12deg] rounded-xl border-4 border-estado-libre px-3 py-1 text-xl font-black tracking-widest text-estado-libre"
            >
              LISTO
            </motion.span>
            <motion.span
              style={{ opacity: absentOpacity }}
              className="pointer-events-none absolute left-5 top-5 rotate-[-12deg] rounded-xl border-4 border-estado-ocupada px-3 py-1 text-xl font-black tracking-widest text-estado-ocupada"
            >
              AUSENTE
            </motion.span>
          </>
        )}
      </AnimatePresence>
      <div className="mt-auto">
        {/* El nombre es lo primero que hay que ver: dos líneas como mucho y el
            texto completo en el `title`, para que «los clientes de la mesa 4»
            se lean enteros y no se recorten a medias. */}
        <h2
          title={guest.name}
          className="break-words text-3xl font-bold leading-tight tracking-tight line-clamp-2 movil-horizontal:!text-2xl sm:text-4xl"
        >
          {guest.name}
        </h2>
        <p className="mt-5 inline-flex items-center gap-2 text-panel-muted movil-horizontal:mt-2">
          <UsersRound aria-hidden size={19} />
          <span>{guest.party} {guest.party === 1 ? "persona" : "personas"}</span>
        </p>
        {guest.note && (
          <p className="mt-3 line-clamp-2 rounded-xl bg-app-bg px-3 py-2 text-sm text-panel-muted">
            {guest.note}
          </p>
        )}
        <p className={`mt-5 inline-flex items-center gap-2 text-sm font-semibold ${waitingColor} movil-horizontal:mt-2`}>
          <Clock3 aria-hidden size={17} />
          {waitingMinutes} {waitingMinutes === 1 ? "minuto" : "minutos"} esperando
        </p>
      </div>
    </motion.article>
  );
});

/**
 * Indicador de que las esquinas se pueden tocar: un doblez de naipe en cada
 * una. Solo decora; la zona de toque es de `CORNER_SIZE` px.
 */
function CornerMarks() {
  const corners = [
    "left-0 top-0 rounded-br-2xl",
    "right-0 top-0 rounded-bl-2xl",
    "bottom-0 left-0 rounded-tr-2xl",
    "bottom-0 right-0 rounded-tl-2xl",
  ];
  return (
    <>
      {corners.map((place) => (
        <span
          key={place}
          aria-hidden
          className={`pointer-events-none absolute grid h-7 w-7 place-items-center bg-app-border/70 ${place}`}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-panel-muted/70" />
        </span>
      ))}
    </>
  );
}

export { SwipeCard };
