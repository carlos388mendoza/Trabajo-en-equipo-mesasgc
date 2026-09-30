"use client";

// Vuelve a pedir la página al servidor cada cierto tiempo (sin recargar ni
// perder el scroll). Lo usa /inicio para que los contadores de cada
// restaurante no se queden viejos.

import { useEffect } from "react";
import { useRouter } from "next/navigation";

export function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const timer = window.setInterval(() => router.refresh(), seconds * 1000);
    return () => window.clearInterval(timer);
  }, [router, seconds]);
  return null;
}
