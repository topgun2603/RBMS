"use client";

import * as React from "react";
import { ChevronDownIcon, XIcon } from "lucide-react";
import { GST_STATES } from "@srirealtime/gst";
import { Checkbox, cn, Popover, PopoverContent, PopoverTrigger } from "@srirealtime/ui";
import { SearchField, useI18n } from "@srirealtime/web";

/**
 * Chips input: type and press Enter, comma or space to add; Backspace on an empty field removes the last chip.
 * `accept` filters values (e.g. 6-digit pincodes); rejected ones stay in the field and show `invalidText`.
 */
export function ChipsInput({
  id,
  value,
  onChange,
  placeholder,
  accept,
  invalidText,
  max = 1000,
  disabled,
  inputMode,
  "aria-label": ariaLabel,
}: {
  id?: string;
  value: string[];
  onChange: (v: string[]) => void;
  placeholder?: string;
  accept?: (s: string) => boolean;
  invalidText?: string;
  max?: number;
  disabled?: boolean;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  "aria-label"?: string;
}) {
  const { t } = useI18n();
  const [draft, setDraft] = React.useState("");
  const [bad, setBad] = React.useState(false);
  const ref = React.useRef<HTMLInputElement>(null);

  const add = (raw: string) => {
    const parts = raw
      .split(/[\s,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length === 0) return;
    const rejected = parts.filter((p) => accept && !accept(p));
    const next = [...value];
    for (const p of parts) if ((!accept || accept(p)) && !next.includes(p) && next.length < max) next.push(p);
    onChange(next);
    setDraft(rejected.join(" "));
    setBad(rejected.length > 0);
  };

  return (
    <div className="grid gap-1">
      <div
        className={cn(
          "flex min-h-11 flex-wrap items-center gap-1.5 rounded-md border border-input bg-transparent px-2 py-1.5 shadow-xs transition-[color,box-shadow] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30",
          bad && "border-destructive",
          disabled && "pointer-events-none opacity-50",
        )}
        onClick={() => ref.current?.focus()}
      >
        {value.map((v) => (
          <span key={v} className="inline-flex h-7 items-center gap-1 rounded-full bg-primary/10 pr-1 pl-2.5 text-xs font-medium text-primary tabular-nums ring-1 ring-primary/20 ring-inset">
            {v}
            <button
              type="button"
              className="inline-flex size-5 items-center justify-center rounded-full outline-none hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring"
              aria-label={t("orders.common.removeNamed", { name: v })}
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
          ref={ref}
          id={id}
          value={draft}
          disabled={disabled}
          inputMode={inputMode}
          aria-label={ariaLabel}
          aria-invalid={bad}
          placeholder={value.length === 0 ? placeholder : undefined}
          className="h-7 min-w-24 flex-1 bg-transparent px-1 text-base outline-none placeholder:text-muted-foreground sm:text-sm"
          onChange={(e) => {
            const v = e.target.value;
            setBad(false);
            if (/[\s,;]/.test(v)) add(v);
            else setDraft(v);
          }}
          onPaste={(e) => {
            e.preventDefault();
            add(`${draft} ${e.clipboardData.getData("text")}`);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && !draft && value.length > 0) onChange(value.slice(0, -1));
          }}
          onBlur={() => draft.trim() && add(draft)}
        />
      </div>
      {bad && invalidText && <p className="text-xs text-destructive">{invalidText}</p>}
    </div>
  );
}

/** States / UTs multi-select (GST codes) with search; selected ones show as chips. */
export function StateMultiSelect({ id, value, onChange, disabled }: { id?: string; value: string[]; onChange: (v: string[]) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const [q, setQ] = React.useState("");
  const set = new Set(value);
  const shown = GST_STATES.filter((s) => !q.trim() || s.name.toLowerCase().includes(q.trim().toLowerCase()) || s.code === q.trim());
  const name = (code: string) => GST_STATES.find((s) => s.code === code)?.name ?? code;
  return (
    <div className="grid gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            disabled={disabled}
            className="flex h-11 w-full items-center justify-between gap-2 rounded-md border border-input bg-transparent px-3 text-left text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50 dark:bg-input/30"
          >
            <span className={cn("truncate", value.length === 0 && "text-muted-foreground")}>
              {value.length === 0 ? t("orders.delivery.pickStates") : t("orders.delivery.statesCount", { count: value.length })}
            </span>
            <ChevronDownIcon className="size-4 shrink-0 opacity-60" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-2">
          <SearchField value={q} onChange={setQ} placeholder={t("orders.delivery.searchStates")} />
          <ul className="mt-2 max-h-72 overflow-y-auto">
            {shown.map((s) => (
              <li key={s.code}>
                <label className="flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 text-sm hover:bg-accent/50">
                  <Checkbox checked={set.has(s.code)} onCheckedChange={(on) => onChange(on === true ? [...value, s.code] : value.filter((x) => x !== s.code))} />
                  <span className="flex-1">{s.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{s.code}</span>
                </label>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map((c) => (
            <span key={c} className="inline-flex h-7 items-center gap-1 rounded-full bg-info/12 pr-1 pl-2.5 text-xs font-medium text-info-ink ring-1 ring-info/25 ring-inset">
              {name(c)}
              {!disabled && (
                <button
                  type="button"
                  className="inline-flex size-5 items-center justify-center rounded-full outline-none hover:bg-info/20 focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={t("orders.common.removeNamed", { name: name(c) })}
                  onClick={() => onChange(value.filter((x) => x !== c))}
                >
                  <XIcon className="size-3" />
                </button>
              )}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
