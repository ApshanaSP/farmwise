"use client";

/**
 * Type-ahead picker for long reference lists.
 *
 * A plain <select> is unusable at this scale — 250 areas, and thousands of
 * streets behind some localities. This opens on nothing, filters as you type,
 * and only offers what matches, the way an address search does.
 *
 * Short lists (<= `showAllUpTo`, default 20) still open in full on focus,
 * because making someone type to discover 11 localities would be worse than
 * showing them.
 *
 * Keyboard: Up/Down to move, Enter to choose, Escape to close, Backspace on an
 * empty box to clear the current choice. Implements the ARIA combobox pattern
 * so screen readers announce the active option.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  KeyboardEvent
} from "react";
import { Check, ChevronDown, Loader2, Search, X } from "lucide-react";

export interface ComboboxOption {
  value: string;
  label: string;
  /** Optional second line, e.g. the parent area of a locality. */
  hint?: string;
}

interface ComboboxProps {
  id: string;
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabledPlaceholder?: string;
  disabled?: boolean;
  loading?: boolean;
  /** Noun for the counts and prompts, e.g. "area", "street". */
  noun?: string;
  /** Open the full list on focus when there are at most this many options. */
  showAllUpTo?: number;
  /** Rendered under the input when nothing matches. */
  emptyAction?: React.ReactNode;
  required?: boolean;
}

const MAX_RENDERED = 60;

/** Case- and punctuation-insensitive, so "st thomas" matches "ST. THOMAS". */
function normalise(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/** Highlights the matched run, like a search result. */
function Highlighted({ text, query }: { text: string; query: string }) {
  const q = normalise(query);
  if (!q) return <>{text}</>;
  const idx = normalise(text).indexOf(q);
  if (idx < 0) return <>{text}</>;
  // normalise() can change length, so re-find on the raw text when possible.
  const raw = text.toLowerCase().indexOf(query.toLowerCase().trim());
  if (raw < 0) return <>{text}</>;
  const end = raw + query.trim().length;
  return (
    <>
      {text.slice(0, raw)}
      <mark className="rounded bg-gold-100 px-0.5 text-ink">{text.slice(raw, end)}</mark>
      {text.slice(end)}
    </>
  );
}

export default function Combobox({
  id,
  options,
  value,
  onChange,
  placeholder,
  disabledPlaceholder,
  disabled,
  loading,
  noun = "option",
  showAllUpTo = 20,
  emptyAction,
  required
}: ComboboxProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const wrapRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);
  const listboxId = `${useId()}-listbox`;

  const selected = useMemo(
    () => options.find((o) => o.value === value) ?? null,
    [options, value]
  );

  // A short list is browsable; a long one must be searched.
  const browsable = options.length <= showAllUpTo;

  const matches = useMemo(() => {
    const q = normalise(query);
    if (!q) return browsable ? options : [];
    // Prefix matches first — typing "ady" should surface ADYAR above
    // "DHANALAKSHMI AVENUE, ADYAR".
    const starts: ComboboxOption[] = [];
    const contains: ComboboxOption[] = [];
    for (const o of options) {
      const n = normalise(o.label);
      if (n.startsWith(q)) starts.push(o);
      else if (n.includes(q)) contains.push(o);
    }
    return [...starts, ...contains];
  }, [options, query, browsable]);

  const shown = matches.slice(0, MAX_RENDERED);

  // Close when focus or a click leaves the widget.
  useEffect(() => {
    if (!open) return;
    function onDocDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
        setQuery("");
      }
    }
    document.addEventListener("mousedown", onDocDown);
    return () => document.removeEventListener("mousedown", onDocDown);
  }, [open]);

  // Keep the highlighted row in view while arrowing through a long list.
  useEffect(() => {
    if (!open || activeIndex < 0 || !listRef.current) return;
    const el = listRef.current.children[activeIndex] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  const choose = useCallback(
    (opt: ComboboxOption) => {
      onChange(opt.value);
      setQuery("");
      setOpen(false);
      setActiveIndex(-1);
      inputRef.current?.blur();
    },
    [onChange]
  );

  function clear() {
    onChange("");
    setQuery("");
    setActiveIndex(-1);
    inputRef.current?.focus();
    setOpen(true);
  }

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        return;
      }
      if (shown.length === 0) return;
      setActiveIndex((i) => {
        const next = e.key === "ArrowDown" ? i + 1 : i - 1;
        if (next < 0) return shown.length - 1;
        if (next >= shown.length) return 0;
        return next;
      });
      return;
    }
    if (e.key === "Enter") {
      if (open && activeIndex >= 0 && shown[activeIndex]) {
        // Only swallow Enter when it is actually picking something, so it can
        // still submit the form otherwise.
        e.preventDefault();
        choose(shown[activeIndex]);
      }
      return;
    }
    if (e.key === "Escape") {
      setOpen(false);
      setQuery("");
      setActiveIndex(-1);
      return;
    }
    if (e.key === "Backspace" && query === "" && selected) {
      clear();
    }
  }

  const placeholderText = disabled
    ? disabledPlaceholder || "Not available yet"
    : selected
    ? selected.label
    : browsable
    ? placeholder || `Select ${noun}`
    : `Type to search ${options.length.toLocaleString("en-IN")} ${noun}s`;

  const showList = open && !disabled && !loading;
  const promptToType = showList && !browsable && normalise(query) === "";

  return (
    <div
      ref={wrapRef}
      className="relative"
      onBlur={(e) => {
        // Tabbing to another field leaves the mousedown handler unused, so
        // close here too — otherwise two lists can sit open at once.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          setOpen(false);
          setQuery("");
          setActiveIndex(-1);
        }
      }}
    >
      <div className="group relative">
        <span className="input-affix group-focus-within:text-navy-500">
          {loading ? (
            <Loader2 className="h-[18px] w-[18px] animate-spin" aria-hidden="true" />
          ) : (
            <Search className="h-[18px] w-[18px]" aria-hidden="true" />
          )}
        </span>

        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          autoComplete="off"
          aria-expanded={showList}
          aria-controls={listboxId}
          aria-autocomplete="list"
          aria-required={required}
          aria-activedescendant={
            activeIndex >= 0 && shown[activeIndex]
              ? `${listboxId}-${shown[activeIndex].value}`
              : undefined
          }
          disabled={disabled || loading}
          value={query}
          placeholder={placeholderText}
          onFocus={() => setOpen(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onKeyDown={onKeyDown}
          className={`form-input pl-10 pr-10 ${
            selected && !query ? "font-medium text-ink placeholder:text-ink" : ""
          }`}
        />

        {selected && !disabled ? (
          <button
            type="button"
            onClick={clear}
            aria-label={`Clear selected ${noun}`}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-faint transition hover:text-navy"
          >
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        ) : (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-faint"
          >
            <ChevronDown className="h-4 w-4" />
          </span>
        )}
      </div>

      {showList && (
        <div className="absolute z-30 mt-1.5 w-full overflow-hidden rounded-xl border border-canvas-border bg-white shadow-lift">
          {promptToType ? (
            <p className="px-3.5 py-3 text-sm text-ink-muted">
              Start typing to find your {noun} &mdash;{" "}
              {options.length.toLocaleString("en-IN")} available.
            </p>
          ) : shown.length === 0 ? (
            <div className="px-3.5 py-3">
              <p className="text-sm text-ink-muted">
                No {noun} matches &ldquo;<span className="font-medium text-ink">{query}</span>&rdquo;.
              </p>
              {emptyAction && <div className="mt-2">{emptyAction}</div>}
            </div>
          ) : (
            <>
              <ul
                ref={listRef}
                id={listboxId}
                role="listbox"
                className="max-h-64 overflow-y-auto py-1"
              >
                {shown.map((opt, i) => {
                  const isSelected = opt.value === value;
                  const isActive = i === activeIndex;
                  return (
                    <li
                      key={opt.value}
                      id={`${listboxId}-${opt.value}`}
                      role="option"
                      aria-selected={isSelected}
                      onMouseEnter={() => setActiveIndex(i)}
                      // onMouseDown, not onClick: mousedown fires before the
                      // input's blur, so the list is still open to receive it.
                      onMouseDown={(e) => {
                        e.preventDefault();
                        choose(opt);
                      }}
                      className={`flex cursor-pointer items-center gap-2 px-3.5 py-2 text-sm transition-colors ${
                        isActive ? "bg-navy-50 text-navy" : "text-ink"
                      }`}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">
                          <Highlighted text={opt.label} query={query} />
                        </span>
                        {opt.hint && (
                          <span className="block truncate text-xs text-ink-faint">{opt.hint}</span>
                        )}
                      </span>
                      {isSelected && (
                        <Check className="h-4 w-4 flex-shrink-0 text-navy" aria-hidden="true" />
                      )}
                    </li>
                  );
                })}
              </ul>
              {matches.length > shown.length && (
                <p className="border-t border-canvas-border px-3.5 py-2 text-xs text-ink-faint">
                  Showing {shown.length} of {matches.length.toLocaleString("en-IN")} matches &mdash;
                  keep typing to narrow it down.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
