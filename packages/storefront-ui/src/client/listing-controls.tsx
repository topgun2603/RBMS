"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpDownIcon, SlidersHorizontalIcon, XIcon } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@srirealtime/ui/components/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@srirealtime/ui/components/select";
import { Slider } from "@srirealtime/ui/components/slider";
import { Button } from "@srirealtime/ui/components/button";
import { AnimatePresence, LayoutGroup, motion, RollingNumber } from "@srirealtime/ui/motion";
import { money } from "../lib/format";
import { useStore } from "./store-context";

/** Sort dropdown (shadcn Select); navigates to the href for the chosen sort (hrefs computed on the server). */
export function SortSelect({ value, options }: { value: string; options: { value: string; label: string; href: string }[] }) {
  const { t } = useStore();
  const router = useRouter();
  return (
    <Select
      value={value}
      onValueChange={(v) => {
        const o = options.find((x) => x.value === v);
        if (o) router.push(o.href, { scroll: false });
      }}
    >
      <SelectTrigger className="h-10 min-w-44 rounded-full bg-card px-4 text-sm font-medium" aria-label={t("list.sort")}>
        <ArrowUpDownIcon className="size-4 text-muted-foreground" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" className="rounded-2xl">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="rounded-xl py-2">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Phone: filters (server-rendered children) in a bottom sheet, with the active chips on top. */
export function FilterSheet({ children, activeCount, resultsLabel, chips }: { children: React.ReactNode; activeCount: number; resultsLabel: string; chips?: React.ReactNode }) {
  const { t } = useStore();
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button variant="outline" className="h-10 rounded-full lg:hidden" onClick={() => setOpen(true)} data-testid="filter-button">
        <SlidersHorizontalIcon />
        {t("list.filters")}
        <AnimatePresence>
          {activeCount > 0 && (
            <motion.span initial={{ scale: 0 }} animate={{ scale: 1 }} exit={{ scale: 0 }} className="flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
              <RollingNumber value={activeCount} />
            </motion.span>
          )}
        </AnimatePresence>
      </Button>
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side="bottom"
          className="max-h-[88dvh] gap-0 rounded-t-3xl p-0 data-[state=open]:duration-500 data-[state=open]:ease-[cubic-bezier(0.32,0.72,0,1)]"
          closeLabel={t("common.close")}
          data-testid="filter-sheet"
        >
          <div aria-hidden className="mx-auto mt-2.5 h-1.5 w-12 rounded-full bg-muted-foreground/25" />
          <SheetHeader className="border-b pt-3">
            <SheetTitle className="font-display text-xl">{t("list.filters")}</SheetTitle>
            <SheetDescription className="sr-only">{t("list.filters")}</SheetDescription>
          </SheetHeader>
          {chips && <div className="border-b px-4 py-3">{chips}</div>}
          {/* Links inside close the sheet as they navigate. */}
          <div className="overflow-y-auto p-4" onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)}>
            {children}
          </div>
          <div className="border-t p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
            <Button size="lg" className="h-12 w-full rounded-full" onClick={() => setOpen(false)}>
              {resultsLabel}
            </Button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

/** Active filter chips: pop in / out and re-flow smoothly; "Clear all" at the end. */
export function ActiveFilterChips({ chips, clearHref, clearLabel, removeLabel }: { chips: { key: string; label: string; href: string }[]; clearHref: string; clearLabel: string; removeLabel: string }) {
  return (
    <LayoutGroup>
      <ul className="flex flex-wrap gap-2" data-testid="active-filters">
        <AnimatePresence initial={false} mode="popLayout">
          {chips.map((a) => (
            <motion.li key={a.key} layout initial={{ opacity: 0, scale: 0.8 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.8 }} transition={{ type: "spring", stiffness: 500, damping: 32 }}>
              <Link
                href={a.href}
                scroll={false}
                className="group inline-flex h-8 items-center gap-1.5 rounded-full bg-primary/10 ps-3 pe-2 text-xs font-semibold text-primary transition-colors hover:bg-primary hover:text-primary-foreground focus-ring"
              >
                {a.label}
                <XIcon className="size-3.5 transition-transform group-hover:rotate-90" aria-hidden />
                <span className="sr-only">{removeLabel}</span>
              </Link>
            </motion.li>
          ))}
          {chips.length > 0 && (
            <motion.li key="__clear" layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <Link href={clearHref} scroll={false} className="inline-flex h-8 items-center rounded-full px-2 text-xs font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-ring">
                {clearLabel}
              </Link>
            </motion.li>
          )}
        </AnimatePresence>
      </ul>
    </LayoutGroup>
  );
}

/** Price range slider (₹). Applies on release by navigating to the server-computed URL pattern. */
export function PriceRange({ min, max, value, hrefFor }: { min: number; max: number; value: [number, number]; hrefFor: { base: string; params: [string, string][] } }) {
  const { t } = useStore();
  const router = useRouter();
  const [v, setV] = React.useState<[number, number]>(value);
  React.useEffect(() => setV(value), [value[0], value[1]]); // eslint-disable-line react-hooks/exhaustive-deps
  const step = Math.max(1, Math.round((max - min) / 100 / 10) * 10 || 1);
  const apply = (next: number[]) => {
    const [lo, hi] = next as [number, number];
    const qs = new URLSearchParams(hrefFor.params);
    qs.delete("min");
    qs.delete("max");
    qs.delete("page");
    if (lo > min) qs.set("min", String(lo));
    if (hi < max) qs.set("max", String(hi));
    const s = qs.toString();
    router.push(s ? `${hrefFor.base}?${s}` : hrefFor.base, { scroll: false });
  };
  if (max <= min) return null;
  return (
    <div className="grid gap-4 pt-1" data-testid="price-range">
      <Slider min={min} max={max} step={step} value={v} onValueChange={(x) => setV([x[0]!, x[1]!])} onValueCommit={apply} thumbLabels={[t("list.priceMin"), t("list.priceMax")]} className="[&_[data-slot=slider-thumb]]:size-5 [&_[data-slot=slider-thumb]]:border-2" />
      <div className="flex items-center justify-between gap-2 text-sm font-semibold tabular-nums">
        <span className="rounded-lg border bg-card px-2.5 py-1">{money(v[0] * 100)}</span>
        <span className="h-px flex-1 bg-border" />
        <span className="rounded-lg border bg-card px-2.5 py-1">{money(v[1] * 100)}</span>
      </div>
    </div>
  );
}
