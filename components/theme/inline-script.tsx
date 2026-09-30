"use client";

// Un `<script>` en línea que el navegador ejecuta al leer el HTML.
//
// React avisa en desarrollo cuando renderiza una etiqueta `<script>` en el
// cliente (ahí nunca se ejecuta). La guía de Next "Preventing flash before
// hydration" lo resuelve así: en el servidor sale como `text/javascript` y se
// ejecuta; en el cliente como `text/plain` y se ignora. La diferencia de tipo
// la cubre `suppressHydrationWarning`.

export function InlineScript({ html }: { html: string }) {
  return (
    <script
      type={typeof window === "undefined" ? "text/javascript" : "text/plain"}
      suppressHydrationWarning
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
