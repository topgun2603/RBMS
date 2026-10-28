"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowUpDownIcon, ChevronDownIcon, Loader2Icon, SlidersHorizontalIcon, XIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@srirealtime/ui/components/popover";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@srirealtime/ui/components/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@srirealtime/ui/components/select";
import { Slider } from "@srirealtime/ui/components/slider";
import { Button } from "@srirealtime/ui/components/button";
import { AnimatePresence, LayoutGroup, motion, RollingNumber } from "@srirealtime/ui/motion";
import { cn } from "@srirealtime/ui/lib/utils";
import { money } from "../lib/format";
import { listClass, gridClass, type GridColumns, type GridLayout } from "../lib/grid";
import type { ProductSummary, Rating, SearchResult } from "../types";
import { call } from "./api";
import { ProductCardView, ProductRowView } from "./product-card";
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
      <SelectTrigger className="min-w-36 rounded-full bg-card px-4 text-sm font-medium max-sm:flex-1 sm:min-w-44" aria-label={t("list.sort")}>
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

/**
 * Filters (server-rendered children) in a sheet with the active chips on top: a bottom sheet on phones. `always`
 * (theme `listingFilters: drawer`) shows the button on every screen and opens a side panel on desktop.
 */
export function FilterSheet({ children, activeCount, resultsLabel, chips, always = false }: { children: React.ReactNode; activeCount: number; resultsLabel: string; chips?: React.ReactNode; always?: boolean }) {
  const { t } = useStore();
  const [open, setOpen] = React.useState(false);
  const [wide, setWide] = React.useState(false);
  React.useEffect(() => {
    if (!always) return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const on = () => setWide(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [always]);
  const side = always && wide ? "left" : "bottom";
  return (
    <>
      <Button variant="outline" className={cn("rounded-full", !always && "lg:hidden")} onClick={() => setOpen(true)} data-testid="filter-button">
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
          side={side}
          className={cn(
            "gap-0 p-0 data-[state=open]:duration-500 data-[state=open]:ease-[cubic-bezier(0.32,0.72,0,1)]",
            side === "bottom" ? "max-h-[88dvh] rounded-t-3xl" : "w-[min(92vw,360px)] sm:max-w-sm",
          )}
          closeLabel={t("common.close")}
          data-testid="filter-sheet"
        >
          {side === "bottom" && <div aria-hidden className="mx-auto mt-2.5 h-1.5 w-12 rounded-full bg-muted-foreground/25" />}
          <SheetHeader className="border-b pt-3">
            <SheetTitle className="font-display text-xl">{t("list.filters")}</SheetTitle>
            <SheetDescription className="sr-only">{t("list.filters")}</SheetDescription>
          </SheetHeader>
          {chips && <div className="border-b px-4 py-3">{chips}</div>}
          {/* Links inside close the sheet as they navigate. */}
          <div className="flex-1 overflow-y-auto p-4" onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)}>
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

/**
 * Top-bar filters (theme `listingFilters: top-bar`): one dropdown per filter group above the products. The panel's
 * content is server-rendered (links); following one closes the dropdown.
 */
export function FilterDropdown({ label, active = 0, children, wide }: { label: string; active?: number; children: React.ReactNode; wide?: boolean }) {
  const { t } = useStore();
  const [open, setOpen] = React.useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex h-10 shrink-0 items-center gap-1.5 rounded-full border bg-card px-4 text-sm font-medium transition-colors focus-ring hover:border-foreground/40",
            active > 0 && "border-primary bg-primary/10 text-primary",
          )}
          aria-label={t("list.filterBy", { name: label })}
        >
          {label}
          {active > 0 && <span className="flex size-5 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">{active}</span>}
          <ChevronDownIcon className={cn("size-4 opacity-60 transition-transform", open && "rotate-180")} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className={cn("max-h-[60vh] overflow-x-hidden overflow-y-auto rounded-2xl p-3", wide ? "w-80" : "w-64")} onClick={(e) => (e.target as HTMLElement).closest("a") && setOpen(false)}>
        {children}
      </PopoverContent>
    </Popover>
  );
}

const ratingMap = (rows: Rating[] | { items: Rating[] }) => {
  const list = Array.isArray(rows) ? rows : (rows.items ?? []);
  return Object.fromEntries(list.filter((r) => r.count > 0).map((r) => [r.productId, { average: r.average, count: r.count }]));
};

/**
 * "Load more" / infinite scroll (theme `listingPaging`) under the server-rendered first page. Later pages come from
 * the same search query (`query`: the API query string without limit/offset) and append in the same grid. The
 * numbered page links stay in the HTML below (crawlable, and the way back without JavaScript).
 */
export function MoreProducts({
  query,
  total,
  pageSize,
  startPage,
  mode,
  layout,
  columns,
  view,
}: {
  query: string;
  total: number;
  pageSize: number;
  /** The page the server rendered. */
  startPage: number;
  mode: "load-more" | "infinite";
  layout: GridLayout;
  columns?: GridColumns;
  view: "grid" | "list";
}) {
  const { t } = useStore();
  const [items, setItems] = React.useState<ProductSummary[]>([]);
  const [ratings, setRatings] = React.useState<Record<string, { average: number; count: number }>>({});
  const [page, setPage] = React.useState(startPage);
  const [busy, setBusy] = React.useState(false);
  const [failed, setFailed] = React.useState(false);
  const sentinel = React.useRef<HTMLDivElement>(null);
  // A new query (filters / sort changed on the server) starts over.
  React.useEffect(() => {
    setItems([]);
    setRatings({});
    setPage(startPage);
  }, [query, startPage]);
  const shown = Math.min(total, startPage * pageSize + items.length);
  const more = shown < total;
  const load = React.useCallback(async () => {
    if (busy || !more) return;
    setBusy(true);
    setFailed(false);
    try {
      const sep = query ? "&" : "";
      const r = await call<SearchResult>(`/catalog/public/search?${query}${sep}limit=${pageSize}&offset=${page * pageSize}`, { auth: false });
      setItems((x) => [...x, ...r.items.filter((p) => !x.some((y) => y.id === p.id))]);
      setPage((n) => n + 1);
      if (r.items.length) {
        call<Rating[] | { items: Rating[] }>("/reviews/public/ratings", { auth: false, query: { productIds: r.items.map((p) => p.id).join(",") } })
          .then((rows) => setRatings((x) => ({ ...x, ...ratingMap(rows) })))
          .catch(() => undefined);
      }
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }, [busy, more, query, page, pageSize]);
  React.useEffect(() => {
    if (mode !== "infinite" || !more || failed) return;
    const el = sentinel.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && void load(), { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [mode, more, failed, load]);
  const list = view === "list";
  return (
    <div data-testid="more-products">
      {items.length > 0 && (
        <ul className={cn("mt-8 grid", list ? `mt-3 ${listClass(layout)}` : gridClass(layout, columns))}>
          {items.map((p) => (
            <li key={p.id}>{list ? <ProductRowView product={p} rating={ratings[p.id]} /> : <ProductCardView product={p} rating={ratings[p.id]} />}</li>
          ))}
        </ul>
      )}
      <div ref={sentinel} className="mt-10 flex flex-col items-center gap-3 text-center">
        <p className="text-sm text-muted-foreground" aria-live="polite">
          {busy ? t("list.loadingMore") : more ? t("list.showing", { shown, total }) : total > pageSize ? t("list.allLoaded") : ""}
        </p>
        {more && total > 0 && (
          <div className="h-1.5 w-48 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full rounded-full bg-primary transition-[width] duration-500" style={{ width: `${Math.round((shown / total) * 100)}%` }} />
          </div>
        )}
        {more && (mode === "load-more" || failed) && (
          <Button variant="outline" size="lg" className="h-12 min-w-48 rounded-full" onClick={() => void load()} disabled={busy} data-testid="load-more">
            {busy && <Loader2Icon className="animate-spin" />}
            {t("list.loadMore")}
          </Button>
        )}
        {busy && mode === "infinite" && <Loader2Icon className="size-5 animate-spin text-muted-foreground" aria-hidden />}
      </div>
    </div>
  );
}
