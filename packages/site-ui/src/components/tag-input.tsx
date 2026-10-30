"use client";

import * as React from "react";
import { XIcon } from "lucide-react";
import { cn } from "@rbms/ui";
import { useI18n } from "@rbms/web";

/** Lowercase tags as chips; Enter or comma adds, Backspace on an empty input removes the last one. */
export function TagInput({
  id,
  value,
  onChange,
  max,
  disabled,
  placeholder,
}: {
  id: string;
  value: string[];
  onChange: (v: string[]) => void;
  max: number;
  disabled?: boolean;
  placeholder?: string;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = React.useState("");
  const add = (raw: string) => {
    const tags = raw
      .split(",")
      .map((s) => s.trim().toLowerCase().slice(0, 40))
      .filter(Boolean);
    if (!tags.length) return;
    onChange([...new Set([...value, ...tags])].slice(0, max));
    setDraft("");
  };
  return (
    <div
      className={cn(
        "flex min-h-10 flex-wrap items-center gap-1.5 rounded-xl border border-input bg-card px-2 py-1 shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/40",
        disabled && "opacity-60",
      )}
    >
      {value.map((tag) => (
        <span key={tag} className="inline-flex h-7 items-center gap-1 rounded-full bg-primary/10 pr-1 pl-2.5 text-xs font-medium text-primary">
          #{tag}
          <button
            type="button"
            disabled={disabled}
            className="inline-flex size-5 items-center justify-center rounded-full outline-none hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring"
            aria-label={t("site.common.removeNamed", { name: tag })}
            onClick={() => onChange(value.filter((x) => x !== tag))}
          >
            <XIcon className="size-3" />
          </button>
        </span>
      ))}
      <input
        id={id}
        value={draft}
        disabled={disabled || value.length >= max}
        placeholder={value.length ? undefined : placeholder}
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
          } else if (e.key === "Backspace" && !draft && value.length) onChange(value.slice(0, -1));
        }}
        onBlur={() => add(draft)}
      />
    </div>
  );
}
