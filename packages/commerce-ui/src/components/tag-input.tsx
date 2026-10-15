"use client";

import * as React from "react";
import { XIcon } from "lucide-react";
import { cn } from "@srirealtime/ui";
import { useI18n } from "@srirealtime/web";

/**
 * Chips input: type and press Enter or comma to add, Backspace on an empty field removes the last chip.
 * `normalize` runs on every new value (e.g. lowercase tags); duplicates are ignored.
 */
export function ChipsInput({
  id,
  value,
  onChange,
  placeholder,
  normalize = (s) => s.trim(),
  max = 50,
  className,
  "aria-label": ariaLabel,
  disabled,
}: {
  id?: string;
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  normalize?: (s: string) => string;
  max?: number;
  className?: string;
  "aria-label"?: string;
  disabled?: boolean;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = React.useState("");
  const inputRef = React.useRef<HTMLInputElement>(null);

  const add = (raw: string) => {
    const parts = raw
      .split(",")
      .map(normalize)
      .filter((s) => s.length > 0);
    if (parts.length === 0) return;
    const next = [...value];
    for (const p of parts) if (!next.includes(p) && next.length < max) next.push(p);
    onChange(next);
    setDraft("");
  };

  return (
    <div
      className={cn(
        "flex min-h-11 flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30",
        disabled && "pointer-events-none opacity-50",
        className,
      )}
      onClick={() => inputRef.current?.focus()}
    >
      {value.map((v) => (
        <span key={v} className="inline-flex h-7 items-center gap-1 rounded-full bg-primary/10 pr-1 pl-2.5 text-xs font-medium text-primary ring-1 ring-primary/20 ring-inset">
          {v}
          <button
            type="button"
            className="inline-flex size-5 items-center justify-center rounded-full outline-none hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("commerce.common.removeNamed", { name: v })}
            onClick={(e) => {
              e.stopPropagation();
              onChange(value.filter((x) => x !== v));
            }}
          >
            <XIcon className="size-3" />
          </button>
        </span>
      ))}
      <input
        ref={inputRef}
        id={id}
        value={draft}
        disabled={disabled}
        aria-label={ariaLabel}
        placeholder={value.length === 0 ? placeholder : undefined}
        className="h-7 min-w-24 flex-1 bg-transparent px-1 text-base outline-none placeholder:text-muted-foreground sm:text-sm"
        onChange={(e) => {
          const v = e.target.value;
          if (v.includes(",")) add(v);
          else setDraft(v);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && value.length > 0) {
            onChange(value.slice(0, -1));
          }
        }}
        onBlur={() => draft.trim() && add(draft)}
      />
    </div>
  );
}
