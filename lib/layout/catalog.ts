// Catálogo de tipos de elemento del editor (`element_types`).
//
// Vive aquí y no en el seed porque también lo necesita producción: el seed no
// se corre allí, y sin estas filas el editor no tiene nada que poner en su
// paleta. Lo cargan `npm run db:seed` (desarrollo) y `npm run db:catalog`, que
// va en el Pre-deploy de Railway detrás de `db:migrate`.
//
// Solo toca `element_types`, y por clave: repetirlo no duplica nada, y las
// mesas que ya apuntan a un tipo siguen apuntando al mismo id.

import { db } from "@/lib/db";
import type { ElementTypeKey } from "@/lib/db/enums";
import { elementTypes } from "@/lib/db/schema";

/**
 * Colores pensados para que los cinco se distinguan de un vistazo en el mapa
 * y, sobre todo, para que "ocupada" se distinga del color del tipo (el editor
 * pinta la mesa ocupada con un borde rojo, no cambiando el relleno).
 */
export const ELEMENT_TYPE_CATALOG: {
  key: ElementTypeKey;
  label: string;
  color: string;
  icon: string;
  width: number;
  height: number;
  defaultCapacity: number | null;
}[] = [
  {
    key: "mesa-sillas",
    label: "Mesa con sillas",
    color: "#3b82f6",
    icon: "utensils",
    width: 80,
    height: 80,
    defaultCapacity: 4,
  },
  {
    key: "mesa-butacas",
    label: "Mesa con butacas",
    color: "#8b5cf6",
    icon: "sofa",
    width: 130,
    height: 70,
    defaultCapacity: 6,
  },
  {
    key: "area-juegos",
    label: "Área de juegos",
    color: "#f59e0b",
    icon: "puzzle",
    width: 220,
    height: 220,
    defaultCapacity: null,
  },
  {
    key: "bano",
    label: "Baño",
    color: "#6b7280",
    icon: "toilet",
    width: 60,
    height: 60,
    defaultCapacity: null,
  },
  {
    key: "caja",
    label: "Caja",
    color: "#10b981",
    icon: "banknote",
    width: 70,
    height: 70,
    defaultCapacity: null,
  },
  // Estructura del local (paso 4 de los requisitos: "distintos tipos de
  // elementos"). Ninguno admite clientes. La pared es fina y larga, y la
  // puerta es cuadrada porque dibuja su arco de apertura dentro.
  {
    key: "barra",
    label: "Barra",
    color: "#d97706",
    icon: "wine",
    width: 220,
    height: 56,
    defaultCapacity: null,
  },
  {
    key: "puerta",
    label: "Puerta",
    color: "#0d9488",
    icon: "door-open",
    width: 80,
    height: 80,
    defaultCapacity: null,
  },
  {
    key: "pared",
    label: "Pared",
    color: "#64748b",
    icon: "brick-wall",
    width: 240,
    height: 18,
    defaultCapacity: null,
  },
];

/** Crea o actualiza los tipos del catálogo. Devuelve cuántos hay en el catálogo. */
export async function upsertElementTypeCatalog(): Promise<number> {
  for (const [sortOrder, type] of ELEMENT_TYPE_CATALOG.entries()) {
    await db
      .insert(elementTypes)
      .values({ id: `el_${type.key}`, sortOrder, ...type })
      .onConflictDoUpdate({
        // La clave es la identidad lógica del tipo: si alguien la cambió, se
        // actualiza la fila en vez de crear un duplicado.
        target: elementTypes.key,
        set: {
          label: type.label,
          color: type.color,
          icon: type.icon,
          width: type.width,
          height: type.height,
          defaultCapacity: type.defaultCapacity,
          sortOrder,
        },
      });
  }
  return ELEMENT_TYPE_CATALOG.length;
}
