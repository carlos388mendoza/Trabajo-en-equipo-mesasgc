// «Agregar varios» del modo rápido: validar las filas del formulario y leer
// una lista pegada («Ana Torres, 4», una persona por línea). Sin nada de Next
// ni de la base, para usarlo en el navegador y probarlo desde los `verify`.
// El servidor vuelve a validar todo con Zod (`addManyWaitlistEntriesSchema`).

export const NAME_MAX = 100;
export const NOTE_MAX = 500;
export const PARTY_MIN = 1;
export const PARTY_MAX = 10;

export type GuestRow = { name: string; party: number; note: string };

/** Fila vacía (sin nombre ni nota): se ignora al guardar. */
export function isEmptyRow(row: Pick<GuestRow, "name" | "note">): boolean {
  return !row.name.trim() && !row.note.trim();
}

/** Qué le falta a una fila con algo escrito, o null si está bien. */
export function rowProblem(row: GuestRow): string | null {
  const name = row.name.trim();
  if (!name) return "Falta el nombre.";
  if (name.length > NAME_MAX) return `El nombre pasa de ${NAME_MAX} letras.`;
  if (!Number.isInteger(row.party) || row.party < PARTY_MIN || row.party > PARTY_MAX) {
    return `Las personas van de ${PARTY_MIN} a ${PARTY_MAX}.`;
  }
  if (row.note.trim().length > NOTE_MAX) return `La nota pasa de ${NOTE_MAX} letras.`;
  return null;
}

export type ListLineError = { line: number; text: string; reason: string };

/**
 * Lee una lista pegada: «Nombre, personas» y, si se quiere, «, nota». Vale
 * coma, punto y coma o tabulador (lo que sale al copiar de Excel). Las líneas
 * vacías se saltan; las que no se entienden vuelven en `errors` con su
 * número de línea, para marcarlas en rojo.
 */
export function parseGuestList(text: string): { rows: GuestRow[]; errors: ListLineError[] } {
  const rows: GuestRow[] = [];
  const errors: ListLineError[] = [];
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const match = /^(.+?)\s*[,;\t]\s*(\d+)\s*(?:[,;\t]\s*(.*))?$/.exec(line);
    if (!match) {
      errors.push({ line: index + 1, text: raw, reason: "Usa «Nombre, personas», por ejemplo «Ana Torres, 4»." });
      return;
    }
    const row = { name: match[1].trim(), party: Number(match[2]), note: (match[3] ?? "").trim() };
    const problem = rowProblem(row);
    if (problem) errors.push({ line: index + 1, text: raw, reason: problem });
    else rows.push(row);
  });
  return { rows, errors };
}
