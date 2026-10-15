"use client";

import * as React from "react";
import { cn } from "../lib/utils";
import { controlHeight, type ControlSize } from "../lib/control";

const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Expands "#abc" to "#aabbcc"; returns null for anything that isn't a 3/6-digit hex colour. */
export function normalizeHex(input: string): string | null {
  let v = input.trim();
  if (!v.startsWith("#")) v = `#${v}`;
  if (!HEX_RE.test(v)) return null;
  if (v.length === 4) v = `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  return v.toLowerCase();
}

export interface ColorInputProps {
  value: string;
  onChange: (hex: string) => void;
  id?: string;
  disabled?: boolean;
  className?: string;
  placeholder?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  /** Height on the shared control scale (default 40px). */
  size?: ControlSize;
}

/** Hex text field paired with the native colour picker. Emits normalised "#rrggbb" values only. */
function ColorInput({
  value,
  onChange,
  id,
  disabled,
  className,
  placeholder = "#2563eb",
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  size = "default",
}: ColorInputProps) {
  const [draft, setDraft] = React.useState(value);
  React.useEffect(() => setDraft(value), [value]);
  const valid = normalizeHex(draft) !== null;
  const swatch = normalizeHex(value) ?? "#000000";

  return (
    <div
      data-slot="color-input"
      className={cn(
        "flex w-full items-center gap-2 rounded-md border border-input bg-transparent pr-3 pl-1 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30",
        controlHeight(size),
        (!valid || ariaInvalid) && "border-destructive ring-destructive/20",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
    >
      <label className="relative size-7 shrink-0 cursor-pointer overflow-hidden rounded-[calc(var(--radius)-4px)] border shadow-inner">
        <span className="absolute inset-0" style={{ background: swatch }} />
        <input
          type="color"
          value={swatch}
          disabled={disabled}
          aria-label={ariaLabel}
          onChange={(e) => onChange(e.target.value.toLowerCase())}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        />
      </label>
      <input
        id={id}
        type="text"
        spellCheck={false}
        autoComplete="off"
        value={draft}
        disabled={disabled}
        placeholder={placeholder}
        aria-invalid={!valid || ariaInvalid || undefined}
        aria-describedby={ariaDescribedBy}
        onChange={(e) => {
          setDraft(e.target.value);
          const hex = normalizeHex(e.target.value);
          if (hex) onChange(hex);
        }}
        onBlur={() => setDraft(normalizeHex(draft) ?? value)}
        className="min-w-0 flex-1 bg-transparent font-mono text-sm uppercase outline-none placeholder:text-muted-foreground"
      />
    </div>
  );
}

export { ColorInput };
