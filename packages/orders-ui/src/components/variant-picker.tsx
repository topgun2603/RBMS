"use client";

import * as React from "react";
import { Loader2Icon, PackageSearchIcon, PlusIcon } from "lucide-react";
import { cn, Popover, PopoverAnchor, PopoverContent } from "@srirealtime/ui";
import { useDebounced, useI18n } from "@srirealtime/web";
import { money } from "../lib/format";
import { useVariantSearch } from "../lib/queries";
import type { VariantLookup } from "../lib/types";
import { Thumb } from "./bits";

/**
 * Search the catalogue's variants (name, SKU, barcode) and pick one. Arrow keys + Enter work; a scanner typing a
 * barcode and Enter adds the first match.
 */
export function VariantPicker({ onPick, disabled }: { onPick: (v: VariantLookup) => void; disabled?: boolean }) {
  const { t } = useI18n();
  const [q, setQ] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [active, setActive] = React.useState(0);
  const debounced = useDebounced(q.trim(), 250);
  const search = useVariantSearch(debounced, open);
  const items = (search.data?.items ?? []).filter((v) => v.status !== "archived");
  const listId = React.useId();

  React.useEffect(() => setActive(0), [debounced]);

  const pick = (v: VariantLookup | undefined) => {
    if (!v) return;
    onPick(v);
    setQ("");
    setActive(0);
  };

  return (
    <Popover open={open && !disabled} onOpenChange={setOpen}>
      <PopoverAnchor asChild>
        <div className="relative">
          <PackageSearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            aria-label={t("orders.new.searchProducts")}
            placeholder={t("orders.new.searchProducts")}
            disabled={disabled}
            value={q}
            onFocus={() => setOpen(true)}
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
              } else if (e.key === "Enter") {
                e.preventDefault();
                pick(items[active]);
              } else if (e.key === "Escape") setOpen(false);
            }}
            className="h-11 w-full rounded-xl border border-input bg-card pr-10 pl-9 text-base shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 sm:text-sm"
          />
          {search.isFetching && <Loader2Icon className="absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
        </div>
      </PopoverAnchor>
      <PopoverContent
        align="start"
        className="w-[var(--radix-popover-trigger-width)] p-1"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => {
          if ((e.target as HTMLElement | null)?.closest?.("[role=combobox]")) e.preventDefault();
        }}
      >
        <ul id={listId} role="listbox" aria-label={t("orders.new.results")} className="max-h-80 overflow-y-auto">
          {search.isPending ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">{t("orders.common.loading")}</li>
          ) : items.length === 0 ? (
            <li className="px-3 py-6 text-center text-sm text-muted-foreground">{t("orders.new.noProducts")}</li>
          ) : (
            items.map((v, i) => (
              <li key={v.id} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => pick(v)}
                  className={cn("flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left outline-none", i === active && "bg-accent")}
                >
                  <Thumb src={v.image} alt="" className="size-10" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{v.productName}</span>
                    <span className="block truncate text-xs text-muted-foreground">{[v.title, v.sku].filter(Boolean).join(" · ") || "—"}</span>
                  </span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">{money(v.price)}</span>
                  <PlusIcon className="size-4 shrink-0 text-primary" />
                </button>
              </li>
            ))
          )}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
