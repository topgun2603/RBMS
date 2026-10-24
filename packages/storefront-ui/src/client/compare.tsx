"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeftRightIcon, CheckIcon, ChevronDownIcon, ChevronUpIcon, EyeIcon, Loader2Icon, PlusIcon, ShoppingBagIcon, XIcon } from "lucide-react";
import { toast } from "@srirealtime/ui/components/sonner";
import { Switch } from "@srirealtime/ui/components/switch";
import { cn } from "@srirealtime/ui/lib/utils";
import { AnimatePresence, motion, useReducedMotionSafe } from "@srirealtime/ui/motion";
import { STORE_PATHS } from "@srirealtime/cms/seo";
import { COMPARE_EVENT, COMPARE_KEY, COMPARE_MAX, compareRows, parseCompare, removeCompare, toggleCompare, valuesDiffer, type CompareItem } from "../lib/compare";
import { money, percentOff } from "../lib/format";
import type { Availability, List, Product, Rating } from "../types";
import { Empty, Price, Stars, StoreImage } from "../components/bits";
import { call, errorMessage } from "./api";
import { flyToCart } from "./fly-to-cart";
import { useStore } from "./store-context";
import { toastAddedToCart } from "./toasts";

/*
 * Compare (theme `compare: on`): a toggle on cards and the product page, the sticky tray, and the side-by-side page.
 * The list lives in this browser only (lib/compare, localStorage); every tab stays in sync through the storage event.
 */

function readList(): CompareItem[] {
  try {
    return parseCompare(localStorage.getItem(COMPARE_KEY));
  } catch {
    return [];
  }
}

function writeList(list: CompareItem[]) {
  try {
    localStorage.setItem(COMPARE_KEY, JSON.stringify(list));
  } catch {
    /* storage blocked: the list lives for this page only */
  }
  window.dispatchEvent(new CustomEvent(COMPARE_EVENT, { detail: list }));
}

/** The compare list, kept in sync across components and tabs. Empty on the server and until mounted. */
export function useCompare() {
  const { t } = useStore();
  const [items, setItems] = React.useState<CompareItem[]>([]);
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    const load = (e?: Event) => setItems(e instanceof CustomEvent && Array.isArray(e.detail) ? (e.detail as CompareItem[]) : readList());
    load();
    setReady(true);
    window.addEventListener(COMPARE_EVENT, load);
    const onStorage = (e: StorageEvent) => e.key === COMPARE_KEY && load();
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(COMPARE_EVENT, load);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  const toggle = React.useCallback(
    (item: CompareItem) => {
      const r = toggleCompare(readList(), item);
      if (r.status === "full") {
        toast.error(t("compare.full", { max: COMPARE_MAX }));
        return r.status;
      }
      writeList(r.list);
      return r.status;
    },
    [t],
  );
  const remove = React.useCallback((id: string) => writeList(removeCompare(readList(), id)), []);
  const clear = React.useCallback(() => writeList([]), []);
  return { items, ready, has: (id: string) => items.some((x) => x.id === id), toggle, remove, clear };
}

/**
 * "Compare" toggle (aria-pressed). `card`: a small round icon button for a product tile's photo corner, next to the
 * wishlist heart — on devices that hover it stays out of the way until the tile is hovered or focused (styles.css,
 * `.sf-compare-chip`), and it shows on every tile once something is in the compare tray (or this one is picked); on
 * touch screens it is always there. `inline`: the same icon button, always visible (list rows). `page`: a full button
 * on the product page. Renders nothing when the shop has compare off.
 */
export function CompareToggle({ product, variant = "card", className }: { product: CompareItem; variant?: "card" | "inline" | "page"; className?: string }) {
  const { t, shell } = useStore();
  const { has, toggle, ready, items } = useCompare();
  if (shell.theme.compare !== "on") return null;
  const on = ready && has(product.id);
  const click = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const status = toggle(product);
    if (status === "added") toast.success(t("compare.added"), { description: product.name });
  };
  if (variant === "page") {
    return (
      <button
        type="button"
        onClick={click}
        aria-pressed={on}
        data-testid="compare-toggle"
        className={cn(
          "sf-btn inline-flex h-11 items-center gap-2 border px-4 text-sm font-semibold transition-colors focus-ring",
          on ? "border-primary bg-primary/10 text-primary" : "border-border hover:border-foreground/40",
          className,
        )}
      >
        {on ? <CheckIcon className="size-4" /> : <ArrowLeftRightIcon className="size-4" />}
        {t("compare.add")}
      </button>
    );
  }
  const label = t("compare.toggle", { name: product.name });
  return (
    <button
      type="button"
      onClick={click}
      aria-pressed={on}
      aria-label={label}
      title={t("compare.add")}
      data-testid="compare-toggle"
      // The tray has items: every tile shows its toggle, so adding the next one is one tap away.
      data-tray={ready && items.length > 0 ? "" : undefined}
      className={cn(
        "relative z-[2] flex size-9 shrink-0 items-center justify-center rounded-full border shadow-sm backdrop-blur transition-[color,background-color,border-color,opacity] duration-200 focus-ring",
        variant === "card" && "sf-compare-chip",
        on ? "border-primary bg-primary text-primary-foreground" : "bg-card/95 text-foreground/70 hover:border-primary/50 hover:text-primary",
        className,
      )}
    >
      {on ? <CheckIcon className="size-4" aria-hidden /> : <ArrowLeftRightIcon className="size-4" aria-hidden />}
    </button>
  );
}

const HIDE_TRAY = new Set(["/compare", "/checkout", "/cart"]);

/**
 * Sticky compare tray (mounted once in the layout): thumbnails with remove, empty slots, "Compare now" (from two
 * products) and clear. Desktop: a card centred at the bottom; phones: a pill bottom-left that opens the tray (lifted
 * on product pages so it never covers the buy bar). Collapsible; nothing renders while the list is empty.
 */
export function CompareTray() {
  const { t, shell } = useStore();
  const pathname = usePathname();
  const reduced = useReducedMotionSafe();
  const { items, remove, clear } = useCompare();
  const [open, setOpen] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    // Open by default on wide screens; phones start with the pill.
    setOpen(window.matchMedia("(min-width: 768px)").matches);
  }, []);
  const count = items.length;
  // A new item opens the tray once so the shopper sees where it went.
  const prev = React.useRef(count);
  React.useEffect(() => {
    if (count > prev.current) setOpen(true);
    prev.current = count;
  }, [count]);
  if (shell.theme.compare !== "on" || count === 0 || open === null || HIDE_TRAY.has(pathname)) return null;
  const lifted = pathname.startsWith("/p/");
  const canCompare = count >= 2;
  return (
    <div
      className={cn("pointer-events-none fixed inset-x-0 z-40 flex justify-start px-3 sm:px-4 md:justify-center", lifted ? "bottom-24 lg:bottom-4" : "bottom-4")}
      data-testid="compare-tray"
    >
      <AnimatePresence mode="wait" initial={false}>
        {open ? (
          <motion.section
            key="tray"
            aria-label={t("compare.tray")}
            initial={reduced ? false : { y: 24, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reduced ? undefined : { y: 24, opacity: 0 }}
            transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className="pointer-events-auto w-full max-w-3xl rounded-[var(--sf-radius-card)] border bg-background/95 p-3 text-foreground shadow-[0_18px_50px_-18px_rgb(0_0_0/0.45)] backdrop-blur sm:p-4"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="flex items-center gap-2 text-sm font-semibold">
                <ArrowLeftRightIcon className="size-4 text-primary" aria-hidden />
                <span aria-live="polite">{t("compare.count", { count })}</span>
              </p>
              <div className="flex items-center gap-1">
                <button type="button" onClick={clear} className="h-9 rounded-full px-3 text-xs font-semibold text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-ring">
                  {t("compare.clear")}
                </button>
                <button type="button" onClick={() => setOpen(false)} aria-label={t("compare.hideTray")} className="flex size-9 items-center justify-center rounded-full hover:bg-muted focus-ring">
                  <ChevronDownIcon className="size-4" />
                </button>
              </div>
            </div>
            <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-center">
              <ul className="grid flex-1 grid-cols-4 gap-2 sm:flex sm:gap-3">
                {Array.from({ length: COMPARE_MAX }, (_, i) => {
                  const it = items[i];
                  return (
                    <li key={it?.id ?? `slot-${i}`} className="min-w-0 sm:w-20">
                      {it ? (
                        <div className="group relative">
                          <Link href={STORE_PATHS.product(it.slug)} className="block overflow-hidden rounded-xl bg-muted ring-1 ring-border focus-ring" title={it.name}>
                            <span className="block aspect-square">
                              <StoreImage src={it.image} alt={it.name} />
                            </span>
                          </Link>
                          <p className="mt-1 truncate text-[11px] font-medium text-muted-foreground">{it.name}</p>
                          <button
                            type="button"
                            onClick={() => remove(it.id)}
                            aria-label={t("compare.removeItem", { name: it.name })}
                            className="absolute -top-2 -right-2 flex size-6 items-center justify-center rounded-full border bg-background text-foreground shadow-sm hover:bg-destructive hover:text-white focus-ring"
                          >
                            <XIcon className="size-3.5" />
                          </button>
                        </div>
                      ) : (
                        <span aria-hidden className="flex aspect-square items-center justify-center rounded-xl border-2 border-dashed border-border text-muted-foreground/60">
                          <PlusIcon className="size-4" />
                        </span>
                      )}
                    </li>
                  );
                })}
              </ul>
              <div className="grid gap-1 sm:w-44">
                {canCompare ? (
                  <Link href="/compare" className="sf-btn inline-flex h-11 items-center justify-center gap-2 bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/25 focus-ring" data-testid="compare-now">
                    {t("compare.now")}
                  </Link>
                ) : (
                  <span className="sf-btn inline-flex h-11 cursor-not-allowed items-center justify-center bg-muted px-4 text-sm font-semibold text-muted-foreground" aria-disabled>
                    {t("compare.now")}
                  </span>
                )}
                {!canCompare && <p className="text-center text-[11px] text-muted-foreground">{t("compare.needTwo")}</p>}
              </div>
            </div>
          </motion.section>
        ) : (
          <motion.button
            key="pill"
            type="button"
            onClick={() => setOpen(true)}
            aria-label={t("compare.showTray")}
            initial={reduced ? false : { scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={reduced ? undefined : { scale: 0.8, opacity: 0 }}
            className="pointer-events-auto inline-flex h-12 items-center gap-2 rounded-full bg-foreground px-4 text-sm font-semibold text-background shadow-lg focus-ring"
          >
            <ArrowLeftRightIcon className="size-4" />
            {t("compare.add")}
            <span className="flex size-6 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">{count}</span>
            <ChevronUpIcon className="size-4 opacity-70" />
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}

// ------------------------------------------------------------------ the compare page

type Stock = "in" | "low" | "out" | null;

function stockOf(p: Product, avail: Map<string, { inStock: boolean; lowStock: boolean }>): Stock {
  const rows = p.variants.map((v) => avail.get(v.id)).filter((x): x is { inStock: boolean; lowStock: boolean } => !!x);
  if (!rows.length) return null;
  if (!rows.some((r) => r.inStock)) return "out";
  return rows.some((r) => r.inStock && !r.lowStock) ? "in" : "low";
}

/** Add-to-cart for one column: the only variant straight away, otherwise the quick view to choose. */
function ColumnAdd({ product, stock }: { product: Product; stock: Stock }) {
  const { t, cart, quickView, shell } = useStore();
  const [busy, setBusy] = React.useState(false);
  const ref = React.useRef<HTMLButtonElement>(null);
  const single = product.variants.length === 1 ? product.variants[0]! : null;
  if (!shell.open) return null;
  if (stock === "out") return <span className="text-sm font-semibold text-destructive">{t("compare.outOfStock")}</span>;
  const add = async () => {
    if (!single) return quickView.open(product.slug);
    setBusy(true);
    try {
      await cart.add(single.id, 1, { silent: true, productId: product.id, value: single.price });
      await flyToCart(ref.current, product.images[0]?.url ?? null);
      toastAddedToCart({ title: t("product.addedToCart"), name: product.name, image: product.images[0]?.url ?? null, actionLabel: t("cart.viewCart"), closeLabel: t("common.close"), onView: () => cart.setMiniOpen(true) });
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <button ref={ref} type="button" onClick={() => void add()} disabled={busy} className="sf-btn inline-flex h-10 w-full items-center justify-center gap-2 bg-primary px-3 text-sm font-semibold text-primary-foreground focus-ring disabled:opacity-70">
      {busy ? <Loader2Icon className="size-4 animate-spin" /> : single ? <ShoppingBagIcon className="size-4" /> : <EyeIcon className="size-4" />}
      {single ? t("product.addToCart") : t("product.chooseOptions")}
    </button>
  );
}

/**
 * The side-by-side table for the products in the compare list: picture and name, price / MRP / discount, rating,
 * availability, brand, category, options and every attribute the catalogue holds. "Highlight differences" tints the
 * rows where the products differ. Phones scroll sideways with the row labels pinned on the left.
 */
export function CompareView() {
  const { t } = useStore();
  const { items, ready, remove } = useCompare();
  const [highlight, setHighlight] = React.useState(true);
  const ids = items.map((x) => x.id);
  const key = ids.join(",");
  const products = useQuery({
    queryKey: ["compare", key],
    enabled: ready && ids.length > 0,
    queryFn: () => call<{ items: Product[] }>("/catalog/public/compare", { auth: false, query: { ids: key } }),
  });
  const list = products.data?.items ?? [];
  const variantIds = list.flatMap((p) => p.variants.map((v) => v.id));
  const ratings = useQuery({
    queryKey: ["compare-ratings", key],
    enabled: list.length > 0,
    queryFn: () => call<Rating[] | { items: Rating[] }>("/reviews/public/ratings", { auth: false, query: { productIds: list.map((p) => p.id).join(",") } }).catch(() => [] as Rating[]),
  });
  const avail = useQuery({
    queryKey: ["compare-stock", variantIds.join(",")],
    enabled: variantIds.length > 0,
    queryFn: () => call<List<Availability>>("/store/availability", { auth: false, query: { itemIds: variantIds.join(",") } }).catch(() => ({ items: [], total: 0 })),
  });

  if (!ready || (ids.length > 0 && products.isPending)) {
    return (
      <div className="grid grid-cols-2 gap-4 md:grid-cols-4" aria-busy>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="grid gap-3">
            <div className="sf-shimmer aspect-square rounded-[var(--sf-radius-card)]" />
            <div className="sf-shimmer h-4 w-3/4 rounded-full" />
            <div className="sf-shimmer h-4 w-1/2 rounded-full" />
          </div>
        ))}
      </div>
    );
  }
  if (products.isError) return <Empty title={t("compare.loadError")} />;
  if (!list.length) {
    return (
      <Empty
        icon={<ArrowLeftRightIcon className="size-7" />}
        title={t("compare.empty")}
        body={t("compare.emptyHint")}
        action={
          <Link href={STORE_PATHS.products} className="sf-btn inline-flex h-11 items-center bg-primary px-6 text-sm font-semibold text-primary-foreground focus-ring">
            {t("nav.shopAll")}
          </Link>
        }
      />
    );
  }

  const rateRows = ratings.data ? (Array.isArray(ratings.data) ? ratings.data : (ratings.data.items ?? [])) : [];
  const rating = new Map(rateRows.map((r) => [r.productId, r]));
  const stockMap = new Map((avail.data?.items ?? []).map((a) => [a.itemId, a]));
  const stocks = list.map((p) => stockOf(p, stockMap));
  const specs = compareRows(list, { brand: t("compare.brand"), category: t("compare.category") });
  const def = (p: Product) => p.variants.find((v) => v.isDefault) ?? p.variants[0];
  const prices = list.map((p) => String(def(p)?.price ?? p.priceMin));
  const stockLabels = stocks.map((s) => (s === "out" ? t("compare.outOfStock") : s === "low" ? t("compare.lowStock") : s === "in" ? t("compare.inStock") : ""));
  const ratingVals = list.map((p) => String(rating.get(p.id)?.average ?? ""));
  const cols = list.length;
  const gone = ids.length > list.length;

  const row = (key: string, label: string, differs: boolean, cells: React.ReactNode[]) => (
    <tr key={key} className={cn("border-t", highlight && differs && "bg-primary/[0.06]")} data-differs={differs || undefined}>
      <th scope="row" className={cn("sticky left-0 z-[1] w-32 min-w-32 bg-background px-3 py-3 text-start align-top text-xs font-semibold text-muted-foreground sm:w-44 sm:min-w-44 sm:px-4", highlight && differs && "bg-[color-mix(in_srgb,var(--primary)_6%,var(--background))]")}>
        <span className="flex flex-col gap-1">
          {label}
          {highlight && differs && <span className="w-fit rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold text-primary uppercase">{t("compare.differs")}</span>}
        </span>
      </th>
      {cells.map((c, i) => (
        <td key={i} className="min-w-40 px-3 py-3 align-top text-sm sm:px-4">
          {c}
        </td>
      ))}
    </tr>
  );

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <label className="inline-flex cursor-pointer items-center gap-3 text-sm font-medium">
          <Switch checked={highlight} onCheckedChange={setHighlight} aria-label={t("compare.highlight")} />
          {t("compare.highlight")}
        </label>
        {cols > 2 && <p className="text-xs text-muted-foreground md:hidden">{t("compare.scrollHint")} →</p>}
      </div>
      {gone && <p className="rounded-xl bg-warning/15 px-4 py-2 text-sm text-warning-ink">{t("compare.gone")}</p>}
      <div className="-mx-4 overflow-x-auto overscroll-x-contain border-y sm:mx-0 sm:rounded-[var(--sf-radius-card)] sm:border" data-testid="compare-table">
        <table className="w-full table-fixed border-collapse" style={{ minWidth: `${176 + cols * 176}px` }}>
          <caption className="sr-only">{t("compare.title")}</caption>
          <thead>
            <tr>
              <th scope="col" className="sticky left-0 z-[1] w-32 bg-background px-3 sm:w-44 py-3 text-start align-bottom text-xs font-semibold text-muted-foreground sm:px-4">
                {t("compare.product")}
              </th>
              {list.map((p) => (
                <th key={p.id} scope="col" className="min-w-40 px-3 py-3 text-start align-top font-normal sm:px-4">
                  <div className="relative max-w-52">
                    <Link href={STORE_PATHS.product(p.slug)} className="block max-w-52 overflow-hidden rounded-xl bg-muted focus-ring">
                      <span className="block aspect-square">
                        <StoreImage src={p.images[0]?.url ?? null} alt={p.name} />
                      </span>
                    </Link>
                    <button
                      type="button"
                      onClick={() => remove(p.id)}
                      aria-label={t("compare.removeItem", { name: p.name })}
                      className="absolute top-2 right-2 flex size-8 items-center justify-center rounded-full bg-background/95 text-foreground shadow focus-ring hover:bg-destructive hover:text-white"
                    >
                      <XIcon className="size-4" />
                    </button>
                  </div>
                  <Link href={STORE_PATHS.product(p.slug)} className="mt-2 line-clamp-2 text-sm leading-snug font-semibold hover:text-primary focus-ring">
                    {p.name}
                  </Link>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {row(
              "price",
              t("compare.price"),
              valuesDiffer(prices),
              list.map((p) => {
                const v = def(p);
                const price = v?.price ?? p.priceMin;
                return (
                  <div className="grid gap-0.5">
                    <Price price={price} priceMax={p.priceMax > price ? p.priceMax : undefined} mrp={v?.mrp ?? null} t={t} />
                    {v?.mrp && percentOff(price, v.mrp) > 0 ? <span className="text-xs text-muted-foreground">{t("sections.save", { amount: money(v.mrp - price) })}</span> : null}
                  </div>
                );
              }),
            )}
            {row(
              "rating",
              t("compare.rating"),
              valuesDiffer(ratingVals),
              list.map((p) => {
                const r = rating.get(p.id);
                return r && r.count > 0 ? (
                  <span className="inline-flex items-center gap-2">
                    <Stars value={r.average} t={t} />
                    <span className="text-xs font-semibold tabular-nums">{r.average.toFixed(1)}</span>
                    <span className="text-xs text-muted-foreground">({r.count})</span>
                  </span>
                ) : (
                  <span className="text-xs text-muted-foreground">{t("compare.noRating")}</span>
                );
              }),
            )}
            {stocks.some((s) => s !== null) &&
              row(
                "stock",
                t("compare.availability"),
                valuesDiffer(stockLabels),
                stocks.map((s, i) => (
                  <span key={i} className={cn("inline-flex items-center gap-1.5 text-sm font-medium", s === "out" ? "text-destructive" : s === "low" ? "text-warning" : "text-success")}>
                    <span aria-hidden className={cn("size-2 rounded-full", s === "out" ? "bg-destructive" : s === "low" ? "bg-warning" : "bg-success")} />
                    {stockLabels[i] || "—"}
                  </span>
                )),
              )}
            {specs.map((r) => row(r.key, r.label, r.differs, r.values.map((v) => (v ? <span className="whitespace-pre-line">{v}</span> : <span className="text-muted-foreground">—</span>))))}
            <tr className="border-t">
              <th scope="row" className="sticky left-0 z-[1] bg-background px-3 py-3 sm:px-4">
                <span className="sr-only">{t("product.addToCart")}</span>
              </th>
              {list.map((p, i) => (
                <td key={p.id} className="px-3 py-3 sm:px-4">
                  <ColumnAdd product={p} stock={stocks[i] ?? null} />
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
