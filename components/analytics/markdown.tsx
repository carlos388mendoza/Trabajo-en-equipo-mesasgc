"use client";

// Respuesta del asistente de analítica, pintada como Markdown.
//
//  - `react-markdown` + `remark-gfm`: títulos, negritas, cursivas, listas
//    ordenadas y desordenadas, tablas, código inline, bloques de código y
//    enlaces (más GFM: tachado, tareas…).
//  - NO se interpreta HTML crudo: no hay `rehype-raw`, así que un `<script>`
//    que aparezca en el texto se queda como texto y no se ejecuta, igual que
//    los atributos `on…=`. Los enlaces salen siempre en otra pestaña con
//    `rel="noopener noreferrer"` (react-markdown, además, vacía las URLs de
//    esquemas peligrosos como `javascript:`).
//  - Cada tabla va envuelta en su propio contenedor con scroll horizontal,
//    para que en el celular empuje solo a la tabla y no a la página.
//  - El texto a medio llegar (si algún día se transmite en streaming) también
//    se pinta: lo que no esté cerrado se queda literal en vez de romper la
//    página.
//
// `scripts/verify-markdown.mts` comprueba todo esto renderizando el
// componente de verdad y mirando el HTML que sale.

import type { CSSProperties } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** `align` de la celda de GFM (`left`, `center`…) como estilo CSS real. */
function alineacion(align: string | undefined): CSSProperties | undefined {
  return align === "left" || align === "center" || align === "right" || align === "justify"
    ? { textAlign: align }
    : undefined;
}

export function Markdown({ children }: { children: string }) {
  if (!children.trim()) return null;
  return (
    <div className="mt-2 space-y-2 text-sm leading-6">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          // Enlaces: siempre fuera de la app y sin permisos sobre la página
          // de destino. (El `href` ya viene saneado por react-markdown.)
          a: ({ href, children: label }) => (
            <a
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-accent underline underline-offset-2"
            >
              {label}
            </a>
          ),
          h1: ({ children: title }) => <h1 className="text-base font-bold">{title}</h1>,
          h2: ({ children: title }) => <h2 className="text-base font-bold">{title}</h2>,
          h3: ({ children: title }) => <h3 className="text-sm font-bold">{title}</h3>,
          h4: ({ children: title }) => <h4 className="text-sm font-bold">{title}</h4>,
          h5: ({ children: title }) => <h5 className="text-sm font-semibold">{title}</h5>,
          h6: ({ children: title }) => <h6 className="text-sm font-semibold">{title}</h6>,
          ul: ({ children: items }) => <ul className="list-disc space-y-1 pl-5 marker:text-accent">{items}</ul>,
          ol: ({ children: items }) => <ol className="list-decimal space-y-1 pl-5 marker:text-accent">{items}</ol>,
          blockquote: ({ children: quote }) => (
            <blockquote className="border-l-2 border-accent pl-3 text-panel-muted italic">{quote}</blockquote>
          ),
          hr: () => <hr className="border-app-border" />,
          table: ({ children: rows }) => (
            // Su propio scroll: la tabla se desplaza sola en el celular.
            <div className="overflow-x-auto rounded-xl ring-1 ring-app-border">
              <table className="w-full border-collapse text-left text-xs sm:text-sm">{rows}</table>
            </div>
          ),
          th: ({ children: cell, align }) => (
            <th className="whitespace-nowrap bg-app-bg px-3 py-2 font-semibold" style={alineacion(align)}>
              {cell}
            </th>
          ),
          td: ({ children: cell, align }) => (
            <td className="border-t border-app-border px-3 py-2 align-top" style={alineacion(align)}>
              {cell}
            </td>
          ),
          // El bloque de código ya trae su caja y su scroll; el `code` de
          // dentro solo hace la fuente monoespaciada (sin fondo doble).
          pre: ({ children: code }) => (
            <pre className="overflow-x-auto rounded-xl bg-app-bg p-3 font-mono text-xs leading-5 ring-1 ring-app-border">
              {code}
            </pre>
          ),
          code: ({ children: code }) => (
            <code className="rounded bg-app-border/60 px-1 py-0.5 font-mono text-[0.9em] [pre_&]:bg-transparent [pre_&]:px-0 [pre_&]:py-0">
              {code}
            </code>
          ),
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
