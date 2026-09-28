"use client";

// Mantiene las variables CSS de `<html>` al día con el tema elegido.
//
// El script de arranque del layout ya las pone antes del primer pintado. Esto
// cubre lo que ese script no puede:
//  - cambios en vivo (Ajustes, otra pestaña, el sistema pasa a modo oscuro);
//  - en desarrollo, Strict Mode remonta y deja `<html>` solo con los atributos
//    que React conoce, borrando lo que puso el script (lo explica la guía de
//    Next "Preventing flash before hydration"). `useLayoutEffect` lo repone
//    antes de pintar.

import { useLayoutEffect } from "react";

import { applyTheme, currentTheme, useResolvedTheme } from "@/lib/theme/use-theme";

export function ThemeSync() {
  // Solo como disparador: cuando cambia, se vuelve a aplicar. Lo que se aplica
  // se lee de la fuente (`currentTheme`), porque en la hidratación el hook
  // todavía trae el valor del servidor.
  const theme = useResolvedTheme();
  useLayoutEffect(() => {
    applyTheme(currentTheme());
  }, [theme]);
  return null;
}
