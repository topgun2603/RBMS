"use client";

import * as React from "react";
import { CalendarRangeIcon, CheckIcon, ListFilterIcon, PlusCircleIcon, SearchIcon, XIcon } from "lucide-react";
import { AnimatePresence, motion, useReducedMotionSafe } from "../motion";
import { cn } from "../lib/utils";
import { Button } from "./button";
import { Input } from "./input";
import { Label } from "./label";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Separator } from "./separator";
import { DataTableColumnsMenu, isFilterActive, type DataTableFilter, type DataTableInstance, type DataTableLabels, type DateRangeValue } from "./data-table";
import { DATE_RANGE_PRESETS, matchPreset, presetDateRange, todayISO, type DateRangePresetId } from "./data-table-model";

/*
 * DataTableToolbar: search (debounced 300 ms), faceted filters (popover with checkboxes and counts), a date range
 * filter, the Columns menu, active filter chips and "Clear filters". It reads everything from the DataTable instance
 * (useDataTable / useServerTable), so a page renders `<DataTableToolbar table={dt} />` and nothing else.
 */

export interface DataTableToolbarProps<T> {
  table: DataTableInstance<T>;
  /** Extra controls at the right end (export, view switch). */
  children?: React.ReactNode;
  /** Content between the controls row and the chips (e.g. status pills). */
  quickFilters?: React.ReactNode;
  /** Columns menu (md+, when columns are hideable). Default true when the table has a storageKey. */
  showColumns?: boolean;
  /** Search debounce in ms. Default 300. */
  debounceMs?: number;
  className?: string;
}

function DataTableToolbar<T>({ table: dt, children, quickFilters, showColumns, debounceMs = 300, className }: DataTableToolbarProps<T>) {
  const l = dt.labels;
  const active = dt.filters.filter(isFilterActive);
  const columns = showColumns ?? !!dt.storageKey;
  const reduced = useReducedMotionSafe();
  return (
    <div data-slot="data-table-toolbar" className={cn("mb-4 grid grid-cols-1 gap-3", className)}>
      <div className="flex flex-col gap-2 md:flex-row md:items-center">
        {dt.search && (
          <DebouncedSearch
            value={dt.search.value}
            onChange={dt.search.onChange}
            placeholder={dt.search.placeholder ?? l.search}
            clearLabel={l.clear}
            debounceMs={debounceMs}
            className="md:max-w-sm md:min-w-56 md:flex-1 md:self-start"
          />
        )}
        <div className="-mx-1 flex min-w-0 flex-1 items-center gap-2 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none] md:flex-wrap md:overflow-visible md:pb-0">
          {dt.filters.map((f) =>
            f.kind === "options" ? <FacetedFilter key={f.id} filter={f} labels={l} /> : <DateRangeFilter key={f.id} filter={f} labels={l} />,
          )}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {columns && <DataTableColumnsMenu table={dt} className={cn(dt.columns.some((c) => c.card) && "hidden md:inline-flex")} />}
            {children}
          </div>
        </div>
      </div>
      {quickFilters}
      <AnimatePresence initial={false}>
        {(active.length > 0 || dt.activeFilterCount > 0) && (
          <motion.div
            key="chips"
            initial={reduced ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={reduced ? undefined : { opacity: 0, height: 0 }}
            transition={{ duration: 0.18 }}
            className="flex flex-wrap items-center gap-2"
          >
            {active.map((f) => (
              <FilterChip key={f.id} filter={f} labels={l} />
            ))}
            {dt.onClearFilters && (
              <Button variant="ghost" size="sm" className="h-8 text-muted-foreground" onClick={dt.onClearFilters}>
                {l.clearFilters}
              </Button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/** Search input that reports after `debounceMs` of no typing; outside changes (Clear filters, back button) flow in. */
function DebouncedSearch({
  value,
  onChange,
  placeholder,
  clearLabel,
  debounceMs,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  clearLabel: string;
  debounceMs: number;
  className?: string;
}) {
  const [text, setText] = React.useState(value);
  const sent = React.useRef(value);
  React.useEffect(() => {
    if (value !== sent.current) {
      sent.current = value;
      setText(value);
    }
  }, [value]);
  React.useEffect(() => {
    if (text.trim() === sent.current.trim()) return;
    const id = window.setTimeout(() => {
      sent.current = text.trim();
      onChange(text.trim());
    }, debounceMs);
    return () => window.clearTimeout(id);
  }, [text, debounceMs, onChange]);
  return (
    <div className={cn("relative", className)}>
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
      <Input
        type="search"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            sent.current = text.trim();
            onChange(text.trim());
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder}
        className="rounded-xl bg-card pr-9 pl-9 [&::-webkit-search-cancel-button]:hidden"
      />
      {text && (
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute top-1/2 right-0.5 size-8 -translate-y-1/2 text-muted-foreground"
          aria-label={clearLabel}
          onClick={() => {
            setText("");
            sent.current = "";
            onChange("");
          }}
        >
          <XIcon />
        </Button>
      )}
    </div>
  );
}

type OptionsFilter = Extract<DataTableFilter, { kind: "options" }>;
type RangeFilter = Extract<DataTableFilter, { kind: "dateRange" }>;

/** Filter button + popover of checkboxes (radio for `single`), with counts when the API sends facets. */
function FacetedFilter({ filter: f, labels: l }: { filter: OptionsFilter; labels: DataTableLabels }) {
  const [find, setFind] = React.useState("");
  const selected = new Set(f.value);
  const Icon = f.icon ?? PlusCircleIcon;
  const shown = find ? f.options.filter((o) => o.label.toLowerCase().includes(find.toLowerCase())) : f.options;
  const toggle = (v: string) => {
    if (f.single) return f.onChange(selected.has(v) ? [] : [v]);
    const next = new Set(selected);
    if (next.has(v)) next.delete(v);
    else next.add(v);
    // Keep the options' order in the URL.
    f.onChange(f.options.map((o) => o.value).filter((x) => next.has(x)));
  };
  const chosen = f.options.filter((o) => selected.has(o.value));
  return (
    <Popover onOpenChange={(o) => !o && setFind("")}>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn("shrink-0 border-dashed bg-card", selected.size > 0 && "border-solid border-primary/40")}>
          <Icon className="text-muted-foreground" />
          {f.label}
          {selected.size > 0 && (
            <>
              <Separator orientation="vertical" className="mx-0.5 h-4" />
              {chosen.length <= 2 ? (
                <span className="hidden gap-1 lg:flex">
                  {chosen.map((o) => (
                    <span key={o.value} className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary">
                      {o.label}
                    </span>
                  ))}
                </span>
              ) : null}
              <span className={cn("rounded-sm bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary tabular-nums", chosen.length <= 2 && "lg:hidden")}>
                {chosen.length <= 2 && chosen.length > 0 ? chosen.length : l.selectedCount(selected.size)}
              </span>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-0">
        {f.options.length > 7 && (
          <div className="border-b p-2">
            <Input size="sm" value={find} onChange={(e) => setFind(e.target.value)} placeholder={l.filterSearch} aria-label={l.filterSearch} autoFocus />
          </div>
        )}
        <div role={f.single ? "radiogroup" : "group"} aria-label={f.label} className="max-h-72 overflow-y-auto p-1">
          {shown.length === 0 && <p className="px-2 py-6 text-center text-sm text-muted-foreground">{l.noOptions}</p>}
          {shown.map((o) => {
            const on = selected.has(o.value);
            const OIcon = o.icon;
            return (
              <button
                key={o.value}
                type="button"
                role={f.single ? "radio" : "checkbox"}
                aria-checked={on}
                onClick={() => toggle(o.value)}
                className="flex h-9 w-full items-center gap-2.5 rounded-md px-2 text-left text-sm outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <span
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center border border-input transition-colors",
                    f.single ? "rounded-full" : "rounded-[4px]",
                    on && "border-primary bg-primary text-primary-foreground",
                  )}
                  aria-hidden
                >
                  {on && <CheckIcon className="size-3" />}
                </span>
                {OIcon && <OIcon className="size-4 text-muted-foreground" />}
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.count !== undefined && <span className="text-xs text-muted-foreground tabular-nums">{l.formatNumber(o.count)}</span>}
              </button>
            );
          })}
        </div>
        {selected.size > 0 && (
          <div className="border-t p-1">
            <Button variant="ghost" size="sm" className="w-full justify-center" onClick={() => f.onChange([])}>
              {l.clear}
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

/** Date filter: presets (Today … This financial year) and a custom from/to (IST calendar dates, YYYY-MM-DD). */
function DateRangeFilter({ filter: f, labels: l }: { filter: RangeFilter; labels: DataTableLabels }) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<DateRangeValue>(f.value);
  React.useEffect(() => {
    if (open) setDraft(f.value);
  }, [open, f.value]);
  const today = todayISO();
  const presets = f.presets ?? DATE_RANGE_PRESETS;
  const current = matchPreset(f.value, today);
  const on = isFilterActive(f);
  const apply = (v: DateRangeValue) => {
    f.onChange(v);
    setOpen(false);
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" className={cn("shrink-0 border-dashed bg-card", on && "border-solid border-primary/40")}>
          <CalendarRangeIcon className="text-muted-foreground" />
          {f.label}
          {on && (
            <>
              <Separator orientation="vertical" className="mx-0.5 h-4" />
              <span className="rounded-sm bg-primary/10 px-1.5 py-0.5 text-xs font-medium text-primary tabular-nums">
                {current ? l.datePresets[current] : rangeText(f.value, l)}
              </span>
            </>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="grid grid-cols-2 gap-1 p-2">
          {presets.map((id: DateRangePresetId) => (
            <Button
              key={id}
              variant={current === id ? "secondary" : "ghost"}
              size="sm"
              className={cn("justify-start", current === id && "text-primary")}
              onClick={() => apply(presetDateRange(id, today))}
            >
              {l.datePresets[id]}
            </Button>
          ))}
        </div>
        <Separator />
        <form
          className="grid gap-3 p-3"
          onSubmit={(e) => {
            e.preventDefault();
            apply({ from: draft.from || undefined, to: draft.to || undefined });
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            <div className="grid gap-1">
              <Label htmlFor={`${f.id}-from`} className="text-xs text-muted-foreground">
                {l.from}
              </Label>
              <Input
                id={`${f.id}-from`}
                type="date"
                size="sm"
                value={draft.from ?? ""}
                max={draft.to || today}
                onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value || undefined }))}
              />
            </div>
            <div className="grid gap-1">
              <Label htmlFor={`${f.id}-to`} className="text-xs text-muted-foreground">
                {l.to}
              </Label>
              <Input
                id={`${f.id}-to`}
                type="date"
                size="sm"
                value={draft.to ?? ""}
                min={draft.from}
                onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value || undefined }))}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            {on && (
              <Button type="button" variant="ghost" size="sm" onClick={() => apply({})}>
                {l.clear}
              </Button>
            )}
            <Button type="submit" size="sm" disabled={!!draft.from && !!draft.to && draft.to < draft.from}>
              {l.apply}
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function rangeText(v: DateRangeValue, l: DataTableLabels) {
  if (v.from && v.to) return v.from === v.to ? l.formatDate(v.from) : `${l.formatDate(v.from)} – ${l.formatDate(v.to)}`;
  if (v.from) return `≥ ${l.formatDate(v.from)}`;
  if (v.to) return `≤ ${l.formatDate(v.to)}`;
  return l.anyDate;
}

/** "Status: Paid, Unpaid ×" */
function FilterChip({ filter: f, labels: l }: { filter: DataTableFilter; labels: DataTableLabels }) {
  let text: string;
  if (f.kind === "options") {
    const names = f.options.filter((o) => f.value.includes(o.value)).map((o) => o.label);
    text = names.length > 2 ? l.selectedCount(names.length) : names.join(", ");
  } else {
    const p = matchPreset(f.value);
    text = p ? l.datePresets[p] : rangeText(f.value, l);
  }
  return (
    <span className="inline-flex h-8 items-center gap-1 rounded-full border bg-card pr-1 pl-3 text-xs shadow-xs">
      <ListFilterIcon className="size-3.5 text-muted-foreground" aria-hidden />
      <span className="text-muted-foreground">{f.label}:</span>
      <span className="max-w-48 truncate font-medium">{text}</span>
      <button
        type="button"
        onClick={() => (f.kind === "options" ? f.onChange([]) : f.onChange({}))}
        className="ml-0.5 flex size-6 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        aria-label={`${l.clear}: ${f.label}`}
      >
        <XIcon className="size-3.5" />
      </button>
    </span>
  );
}

export { DataTableToolbar, DebouncedSearch, FacetedFilter, DateRangeFilter };
