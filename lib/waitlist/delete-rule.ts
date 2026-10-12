// La regla «primero libera la mesa, luego elimina», en palabras.
//
// Un cliente que ocupa una mesa NO se elimina: hay que liberar la mesa a
// propósito y después eliminarlo. El servidor lo exige en cada camino (socket,
// en grupo, cola sin conexión) y las pantallas lo explican antes de intentarlo,
// con los mismos textos. Sin nada de Next ni de la base: lo importan el
// servidor, los componentes y las pruebas.

/** Al intentar eliminar a UNO que está en una mesa. */
export function seatedDeleteMessage(tableLabel: string): string {
  return `Este cliente está en la ${tableLabel}. Primero libera la mesa para poder eliminarlo.`;
}

/** Al liberar la mesa desde ese aviso. */
export function releasedNowMessage(tableLabel: string): string {
  return `${tableLabel} liberada. Ya puedes eliminar al cliente.`;
}

/** Al pedir eliminar varios y algunos están en una mesa. */
export function seatedBulkMessage(seated: number, total: number, tableLabels: readonly string[]): string {
  const who = seated === 1 ? `1 de los ${total} clientes seleccionados está` : `${seated} de los ${total} clientes seleccionados están`;
  if (seated === total) {
    return seated === 1
      ? `El cliente seleccionado está en una mesa (${tableLabels.join(", ")}). Primero libera su mesa.`
      : `Los ${total} clientes seleccionados están en una mesa (${tableLabels.join(", ")}). Primero libera sus mesas.`;
  }
  return `${who} en una mesa (${tableLabels.join(", ")}). Primero libera ${seated === 1 ? "su mesa" : "sus mesas"}.`;
}

/** Texto de ayuda bajo el botón «Eliminar» mientras el cliente tiene mesa. */
export const RELEASE_FIRST_HINT = "Libera la mesa primero";
