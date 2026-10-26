"use client";

import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { ChevronDown, Check } from "lucide-react";

const PARTY_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

export function PartySelect({
  value,
  onChange,
  className = "",
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [openUp, setOpenUp] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const selected = Number(value);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    const onClick = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node)) setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onClick);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  // (La decisión de abrir hacia arriba se toma en el manejador del clic, para
  // no llamar a setState dentro de un efecto.)

  // (La sincronización del índice activo se hace al abrir, en los manejadores.)

  // Mantiene visible el elemento activo mientras se navega con el teclado.
  useEffect(() => {
    if (!open || !listRef.current) return;
    const item = listRef.current.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`);
    item?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function choose(index: number) {
    const count = PARTY_OPTIONS[index];
    if (count === undefined) return;
    onChange(String(count));
    setOpen(false);
    buttonRef.current?.focus();
  }

  function onKeyDown(event: ReactKeyboardEvent<HTMLButtonElement>) {
    if (!open) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (root.current) {
          const rect = root.current.getBoundingClientRect();
          const spaceBelow = window.innerHeight - rect.bottom;
          const spaceAbove = rect.top;
          const estimatedHeight = PARTY_OPTIONS.length * 44 + 12;
          setOpenUp(spaceBelow < estimatedHeight && spaceAbove > spaceBelow);
        }
        const index = PARTY_OPTIONS.indexOf(selected);
        setActiveIndex(index >= 0 ? index : 0);
        setOpen(true);
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
      default:
        break;
    }
  }

  const activeId = open ? `party-option-${PARTY_OPTIONS[activeIndex]}` : undefined;

  return (
    <div ref={root} className={`relative ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? "party-listbox" : undefined}
        aria-activedescendant={activeId}
        role="combobox"
        aria-label={label || "Número de personas"}
        onClick={() => {
          if (!open && root.current) {
            const rect = root.current.getBoundingClientRect();
            const spaceBelow = window.innerHeight - rect.bottom;
            const spaceAbove = rect.top;
            const estimatedHeight = PARTY_OPTIONS.length * 44 + 12;
            setOpenUp(spaceBelow < estimatedHeight && spaceAbove > spaceBelow);
          }
          const index = PARTY_OPTIONS.indexOf(selected);
          setActiveIndex(index >= 0 ? index : 0);
          setOpen((value) => !value);
        }}
        onKeyDown={onKeyDown}
        className="flex h-11 min-h-[44px] w-full items-center justify-between gap-2 rounded-xl border border-app-border bg-panel px-4 text-panel-text outline-none transition hover:bg-app-border/40 focus:border-accent focus:ring-2 focus:ring-accent/20"
      >
        <span className="truncate">
          {selected} {selected === 1 ? "persona" : "personas"}
        </span>
        <ChevronDown aria-hidden size={16} className={`shrink-0 transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? (
        <div
          ref={listRef}
          id="party-listbox"
          role="listbox"
          aria-label="Número de personas"
          className={`absolute left-0 z-50 w-full rounded-2xl border border-app-border bg-panel p-1.5 text-panel-text shadow-xl ${
            openUp ? "bottom-full mb-2" : "top-full mt-2"
          }`}
        >
          {PARTY_OPTIONS.map((count, index) => {
            const active = count === selected;
            const focused = index === activeIndex;
            return (
              <button
                key={count}
                id={`party-option-${count}`}
                type="button"
                role="option"
                aria-selected={active}
                data-index={index}
                tabIndex={-1}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(index)}
                className={`flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl px-3 text-sm transition hover:bg-app-border/60 ${
                  focused ? "bg-app-border/60" : ""
                } ${active ? "font-semibold text-accent" : ""}`}
              >
                <span>
                  {count} {count === 1 ? "persona" : "personas"}
                </span>
                {active ? <Check aria-hidden size={16} className="text-accent" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
