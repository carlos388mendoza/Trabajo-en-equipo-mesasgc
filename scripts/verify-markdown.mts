// Verificación del render de Markdown del asistente (issue #59).
//
// No hay runner de tests en el repo: esto es un script que se ejecuta con
// `npm run verify:markdown` y sale con código 1 si algo falla.
//
// Renderiza el componente DE VERDAD (react-dom/server) y mira el HTML que
// sale, así que comprueba dos cosas distintas:
//
//  1. Que el Markdown de verdad se pinta: títulos, negritas, cursivas,
//     listas, tablas, código inline, bloques de código, enlaces y GFM.
//  2. Que el Markdown/HTML malicioso NO se ejecuta: ni <script>, ni
//     <iframe>, ni atributos de evento (`onerror`, `onclick`…), ni enlaces
//     `javascript:`. Tampoco durante un texto a medio llegar (streaming).
//
// No toca base de datos ni red.

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { Markdown } from "@/components/analytics/markdown";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail?: string): void {
  if (condition) {
    passed += 1;
    console.log(`  ok   ${name}`);
  } else {
    failures.push(name);
    console.log(`  FALLA ${name}${detail ? ` -> ${detail}` : ""}`);
  }
}

function section(title: string): void {
  console.log(`\n${title}`);
}

/** Pinta la respuesta como lo haría la página (sin JSX: `.mts` no lo admite). */
function pintar(texto: string): string {
  return renderToStaticMarkup(createElement(Markdown, null, texto));
}

// ---------------------------------------------------------------------------
// Qué se pinta
// ---------------------------------------------------------------------------

section("Qué se pinta (Markdown y GFM)");

{
  const html = pintar("# Título\n\n## Subtítulo\n\nTodo en **negrita**, en *cursiva* y ~~tachado~~.");
  check("títulos h1 y h2", html.includes("<h1") && html.includes("Título") && html.includes("<h2") && html.includes("Subtítulo"));
  check("negrita, cursiva y tachado", html.includes("<strong>negrita</strong>") && html.includes("<em>cursiva</em>") && html.includes("<del>tachado</del>"));
}

{
  const html = pintar("- uno\n- dos\n\n1. primero\n2. segundo\n\n- [x] hecho\n- [ ] pendiente");
  check("lista desordenada", /<ul[^>]*>/.test(html) && html.includes("<li") && html.includes("uno"));
  check("lista ordenada", /<ol[^>]*>/.test(html) && html.includes("primero"));
  check("tareas de GFM (casilla)", /type="checkbox"/.test(html));
}

{
  const html = pintar("| Día | Grupos | Espera |\n| --- | ---: | :---: |\n| Lun | 12 | 4 min |");
  check("tabla con encabezado", html.includes("<table") && html.includes("<th") && html.includes("Grupos"));
  check("tabla con celdas", html.includes("<td") && html.includes("12"));
  check("  y su propio scroll horizontal", html.includes('class="overflow-x-auto') && html.includes("<table"));
}

{
  const html = pintar("Usa `waiterCount` y luego:\n\n```ts\nconst n: number = 3;\n```\n");
  check("código inline", /<code[^>]*>[^<]*waiterCount/.test(html));
  check("bloque de código con su caja", html.includes("<pre") && html.includes("const n: number = 3;"));
}

{
  const html = pintar("Mira la [documentación](https://example.com/docs) y <https://example.com>.");
  check("enlace de Markdown", html.includes('href="https://example.com/docs"') && html.includes("documentación"));
  check("enlace automático", html.includes('href="https://example.com"'));
}

{
  const html = pintar("> esperamos\n\n---\n\ntexto");
  check("cita", html.includes("<blockquote"));
  check("regla horizontal", /<hr/.test(html));
}

check("respuesta vacía no pinta nada", pintar("   ") === "");
check("texto plano se pinta tal cual", pintar("El lunes hubo 12 grupos.").includes("El lunes hubo 12 grupos."));

// ---------------------------------------------------------------------------
// Enlaces
// ---------------------------------------------------------------------------

section("Enlaces seguros");

{
  const html = pintar("Abre la [guía](https://example.com/guia).");
  const enlace = html.slice(html.indexOf("<a "));
  check("abre en pestaña nueva", enlace.startsWith('<a href="https://example.com/guia" target="_blank"'));
  check("  sin permisos sobre la página destino", enlace.includes('rel="noopener noreferrer"'));
}

{
  const html = pintar("[daño](javascript:alert(1))");
  check("una URL javascript: no queda como enlace ejecutable", !/href="javascript:/i.test(html), html);
  check("  ni se pierde el texto del enlace", html.includes("daño"));
}

// ---------------------------------------------------------------------------
// HTML malicioso
// ---------------------------------------------------------------------------

section("HTML y Markdown maliciosos no se ejecutan");

const maliciosos: Array<[string, string]> = [
  ["script", 'El asistente dice <script>window.hackeado = true</script> y sigue.'],
  ["script con src", '<script src="https://evil.test/x.js"></script>'],
  ["img con onerror", '<img src="x" onerror="fetch(\'https://evil.test\')">'],
  ["iframe", '<iframe src="https://evil.test"></iframe>'],
  ["evento onclick", '<div onclick="alert(1)">hola</div>'],
  ["javascript en HTML", '<a href="javascript:alert(1)">entrar</a>'],
  ["estilo con url()", '<style>body{background:url("https://evil.test/pixel")}</style>'],
  ["Markdown + HTML", "**Importante** <script>document.cookie</script> fin."],
];

for (const [nombre, texto] of maliciosos) {
  const html = pintar(texto);
  check(`no sale <script> en «${nombre}»`, !/<script/i.test(html), html.slice(0, 200));
  check(`no sale <iframe> en «${nombre}»`, !/<iframe/i.test(html), html.slice(0, 200));
  check(`no sale <style> en «${nombre}»`, !/<style/i.test(html), html.slice(0, 200));
  // Solo cuenta un elemento REAL con atributo de evento: el texto escapado
  // (`&lt;img onerror=…&gt;) es letra y pinta, no código.
  check(
    `ningún elemento real lleva atributo de evento en «${nombre}»`,
    !/<[a-z][^>]*\son[a-z]+=/i.test(html),
    html.slice(0, 200),
  );
  check(`«${nombre}» se queda como texto visible`, html.includes("&lt;") || !/[<>]/.test(texto), html.slice(0, 120));
}

{
  // Lo malicioso no se ejecuta; el resto del mensaje sí se lee.
  const html = pintar('El asistente dice <script>window.hackeado = true</script> y sigue.');
  check("el mensaje se sigue leyendo (no desaparece)", html.includes("El asistente dice") && html.includes("y sigue."));
}

{
  // Y lo legítimo de HTML tampoco se convierte en nodos de verdad: sin
  // `rehype-raw` no hay forma de inyectar elementos.
  const html = pintar('<div class="x">texto</div>');
  check("un div de HTML no se convierte en elemento real", !/<div class="x"/.test(html));
}

// ---------------------------------------------------------------------------
// Texto a medio llegar (streaming)
// ---------------------------------------------------------------------------

section("Texto a medio llegar (streaming)");

// Si algún día la respuesta llega por trozos, un Markdown sin cerrar no
// puede romper la página: se pinta igual (como texto literal lo que no
// cierra) y sin lanzar excepción.
const parciales: Array<[string, string]> = [
  ["negrita sin cerrar", "**negrita a medio"],
  ["título sin cerrar", "# Título sin cerrar"],
  ["lista sin terminar", "- uno\n- d"],
  ["tabla incompleta", "| Día | Grupos |\n| --- | ---: |\n| Lun |"],
  ["código sin cerrar", "```js\nconst x = 1;"],
];

for (const [nombre, parcial] of parciales) {
  let html = "";
  let error: unknown = null;
  try {
    html = pintar(parcial);
  } catch (e) {
    error = e;
  }
  check(`no revienta con ${nombre}`, error === null && html.length > 0, error ? String(error) : "");
}

// ---------------------------------------------------------------------------

console.log("");
if (failures.length > 0) {
  console.log(`${passed} comprobaciones ok, ${failures.length} fallos:`);
  for (const failure of failures) console.log(`  - ${failure}`);
  process.exit(1);
}
console.log(`${passed} comprobaciones ok, 0 fallos.`);
console.log("Markdown verificado.");
process.exit(0);
