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
};

const SwipeCard = forwardRef<SwipeCardHandle, SwipeCardProps>(function SwipeCard(
  { guest, depth, isTop, now, enterFrom = 0, onResolve },
  ref,
) {
  const x = useMotionValue(enterFrom * 280);
  const opacity = useMotionValue(enterFrom ? 0.35 : 1);
  const swipeBusy = useRef(false);
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
          dragControls.start(event);
        }
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
      className={`absolute inset-x-0 top-0 mx-auto flex h-[330px] w-full max-w-[430px] select-none flex-col overflow-hidden rounded-[2rem] border border-app-border bg-panel p-6 text-panel-text shadow-xl sm:h-[350px] sm:p-8 ${isTop ? "cursor-grab active:cursor-grabbing" : "pointer-events-none"}`}
      aria-label={`${guest.name}, ${waitingMinutes} ${waitingMinutes === 1 ? "minuto" : "minutos"} esperando`}
    >
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
        <h2 className="break-words text-3xl font-bold tracking-tight sm:text-4xl">{guest.name}</h2>
        <p className="mt-5 inline-flex items-center gap-2 text-panel-muted">
          <UsersRound aria-hidden size={19} />
          <span>{guest.party} {guest.party === 1 ? "persona" : "personas"}</span>
        </p>
        {guest.note && (
          <p className="mt-3 line-clamp-2 rounded-xl bg-app-bg px-3 py-2 text-sm text-panel-muted">
            {guest.note}
          </p>
        )}
        <p className={`mt-5 inline-flex items-center gap-2 text-sm font-semibold ${waitingColor}`}>
          <Clock3 aria-hidden size={17} />
          {waitingMinutes} {waitingMinutes === 1 ? "minuto" : "minutos"} esperando
        </p>
      </div>
    </motion.article>
  );
});

export { SwipeCard };
