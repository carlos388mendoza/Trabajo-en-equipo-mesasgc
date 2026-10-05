"use client";

// Formulario de agregar cliente. Ya no ocupa una columna al lado del montón:
// se abre al tocar la carta (un toque, sin arrastrar) o con el botón flotante
// «Agregar cliente». Dos pestañas:
//
// - «Uno»: los mismos campos y validaciones que antes.
// - «Varios»: filas editables (empieza con 3), o «Pegar lista» con una
//   persona por línea. Se guardan todas en una sola acción del servidor, o
//   ninguna, y se deshacen juntas.
//
// El servidor vuelve a validar todo con Zod (`addWaitlistEntrySchema` y
// `addManyWaitlistEntriesSchema`).

import { useEffect, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ClipboardList, Plus, Trash2, UserRoundPlus } from "lucide-react";

import { Overlay } from "@/components/quick-mode/overlay";
import { MAX_BATCH_ENTRIES } from "@/lib/realtime/events";
import {
  NAME_MAX,
  NOTE_MAX,
  isEmptyRow,
  parseGuestList,
  rowProblem,
  type ListLineError,
} from "@/lib/waitlist/guest-list";

export type NewGuest = { customerName: string; partySize: number; notes: string };

type AddGuestSheetProps = {
  open: boolean;
  connected: boolean;
  onClose: () => void;
  /** Devuelven el error a mostrar, o null si se guardó. */
  onSubmit: (guest: NewGuest) => Promise<string | null>;
  onSubmitMany: (guests: NewGuest[]) => Promise<string | null>;
};

const PARTY_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

const fieldClass =
  "w-full rounded-xl border bg-panel px-4 py-3 text-panel-text outline-none transition focus:border-accent focus:ring-2 focus:ring-accent/20";

export function AddGuestSheet({ open, ...props }: AddGuestSheetProps) {
  const [tab, setTab] = useState<Tab>("uno");
  // Al cerrar vuelve a «Uno»: es lo que más se usa.
  const close = () => {
    setTab("uno");
    props.onClose();
  };
  return (
    <Overlay open={open} onClose={close} labelledBy="agregar-cliente-titulo" size={tab === "varios" ? "list" : "form"}>
      {/* El panel se desmonta al cerrar: cada apertura empieza con el formulario vacío. */}
      <AddGuestContent {...props} onClose={close} tab={tab} setTab={setTab} />
    </Overlay>
  );
}

type Tab = "uno" | "varios";

function AddGuestContent({ tab, setTab, ...props }: Omit<AddGuestSheetProps, "open"> & { tab: Tab; setTab: (tab: Tab) => void }) {

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const next = tab === "uno" ? "varios" : "uno";
    setTab(next);
    document.getElementById(`pestana-${next}`)?.focus();
  }

  return (
    <div className="overflow-y-auto px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-4 sm:px-8 lg:pt-7">
      <div className="flex items-center gap-3">
        <span className="grid h-10 w-10 place-items-center rounded-2xl bg-accent/10 text-accent">
          <UserRoundPlus aria-hidden size={20} />
        </span>
        <div>
          <h2 id="agregar-cliente-titulo" className="font-bold text-panel-text">Agregar cliente</h2>
          <p className="text-sm text-panel-muted">Registro rápido, sin pasos extra</p>
        </div>
      </div>
      <div role="tablist" aria-label="Cuántos clientes" className="mt-5 grid grid-cols-2 gap-1 rounded-2xl bg-app-bg p-1">
        {(["uno", "varios"] as const).map((value) => (
          <button
            key={value}
            id={`pestana-${value}`}
            type="button"
            role="tab"
            aria-selected={tab === value}
            aria-controls={`panel-${value}`}
            tabIndex={tab === value ? 0 : -1}
            onClick={() => setTab(value)}
            onKeyDown={onTabKey}
            className={`min-h-11 rounded-xl text-sm font-semibold transition ${
              tab === value ? "bg-panel text-panel-text shadow-sm" : "text-panel-muted hover:text-panel-text"
            }`}
          >
            {value === "uno" ? "Uno" : "Varios"}
          </button>
        ))}
      </div>
      <div id={`panel-${tab}`} role="tabpanel" aria-labelledby={`pestana-${tab}`}>
        {tab === "uno" ? <SingleForm {...props} /> : <ManyForm {...props} />}
      </div>
    </div>
  );
}

function SingleForm({ connected, onClose, onSubmit }: Omit<AddGuestSheetProps, "open" | "onSubmitMany">) {
  const [name, setName] = useState("");
  const [party, setParty] = useState("2");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || saving) return;
    setSaving(true);
    setError("");
    const failure = await onSubmit({ customerName: name.trim(), partySize: Number(party), notes: note.trim() });
    setSaving(false);
    if (failure) setError(failure);
    else onClose();
  }

  return (
    <form className="mt-5 space-y-4" onSubmit={submit}>
      <label className="block text-sm font-medium text-panel-text">
        Nombre
        <input
          data-autofocus
          required
          maxLength={NAME_MAX}
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Ej. Ana García"
          autoComplete="off"
          className={`mt-1.5 border-app-border ${fieldClass}`}
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block text-sm font-medium text-panel-text">
          Personas
          <PartySelect value={party} onChange={setParty} className="mt-1.5" />
        </label>
        <label className="block text-sm font-medium text-panel-text">
          Nota (opcional)
          <input
            maxLength={NOTE_MAX}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Silla para bebé"
            autoComplete="off"
            className={`mt-1.5 border-app-border ${fieldClass}`}
          />
        </label>
      </div>
      <FormError message={error} />
      {/* Sin conexión también se puede: va a la cola y se envía al volver. */}
      <Actions onClose={onClose} disabled={saving}>
        {saving ? "Guardando…" : connected ? "Agregar a la fila" : "Agregar (sin conexión)"}
      </Actions>
    </form>
  );
}

type Row = { key: number; name: string; party: string; note: string };

let nextRowKey = 1;
function emptyRow(): Row {
  return { key: nextRowKey++, name: "", party: "2", note: "" };
}

function ManyForm({ connected, onClose, onSubmitMany }: Omit<AddGuestSheetProps, "open" | "onSubmit">) {
  const [rows, setRows] = useState<Row[]>(() => [emptyRow(), emptyRow(), emptyRow()]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteErrors, setPasteErrors] = useState<ListLineError[]>([]);
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const inputs = useRef(new Map<string, HTMLInputElement | null>());
  // Campo al que ir después de crear una fila (se enfoca cuando ya está en el DOM).
  const pendingFocus = useRef<string | null>(null);
  const pasted = useRef(false);

  useEffect(() => {
    if (!pendingFocus.current) return;
    inputs.current.get(pendingFocus.current)?.focus();
    pendingFocus.current = null;
  });

  const filled = rows.filter((row) => !isEmptyRow(row));
  const problems = new Map(rows.map((row) => [
    row.key,
    isEmptyRow(row) ? null : rowProblem({ name: row.name, party: Number(row.party), note: row.note }),
  ]));
  const invalid = filled.filter((row) => problems.get(row.key)).length;
  const tooMany = filled.length > MAX_BATCH_ENTRIES;
  const pendingPaste = pasteText.trim().length > 0;

  function update(key: number, patch: Partial<Row>) {
    setRows((items) => items.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function remove(key: number) {
    setRows((items) => {
      const rest = items.filter((row) => row.key !== key);
      return rest.length ? rest : [emptyRow()];
    });
  }

  function addRowAfter(index: number) {
    const row = emptyRow();
    setRows((items) => [...items.slice(0, index + 1), row, ...items.slice(index + 1)]);
    pendingFocus.current = `${row.key}:name`;
  }

  // Enter no envía el formulario: en el nombre pasa a la nota, y en la nota
  // (el último campo) pasa a la fila siguiente, creándola si hace falta.
  function onFieldKey(event: KeyboardEvent<HTMLInputElement>, index: number, field: "name" | "note") {
    if (event.key !== "Enter") return;
    event.preventDefault();
    const row = rows[index];
    if (field === "name") {
      inputs.current.get(`${row.key}:note`)?.focus();
    } else if (index === rows.length - 1) {
      addRowAfter(index);
    } else {
      inputs.current.get(`${rows[index + 1].key}:name`)?.focus();
    }
  }

  // Las líneas buenas pasan a filas (en lugar de las vacías); las malas se
  // quedan en el cuadro, marcadas en rojo, para corregirlas.
  function fillFromList(text: string) {
    const { rows: parsed, errors } = parseGuestList(text);
    if (parsed.length) {
      setRows((items) => [
        ...items.filter((row) => !isEmptyRow(row)),
        ...parsed.map((row) => ({ ...emptyRow(), name: row.name, party: String(row.party), note: row.note })),
      ]);
    }
    setPasteErrors(errors);
    setPasteText(errors.map((item) => item.text).join("\n"));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAttempted(true);
    if (saving || !filled.length || invalid || tooMany || pendingPaste) return;
    setSaving(true);
    setError("");
    const failure = await onSubmitMany(filled.map((row) => ({
      customerName: row.name.trim(),
      partySize: Number(row.party),
      notes: row.note.trim(),
    })));
    setSaving(false);
    if (failure) setError(failure);
    else onClose();
  }

  const blocking = invalid
    ? `Corrige ${invalid === 1 ? "la fila en rojo" : `las ${invalid} filas en rojo`}: no se guarda nada hasta entonces.`
    : tooMany
      ? `Se pueden agregar hasta ${MAX_BATCH_ENTRIES} clientes de una vez.`
      : pendingPaste
        ? "Corrige o borra las líneas en rojo de la lista pegada."
        : "";

  return (
    <form className="mt-5 space-y-3" onSubmit={submit} noValidate>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-panel-muted">Las filas vacías no se guardan.</p>
        <button
          type="button"
          aria-expanded={pasteOpen}
          onClick={() => setPasteOpen((value) => !value)}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-xl border border-app-border px-3 text-sm font-semibold text-panel-text transition hover:bg-app-border/50"
        >
          <ClipboardList aria-hidden size={17} />
          Pegar lista
        </button>
      </div>

      {pasteOpen && (
        <div className="rounded-2xl border border-app-border bg-app-bg p-3">
          <label className="block text-sm font-medium text-panel-text">
            Una persona por línea: «Nombre, personas»
            <textarea
              data-autofocus
              rows={4}
              value={pasteText}
              onPaste={() => {
                pasted.current = true;
              }}
              onChange={(event) => {
                setPasteText(event.target.value);
                if (pasteErrors.length) setPasteErrors([]);
                // Al pegar, las filas se llenan solas.
                if (pasted.current) {
                  pasted.current = false;
                  fillFromList(event.target.value);
                }
              }}
              placeholder={"Ana Torres, 4\nLuis Ríos, 2, silla para bebé"}
              aria-invalid={pasteErrors.length > 0}
              aria-describedby={pasteErrors.length ? "pegar-errores" : undefined}
              className={`mt-1.5 font-mono text-sm ${fieldClass} ${pasteErrors.length ? "border-estado-ocupada" : "border-app-border"}`}
            />
          </label>
          {pasteErrors.length > 0 && (
            <ul id="pegar-errores" className="mt-2 space-y-1 text-sm text-estado-ocupada">
              {pasteErrors.map((item) => (
                <li key={`${item.line}-${item.text}`}>
                  Línea {item.line} («{item.text.trim()}»): {item.reason}
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            disabled={!pendingPaste}
            onClick={() => fillFromList(pasteText)}
            className="mt-2 min-h-10 rounded-xl bg-accent px-3 text-sm font-semibold text-accent-text transition hover:bg-accent/85 disabled:opacity-50"
          >
            Pasar a las filas
          </button>
        </div>
      )}

      <ol className="space-y-2">
        {rows.map((row, index) => {
          const problem = problems.get(row.key);
          const showProblem = Boolean(problem) && (attempted || row.note.trim() !== "" || row.name.trim() !== "");
          return (
            <li
              key={row.key}
              className={`rounded-2xl border p-3 ${showProblem ? "border-estado-ocupada bg-estado-ocupada/5" : "border-app-border"}`}
            >
              <div className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[minmax(0,1.4fr)_7.5rem_minmax(0,1fr)_auto]">
                <input
                  ref={(element) => {
                    inputs.current.set(`${row.key}:name`, element);
                  }}
                  data-autofocus={index === 0 && !pasteOpen ? true : undefined}
                  aria-label={`Nombre de la fila ${index + 1}`}
                  aria-invalid={showProblem}
                  maxLength={NAME_MAX}
                  value={row.name}
                  onChange={(event) => update(row.key, { name: event.target.value })}
                  onKeyDown={(event) => onFieldKey(event, index, "name")}
                  placeholder={`Cliente ${index + 1}`}
                  autoComplete="off"
                  className={`col-span-2 sm:col-span-1 ${fieldClass} ${showProblem && !row.name.trim() ? "border-estado-ocupada" : "border-app-border"}`}
                />
                <PartySelect
                  value={row.party}
                  onChange={(party) => update(row.key, { party })}
                  label={`Personas de la fila ${index + 1}`}
                  className="col-start-1 row-start-2 sm:col-start-auto sm:row-start-auto"
                />
                <input
                  ref={(element) => {
                    inputs.current.set(`${row.key}:note`, element);
                  }}
                  aria-label={`Nota de la fila ${index + 1} (opcional)`}
                  maxLength={NOTE_MAX}
                  value={row.note}
                  onChange={(event) => update(row.key, { note: event.target.value })}
                  onKeyDown={(event) => onFieldKey(event, index, "note")}
                  placeholder="Nota (opcional)"
                  autoComplete="off"
                  className={`col-span-2 row-start-3 sm:col-span-1 sm:row-start-auto ${fieldClass} border-app-border`}
                />
                <button
                  type="button"
                  onClick={() => remove(row.key)}
                  aria-label={`Quitar la fila ${index + 1}`}
                  className="col-start-2 row-start-2 grid h-12 w-12 place-items-center self-center rounded-xl border border-app-border text-panel-muted transition hover:bg-estado-ocupada/10 hover:text-estado-ocupada sm:col-start-auto sm:row-start-auto"
                >
                  <Trash2 aria-hidden size={18} />
                </button>
              </div>
              {showProblem && <p className="mt-1.5 text-sm text-estado-ocupada">{problem}</p>}
            </li>
          );
        })}
      </ol>

      <button
        type="button"
        onClick={() => addRowAfter(rows.length - 1)}
        className="inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-dashed border-app-border px-4 text-sm font-semibold text-panel-text transition hover:bg-app-border/40"
      >
        <Plus aria-hidden size={17} />
        Agregar fila
      </button>

      <FormError message={error || (attempted ? blocking : "")} />
      <Actions onClose={onClose} disabled={saving || !filled.length}>
        {saving
          ? "Guardando…"
          : filled.length
            ? `Agregar ${filled.length} ${filled.length === 1 ? "cliente" : "clientes"}${connected ? "" : " (sin conexión)"}`
            : "Escribe al menos un nombre"}
      </Actions>
    </form>
  );
}

function PartySelect({ value, onChange, className = "", label }: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  label?: string;
}) {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label={label}
      className={`w-full rounded-xl border border-app-border bg-panel px-3 py-3 text-panel-text outline-none focus:border-accent ${className}`}
    >
      {PARTY_OPTIONS.map((count) => (
        <option key={count} value={count}>{count} {count === 1 ? "persona" : "personas"}</option>
      ))}
    </select>
  );
}

function FormError({ message }: { message: string }) {
  if (!message) return null;
  return (
    <p role="alert" className="rounded-xl border border-estado-ocupada/40 px-4 py-3 text-sm text-panel-text">
      {message}
    </p>
  );
}

function Actions({ onClose, disabled, children }: { onClose: () => void; disabled: boolean; children: string }) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-3 pt-1">
      <button
        type="button"
        onClick={onClose}
        className="rounded-xl border border-app-border px-5 py-3.5 font-semibold text-panel-muted transition hover:bg-app-border/50 hover:text-panel-text"
      >
        Cancelar
      </button>
      <button
        type="submit"
        disabled={disabled}
        className="rounded-xl bg-accent px-4 py-3.5 font-semibold text-accent-text transition hover:bg-accent/85 disabled:opacity-60"
      >
        <span className="inline-flex items-center justify-center gap-2">
          <Plus aria-hidden size={18} />
          {children}
        </span>
      </button>
    </div>
  );
}
