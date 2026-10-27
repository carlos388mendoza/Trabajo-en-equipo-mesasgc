"use client";

// «Personas» del formulario de agregar cliente (issue #86): un select propio,
// con el aspecto de la app, que se usa igual con el dedo y con el teclado.
//
// La lista NO se dibuja dentro del panel «Agregar cliente»: el panel tiene su
// propio scroll y la cortaba (en la tablet acostada no se veían las primeras
// opciones). Se dibuja en la capa fija del propio panel, por encima de todo,
// con la posición calculada contra la pantalla: se abre hacia abajo si cabe y
// hacia arriba si no, y si ni así cabe entera, con su propio scroll.
//
// Teclado (patrón «select-only combobox» de ARIA): con el botón enfocado,
// ↓/↑/Enter/Espacio la abren; con la lista abierta, ↓/↑/Inicio/Fin mueven la
// opción activa (`aria-activedescendant`), Enter o Espacio la eligen, Esc
// cierra SOLO la lista (no el panel) y Tab la cierra y sigue al campo de al
// lado. Los ids salen de `useId`, así en «Varios» (varias filas) no se repiten.

import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown } from "lucide-react";

const PARTY_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
/** Alto de cada opción (px): el mínimo para tocarla con el dedo. */
const OPTION_HEIGHT = 44;
const LIST_PADDING = 12;
const GAP = 6;

const label = (count: number) => `${count} ${count === 1 ? "persona" : "personas"}`;

export function PartySelect({
  value,
  onChange,
  className = "",
  label: ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  label?: string;
}) {
  const id = useId();
  const listId = `${id}-lista`;
  const optionId = (index: number) => `${id}-opcion-${index}`;
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [position, setPosition] = useState<CSSProperties | null>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = Number(value);
  const selectedIndex = Math.max(0, PARTY_OPTIONS.indexOf(selected));

  // Dónde va la lista: debajo del botón si cabe, si no encima; nunca más alta
  // que el hueco (entonces con scroll).
  const place = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const r = button.getBoundingClientRect();
    const wanted = PARTY_OPTIONS.length * OPTION_HEIGHT + LIST_PADDING;
    const below = window.innerHeight - r.bottom - GAP * 2;
    const above = r.top - GAP * 2;
    const up = below < Math.min(wanted, OPTION_HEIGHT * 5) && above > below;
    const room = Math.max(OPTION_HEIGHT * 2 + LIST_PADDING, up ? above : below);
    // Al menos 150 px de ancho («10 personas» en una línea) y sin salirse de la pantalla.
    const width = Math.max(r.width, 150);
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setPosition({
      position: "fixed",
      left,
      width,
      maxHeight: Math.min(wanted, room),
      ...(up ? { bottom: window.innerHeight - r.top + GAP } : { top: r.bottom + GAP }),
    });
  }, []);

  const openList = () => {
    // La capa fija del panel (sin transformaciones ni scroll), o la página.
    const panel = buttonRef.current?.closest<HTMLElement>("[data-overlay-panel]");
    setHost(panel?.parentElement ?? document.body);
    setActiveIndex(selectedIndex);
    place();
    setOpen(true);
  };
  const close = () => setOpen(false);

  function choose(index: number) {
    const count = PARTY_OPTIONS[index];
    if (count === undefined) return;
    onChange(String(count));
    close();
    buttonRef.current?.focus();
  }

  // Con la lista abierta: tocar fuera la cierra; mover el panel (scroll) o
  // girar la tablet también, para que no quede flotando en otro sitio; Esc la
  // cierra a ella sola (el panel lo respeta, ver `overlay.tsx`).
  useEffect(() => {
    if (!open) return;
    const inside = (target: EventTarget | null) =>
      target instanceof Node && (buttonRef.current?.contains(target) || listRef.current?.contains(target));
    const onPointerDown = (event: PointerEvent) => {
      if (!inside(event.target)) close();
    };
    const onScroll = (event: Event) => {
      if (!inside(event.target)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", place);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", place);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, place]);

  // La opción activa siempre a la vista (cuando la lista tiene scroll).
  useEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function onKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
        event.preventDefault();
        openList();
      }
      return;
    }
    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        setActiveIndex((index) => Math.min(PARTY_OPTIONS.length - 1, index + 1));
        break;
      case "ArrowUp":
        event.preventDefault();
        setActiveIndex((index) => Math.max(0, index - 1));
        break;
      case "Home":
        event.preventDefault();
        setActiveIndex(0);
        break;
      case "End":
        event.preventDefault();
        setActiveIndex(PARTY_OPTIONS.length - 1);
        break;
      case "Enter":
      case " ":
        event.preventDefault();
        choose(activeIndex);
        break;
      case "Tab":
        // Sin `preventDefault`: el foco sigue al campo siguiente.
        close();
        break;
      default:
        break;
    }
  }

  return (
    <div className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open ? optionId(activeIndex) : undefined}
        aria-label={ariaLabel || "Número de personas"}
        onClick={() => (open ? close() : openList())}
        onKeyDown={onKeyDown}
        className="flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border border-app-border bg-panel px-4 text-panel-text outline-none transition hover:bg-app-border/40 focus:border-accent focus:ring-2 focus:ring-accent/20"
      >
        <span className="truncate">{label(selected)}</span>
        <ChevronDown aria-hidden size={16} className={`shrink-0 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open && host && position
        ? createPortal(
            <div
              ref={listRef}
              id={listId}
              role="listbox"
              aria-label={ariaLabel || "Número de personas"}
              style={position}
              className="z-[60] overflow-y-auto overscroll-contain rounded-2xl border border-app-border bg-panel p-1.5 text-panel-text shadow-xl"
            >
              {PARTY_OPTIONS.map((count, index) => {
                const isSelected = count === selected;
                const isActive = index === activeIndex;
                return (
                  <div
                    key={count}
                    id={optionId(index)}
                    role="option"
                    aria-selected={isSelected}
                    data-index={index}
                    // El foco se queda en el botón (lo exige `aria-activedescendant`).
                    onPointerDown={(event) => event.preventDefault()}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(index)}
                    className={`flex min-h-11 cursor-pointer items-center justify-between gap-2 rounded-xl px-3 text-sm transition ${
                      isActive ? "bg-app-border/60" : "hover:bg-app-border/40"
                    } ${isSelected ? "font-semibold text-accent" : ""}`}
                  >
                    <span>{label(count)}</span>
                    {isSelected ? <Check aria-hidden size={16} className="text-accent" /> : null}
                  </div>
                );
              })}
            </div>,
            host,
          )
        : null}
    </div>
  );
}
