"use client";

import * as React from "react";
import { CheckIcon, SearchIcon } from "lucide-react";
import { cn } from "../lib/utils";
import { Input } from "./input";

export interface TradeOption {
  value: string;
  label: string;
  /** One line under the label. */
  hint?: string;
  /** Extra words the search matches (the other language's name, aliases). */
  keywords?: string;
}

export interface TradeGroup {
  key: string;
  label: string;
  options: TradeOption[];
}

/** The `value` of the last option, "Not listed: tell us". The typed trade goes in `label`. */
export const TRADE_NOT_LISTED = "__not_listed";

/** The longest trade the owner can type (the `businessLabel` setting). */
export const TRADE_LABEL_MAX = 60;

/** The groups with only the options that match `query` (name, hint, keywords or group heading); groups left empty are dropped. */
export function filterTradeGroups(groups: readonly TradeGroup[], query: string): TradeGroup[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...groups];
  const words = q.split(/\s+/);
  const out: TradeGroup[] = [];
  for (const g of groups) {
    const options = g.options.filter((o) => {
      const hay = `${o.label} ${o.hint ?? ""} ${o.keywords ?? ""} ${g.label}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
    if (options.length) out.push({ ...g, options });
  }
  return out;
}

export interface TradePickerText {
  /** Placeholder (and accessible name) of the search box. */
  search: string;
  /** Shown when the search matches nothing. */
  empty: string;
  /** The last option: "Not listed: tell us". */
  notListed: string;
  /** Under the last option while it is picked. */
  notListedHint: string;
  /** Label of the field the owner types the trade into. */
  labelField: string;
  /** Placeholder of that field. */
  labelPlaceholder: string;
}

export interface TradePickerProps {
  groups: readonly TradeGroup[];
  /** The picked option's value, `TRADE_NOT_LISTED`, or "" for none. */
  value: string;
  onChange: (value: string) => void;
  /** What the owner typed for "Not listed". */
  label: string;
  onLabelChange: (label: string) => void;
  text: TradePickerText;
  disabled?: boolean;
  className?: string;
  /** The listing scrolls inside this height. */
  maxHeightClass?: string;
  "data-testid"?: string;
}

/**
 * One picker for choosing a trade, shared by sign-up and Settings → Appearance: a search box, the trades grouped under
 * headings (food, shops, health, services…) and a last option "Not listed: tell us" that opens a field for the trade in
 * the owner's own words. It knows nothing about packs; callers pass the groups (see `packPickerGroups` in
 * @rbms/verticals).
 */
export function TradePicker({ groups, value, onChange, label, onLabelChange, text, disabled, className, maxHeightClass = "max-h-72", ...props }: TradePickerProps) {
  const [query, setQuery] = React.useState("");
  const id = React.useId();
  const shown = React.useMemo(() => filterTradeGroups(groups, query), [groups, query]);
  const none = shown.length === 0;
  const other = value === TRADE_NOT_LISTED;

  const pickOther = () => {
    // What was searched for is the likeliest thing to type.
    if (!label.trim() && query.trim()) onLabelChange(query.trim().slice(0, TRADE_LABEL_MAX));
    onChange(TRADE_NOT_LISTED);
  };

  return (
    <div className={cn("grid gap-2", className)} data-testid={props["data-testid"]}>
      <div className="relative">
        <SearchIcon className="pointer-events-none absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={text.search} aria-label={text.search} disabled={disabled} className="ps-9" type="search" autoComplete="off" />
      </div>
      <div role="listbox" aria-label={text.search} className={cn("overflow-y-auto rounded-xl border bg-card p-1", maxHeightClass)}>
        {shown.map((g) => (
          <div key={g.key} role="group" aria-labelledby={`${id}-${g.key}`} className="py-1">
            <div id={`${id}-${g.key}`} className="px-2.5 py-1 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {g.label}
            </div>
            {g.options.map((o) => (
              <Option key={o.value} on={value === o.value} disabled={disabled} onClick={() => onChange(o.value)} title={o.label} hint={o.hint} value={o.value} />
            ))}
          </div>
        ))}
        {none && <p className="px-3 py-3 text-sm text-muted-foreground">{text.empty}</p>}
        <div className="border-t pt-1">
          <Option on={other} disabled={disabled} onClick={pickOther} title={text.notListed} hint={other ? text.notListedHint : undefined} value={TRADE_NOT_LISTED} />
        </div>
      </div>
      {other && (
        <label className="grid gap-1 text-sm">
          <span className="font-medium">{text.labelField}</span>
          <Input
            value={label}
            onChange={(e) => onLabelChange(e.target.value.slice(0, TRADE_LABEL_MAX))}
            placeholder={text.labelPlaceholder}
            maxLength={TRADE_LABEL_MAX}
            disabled={disabled}
            autoFocus
            data-testid="trade-label"
          />
        </label>
      )}
    </div>
  );
}

function Option({ on, disabled, onClick, title, hint, value }: { on: boolean; disabled?: boolean; onClick: () => void; title: string; hint?: string; value: string }) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={on}
      disabled={disabled}
      onClick={onClick}
      data-value={value}
      className={cn(
        "flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-start text-sm outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-60",
        on ? "bg-primary/10 text-foreground" : "hover:bg-accent",
      )}
    >
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="font-medium">{title}</span>
        {hint && <span className="text-xs text-muted-foreground">{hint}</span>}
      </span>
      {on && <CheckIcon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />}
    </button>
  );
}
