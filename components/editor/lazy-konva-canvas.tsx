"use client";

// El ÚNICO punto donde se decide cómo se carga Konva.
//
// Konva usa `document` y el contexto 2D del canvas en el momento de
// importarse, así que importarlo en el servidor peta. Next 15+ además prohíbe
// `ssr: false` dentro de un Server Component; por eso el `dynamic` vive aquí,
// en un Client Component. Lo usan el editor y el plano en vivo del mapa
// (`components/map/live-plan.tsx`), que es el mismo lienzo en solo lectura.

import dynamic from "next/dynamic";

export const KonvaCanvas = dynamic(
  () => import("./konva-canvas").then((mod) => mod.KonvaCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full w-full items-center justify-center bg-app-bg text-sm text-app-muted">
        Cargando mapa…
      </div>
    ),
  },
);
