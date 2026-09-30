// Preguntas por la terminal para los scripts de administración
// (`create-admin`, `reset-password`).
//
// `hidden` no muestra lo que se escribe: es para contraseñas, que así nunca
// salen en pantalla, en el historial de la terminal ni en los logs.

import { createInterface } from "node:readline";
import { Writable } from "node:stream";

export function ask(question: string, { hidden = false, trim = true }: { hidden?: boolean; trim?: boolean } = {}): Promise<string> {
  let muted = false;
  const output = new Writable({
    write(chunk, _encoding, callback) {
      if (!muted) process.stdout.write(chunk);
      callback();
    },
  });
  const rl = createInterface({ input: process.stdin, output, terminal: true });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      if (hidden) process.stdout.write("\n");
      resolve(trim ? answer.trim() : answer);
    });
    muted = hidden;
  });
}

/** Corta con un mensaje claro si no hay una terminal donde preguntar. */
export function requireTerminal(what: string): void {
  if (!process.stdin.isTTY) {
    throw new Error(`${what}: hace falta una terminal para preguntarlo (no se acepta por variables de entorno).`);
  }
}
