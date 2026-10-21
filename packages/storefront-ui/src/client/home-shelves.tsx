"use client";

import * as React from "react";
import Link from "next/link";
import { EyeIcon, Loader2Icon, PlusIcon, ShoppingBagIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@srirealtime/ui/components/popover";
import { cn } from "@srirealtime/ui/lib/utils";
import { useReducedMotionSafe } from "@srirealtime/ui/motion";
import { STORE_PATHS } from "@srirealtime/cms/seo";
import type { ProductSummary } from "../types";
import { Price, StoreImage } from "../components/bits";
import { Countdown } from "./home-sections";
import { useQuickAdd } from "./product-card";
import { useStore } from "./store-context";

/*
 * Interactive bits of the shelf / proof sections (pages/home-shelves.tsx renders the rest on the server): product
 * tabs, the deal's add button and countdown, shop-the-look dots, and count-up numbers.
 */

// ------------------------------------------------------------------ product tabs

/**
 * Tabs over server-rendered panels (WAI-ARIA tabs: arrow keys, Home / End). Every panel stays in the HTML (inactive
 * ones `hidden`), so crawlers and no-JS visitors still get all the products.
 */
export function ProductTabs({ id, tabs }: { id: string; tabs: { label: string; panel: React.ReactNode }[] }) {
  const [active, setActive] = React.useState(0);
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const go = (i: number) => {
    const n = (i + tabs.length) % tabs.length;
    setActive(n);
    refs.current[n]?.focus();
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight") go(active + 1);
    else if (e.key === "ArrowLeft") go(active - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(tabs.length - 1);
    else return;
    e.preventDefault();
  };
  return (
    <div>
      {tabs.length > 1 && (
        <div className="-mx-4 mb-6 overflow-x-auto px-4 scrollbar-none sm:mx-0 sm:px-0">
          <div role="tablist" aria-orientation="horizontal" className="inline-flex w-max gap-1 rounded-full border bg-card p-1" onKeyDown={onKey}>
            {tabs.map((tab, i) => (
              <button
                key={i}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`${id}-tab-${i}`}
                aria-selected={i === active}
                aria-controls={`${id}-panel-${i}`}
                tabIndex={i === active ? 0 : -1}
                onClick={() => setActive(i)}
                className={cn(
                  "h-10 rounded-full px-4 text-sm font-semibold whitespace-nowrap transition-colors focus-ring sm:px-5",
                  i === active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {tabs.map((tab, i) => (
        <div key={i} role={tabs.length > 1 ? "tabpanel" : undefined} id={`${id}-panel-${i}`} aria-labelledby={tabs.length > 1 ? `${id}-tab-${i}` : undefined} hidden={i !== active}>
          {tab.panel}
        </div>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ deal of the day

/** Countdown to `endsAt`, or (without one) to midnight in the shopper's time zone. Nothing on the server render. */
export function DealCountdown({ endsAt }: { endsAt?: string }) {
  const [end, setEnd] = React.useState<string | null>(endsAt ?? null);
  React.useEffect(() => {
    if (endsAt) return;
    const d = new Date();
    d.setHours(24, 0, 0, 0);
    setEnd(d.toISOString());
  }, [endsAt]);
  if (!end) return <div className="h-[62px]" aria-hidden />;
  return <Countdown endsAt={end} />;
}

/** The deal's big button: adds the only variant, or opens the quick view to choose. */
export function DealAdd({ product, className }: { product: ProductSummary; className?: string }) {
  const { t, shell } = useStore();
  const { busy, run } = useQuickAdd(product);
  const ref = React.useRef<HTMLButtonElement>(null);
  if (!shell.open) return null;
  return (
    <button
      ref={ref}
      type="button"
      onClick={() => run(ref.current)}
      disabled={busy}
      className={cn("sf-btn inline-flex h-12 items-center justify-center gap-2 bg-primary px-7 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/25 transition-transform hover:scale-[1.02] focus-ring active:scale-[0.98] disabled:opacity-70 motion-reduce:transition-none", className)}
      data-testid="deal-add"
    >
      {busy ? <Loader2Icon className="size-4 animate-spin" /> : product.variantCount > 1 ? <EyeIcon className="size-4" /> : <ShoppingBagIcon className="size-4" />}
      {product.variantCount > 1 ? t("product.chooseOptions") : t("product.addToCart")}
    </button>
  );
}

// ------------------------------------------------------------------ shop the look

function MiniProduct({ product, onNavigate }: { product: ProductSummary; onNavigate?: () => void }) {
  const { t } = useStore();
  const { busy, run } = useQuickAdd(product);
  const ref = React.useRef<HTMLButtonElement>(null);
  return (
    <div className="flex items-center gap-3">
      <Link href={STORE_PATHS.product(product.slug)} onClick={onNavigate} className="block size-16 shrink-0 overflow-hidden rounded-lg bg-muted focus-ring">
        <StoreImage src={product.image} alt={product.name} />
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={STORE_PATHS.product(product.slug)} onClick={onNavigate} className="line-clamp-2 text-sm leading-snug font-semibold hover:text-primary focus-ring">
          {product.name}
        </Link>
        <Price price={product.priceMin} priceMax={product.priceMax} mrp={product.mrp} t={t} size="sm" />
      </div>
      <button
        ref={ref}
        type="button"
        onClick={() => run(ref.current)}
        disabled={busy}
        aria-label={`${product.variantCount > 1 ? t("product.chooseOptions") : t("product.addToCart")}: ${product.name}`}
        className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-sm focus-ring disabled:opacity-70"
      >
        {busy ? <Loader2Icon className="size-4 animate-spin" /> : product.variantCount > 1 ? <EyeIcon className="size-4" /> : <PlusIcon className="size-4" />}
      </button>
    </div>
  );
}

/**
 * A photo with numbered dots; each opens a small card (name, price, add). The same products are listed beside the
 * photo (below it on phones), so nothing depends on finding the dots.
 */
export function LookHotspots({ imageUrl, alt, hotspots }: { imageUrl: string; alt: string; hotspots: { x: number; y: number; product: ProductSummary }[] }) {
  const { t } = useStore();
  const reduced = useReducedMotionSafe();
  const [open, setOpen] = React.useState<number | null>(null);
  return (
    <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)] lg:gap-10">
      <div className="relative overflow-hidden rounded-[var(--sf-radius-card)] bg-muted shadow-card">
        <StoreImage src={imageUrl} alt={alt} className="aspect-[4/5] h-auto sm:aspect-[4/3]" />
        {hotspots.map((h, i) => (
          <Popover key={i} open={open === i} onOpenChange={(o) => setOpen(o ? i : null)}>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label={t("sections.hotspot", { name: h.product.name })}
                className="group absolute z-[1] flex size-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-sm font-bold text-neutral-900 shadow-lg ring-4 ring-white/40 transition-transform hover:scale-110 focus-ring motion-reduce:transition-none"
                style={{ left: `${h.x}%`, top: `${h.y}%` }}
                data-testid="look-hotspot"
              >
                {!reduced && <span aria-hidden className="absolute inset-0 animate-ping rounded-full bg-white/60 [animation-duration:2.4s]" />}
                <span className="relative">{i + 1}</span>
              </button>
            </PopoverTrigger>
            <PopoverContent side="top" className="w-72 rounded-2xl p-3">
              <MiniProduct product={h.product} onNavigate={() => setOpen(null)} />
            </PopoverContent>
          </Popover>
        ))}
      </div>
      <div>
        <p className="mb-3 text-xs font-semibold tracking-[0.14em] text-muted-foreground uppercase">{t("sections.lookProducts")}</p>
        <ol className="grid gap-3">
          {hotspots.map((h, i) => (
            <li key={i} className="flex items-center gap-3 rounded-2xl border bg-card p-3 text-card-foreground shadow-xs">
              <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-bold text-background">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <MiniProduct product={h.product} />
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ stats

const fmt = (n: number, decimals: number, locale: string) => n.toLocaleString(locale === "ta" ? "ta-IN" : "en-IN", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

/**
 * A number that counts up once when it scrolls into view. The server HTML has the real value (crawlers, no JS);
 * with reduced motion, or when it's already on screen at load, it simply stays there.
 */
export function CountUp({ value, prefix = "", suffix = "", className }: { value: number; prefix?: string; suffix?: string; className?: string }) {
  const { locale } = useStore();
  const reduced = useReducedMotionSafe();
  const decimals = Number.isInteger(value) ? 0 : Math.min(2, (String(value).split(".")[1] ?? "").length);
  const [shown, setShown] = React.useState(value);
  const ref = React.useRef<HTMLSpanElement>(null);
  React.useEffect(() => {
    const el = ref.current;
    if (!el || reduced || typeof IntersectionObserver === "undefined") return;
    const r = el.getBoundingClientRect();
    if (r.top < window.innerHeight && r.bottom > 0) return;
    setShown(0);
    let raf = 0;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        io.disconnect();
        const start = performance.now();
        const step = (now: number) => {
          const p = Math.min(1, (now - start) / 1400);
          const eased = 1 - (1 - p) ** 3;
          setShown(value * eased);
          if (p < 1) raf = requestAnimationFrame(step);
        };
        raf = requestAnimationFrame(step);
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value, reduced]);
  return (
    <span ref={ref} className={className}>
      <span aria-hidden suppressHydrationWarning>
        {prefix}
        {fmt(shown, decimals, locale)}
        {suffix}
      </span>
      <span className="sr-only">
        {prefix}
        {fmt(value, decimals, locale)}
        {suffix}
      </span>
    </span>
  );
}
