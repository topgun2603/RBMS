"use client";

import * as React from "react";
import { Loader2Icon, SearchIcon, XIcon } from "lucide-react";
import { Button, cn, Input } from "@rbms/ui";
import { useDebounced, useI18n } from "@rbms/web";
import { money } from "../lib/format";
import { useBills, useShopItems } from "../lib/queries";
import type { BillSummary, ShopItem } from "../lib/types";

interface PickerProps<T> {
  value: T | null;
  onChange: (v: T | null) => void;
  invalid?: boolean;
  autoFocus?: boolean;
  id?: string;
}

/** Search box with a result list underneath; once picked, the choice shows with a clear button. */
function SearchPicker<T>({
  value,
  onChange,
  invalid,
  autoFocus,
  id,
  placeholder,
  useResults,
  render,
  keyOf,
  selected,
  empty,
}: PickerProps<T> & {
  placeholder: string;
  useResults: (q: string, enabled: boolean) => { items: T[]; loading: boolean };
  render: (row: T) => React.ReactNode;
  keyOf: (row: T) => string;
  selected: (row: T) => React.ReactNode;
  empty: string;
}) {
  const { t } = useI18n();
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const term = useDebounced(q, 250);
  const { items, loading } = useResults(term, open && !value);
  const [active, setActive] = React.useState(0);
  React.useEffect(() => setActive(0), [items]);

  if (value) {
    return (
      <div className="flex min-h-10 items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2">
        <div className="min-w-0 text-sm">{selected(value)}</div>
        <Button type="button" size="sm" variant="ghost" onClick={() => onChange(null)} aria-label={t("pharmacy.common.change")}>
          <XIcon /> {t("pharmacy.common.change")}
        </Button>
      </div>
    );
  }

  const pick = (row: T) => {
    onChange(row);
    setQ("");
    setOpen(false);
  };

  return (
    <div className="relative">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        id={id}
        autoFocus={autoFocus}
        aria-invalid={invalid || undefined}
        className="pl-9"
        value={q}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onBlur={() => window.setTimeout(() => setOpen(false), 150)}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActive((a) => Math.min(a + 1, items.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActive((a) => Math.max(a - 1, 0));
          } else if (e.key === "Enter" && open && items[active]) {
            e.preventDefault();
            pick(items[active]!);
          } else if (e.key === "Escape") setOpen(false);
        }}
      />
      {loading && <Loader2Icon className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
      {open && (
        <ul role="listbox" className="absolute z-50 mt-1 max-h-64 w-full overflow-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          {items.length === 0 && !loading ? (
            <li className="px-3 py-2 text-sm text-muted-foreground">{empty}</li>
          ) : (
            items.map((row, i) => (
              <li
                key={keyOf(row)}
                role="option"
                aria-selected={i === active}
                className={cn("cursor-pointer rounded-sm px-3 py-2 text-sm", i === active && "bg-accent text-accent-foreground")}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  pick(row);
                }}
              >
                {render(row)}
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

/** Picks a billing item (catalogue variant) by name. */
export function ItemPicker(props: PickerProps<ShopItem>) {
  const { t } = useI18n();
  return (
    <SearchPicker
      {...props}
      placeholder={t("pharmacy.pickers.itemPlaceholder")}
      empty={t("pharmacy.pickers.noItems")}
      useResults={(q, enabled) => {
        const r = useShopItems(q, enabled);
        return { items: r.data?.items ?? [], loading: r.isFetching };
      }}
      keyOf={(r) => r.id}
      render={(r) => (
        <span className="flex items-center justify-between gap-3">
          <span className="truncate">{r.name}</span>
          <span className="shrink-0 tabular-nums text-muted-foreground">{money(r.rate)}</span>
        </span>
      )}
      selected={(r) => <span className="font-medium">{r.name}</span>}
    />
  );
}

/** Picks a recent bill by number or customer. */
export function BillPicker(props: PickerProps<BillSummary>) {
  const { t, formatDate } = useI18n();
  const name = (b: BillSummary) => b.customer?.name ?? b.customerName ?? "";
  return (
    <SearchPicker
      {...props}
      placeholder={t("pharmacy.pickers.billPlaceholder")}
      empty={t("pharmacy.pickers.noBills")}
      useResults={(q, enabled) => {
        const r = useBills(q, enabled);
        return { items: (r.data?.items ?? []).filter((b) => b.number), loading: r.isFetching };
      }}
      keyOf={(b) => b.id}
      render={(b) => (
        <span className="flex items-center justify-between gap-3">
          <span className="truncate">
            <span className="font-medium">{b.number}</span> · {formatDate(b.date)} {name(b) && `· ${name(b)}`}
          </span>
          <span className="shrink-0 tabular-nums text-muted-foreground">{money(b.total)}</span>
        </span>
      )}
      selected={(b) => (
        <span>
          <span className="font-medium">{b.number}</span> · {formatDate(b.date)}
        </span>
      )}
    />
  );
}
