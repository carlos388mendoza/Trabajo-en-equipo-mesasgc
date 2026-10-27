// Registro de errores del servidor SIN datos personales ni secretos.
//
// Los errores de la base (Drizzle/libSQL) traen la consulta con sus
// parámetros («Failed query: … params: Ana Torres,0000-…»): impresos tal cual,
// el nombre o el teléfono de un cliente acabarían en los logs de Railway. Aquí
// se imprime solo el tipo de error, su código y un mensaje recortado y limpio:
//
//  - sin la parte «params: …» de las consultas;
//  - sin correos, tokens tipo JWT («eyJ…»), claves de OpenRouter («sk-or-…»)
//    ni cabeceras «Bearer …»;
//  - y como mucho 300 caracteres.
//
// La pila (stack) solo se imprime en desarrollo.

const PATTERNS: [RegExp, string][] = [
  [/params:[\s\S]*/i, "params: [omitidos]"],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[correo]"],
  [/eyJ[A-Za-z0-9_-]{10,}(\.[A-Za-z0-9_-]+){0,2}/g, "[token]"],
  [/sk-or-[A-Za-z0-9-]{10,}/g, "[clave]"],
  [/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [token]"],
  [/authToken=[^&\s]+/gi, "authToken=[token]"],
];

/** El mensaje de un error, sin datos personales ni secretos. */
export function redactMessage(message: string): string {
  let out = message;
  for (const [re, replacement] of PATTERNS) out = out.replace(re, replacement);
  return out.length > 300 ? `${out.slice(0, 300)}…` : out;
}

/** `console.error` seguro: etiqueta, tipo, código y mensaje limpio. */
export function logServerError(label: string, error: unknown): void {
  if (error instanceof Error) {
    const code = (error as { code?: unknown }).code;
    const cause = error.cause instanceof Error ? ` (causa: ${error.cause.name}: ${redactMessage(error.cause.message)})` : "";
    console.error(`${label}: ${error.name}${typeof code === "string" ? ` [${code}]` : ""}: ${redactMessage(error.message)}${cause}`);
    if (process.env.NODE_ENV !== "production" && error.stack) console.error(error.stack.split("\n").slice(1, 6).join("\n"));
    return;
  }
  console.error(`${label}: ${redactMessage(String(error))}`);
}
