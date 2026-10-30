"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertCircleIcon, BanknoteIcon, CheckCircle2Icon, Loader2Icon, MapPinIcon, ShoppingBagIcon, TruckIcon, ZapIcon } from "lucide-react";
import { Button } from "@rbms/ui/components/button";
import { toast } from "@rbms/ui/components/sonner";
import { ToggleGroup, ToggleGroupItem } from "@rbms/ui/components/toggle-group";
import { cn } from "@rbms/ui/lib/utils";
import { AnimatedNumber, AnimatePresence, motion, useReducedMotionSafe } from "@rbms/ui/motion";
import { gstRateAtPrice } from "@rbms/gst";
import { etaRange, imageUrl, money, percentOff } from "../lib/format";
import type { DeliveryQuote, PincodeInfo, Product } from "../types";
import { call, errorMessage } from "./api";
import { flyToCart } from "./fly-to-cart";
import { QtyStepper } from "./qty-stepper";
import { SizeGuideButton } from "./size-guide";
import { useStore } from "./store-context";
import { WishlistHeart } from "./wishlist";

export type AvailabilityMap = Record<string, { inStock: boolean; lowStock: boolean }>;

const matches = (vals: Record<string, string>, sel: Record<string, string>) => Object.entries(sel).every(([k, v]) => vals[k] === v);

const isSizeOption = (name: string) => /size|அளவு/i.test(name);

/**
 * Variant pickers, price, qty, add to cart / buy now, wishlist, delivery check. `compact` (quick view) drops the
 * sticky phone bar and the delivery check; `sizeGuide` (server-rendered) adds a "Size guide" dialog next to sizes;
 * `stickyBar={false}` (theme `stickyBuy: off`) keeps the phone bar away.
 */
export function PurchasePanel({
  product,
  availability,
  sizeGuide,
  compact,
  onAdded,
  stickyBar = true,
}: {
  product: Product;
  availability: AvailabilityMap;
  sizeGuide?: React.ReactNode;
  compact?: boolean;
  onAdded?: () => void;
  stickyBar?: boolean;
}) {
  const { t, cart, shell } = useStore();
  const router = useRouter();
  const reduced = useReducedMotionSafe();
  const inStock = React.useCallback((id: string) => availability[id]?.inStock ?? true, [availability]);
  const options = product.options.filter((o) => o.values.length > 0);
  const initial = React.useMemo(() => {
    const v = product.variants.find((x) => x.isDefault && inStock(x.id)) ?? product.variants.find((x) => inStock(x.id)) ?? product.variants[0];
    return v ? { ...v.optionValues } : {};
  }, [product.variants, inStock]);
  const [sel, setSel] = React.useState<Record<string, string>>(initial);
  const [qty, setQty] = React.useState(1);
  const [busy, setBusy] = React.useState<"add" | "buy" | null>(null);
  const mainRef = React.useRef<HTMLDivElement>(null);
  const [showBar, setShowBar] = React.useState(false);

  const variant = options.length ? product.variants.find((v) => options.every((o) => v.optionValues[o.name] === sel[o.name])) : product.variants[0];
  const available = !!variant && inStock(variant.id);
  const low = !!variant && availability[variant.id]?.lowStock;
  const price = variant?.price ?? product.priceMin;
  const mrp = variant?.mrp ?? null;
  const pct = percentOff(price, mrp);

  React.useEffect(() => {
    const el = mainRef.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setShowBar(!e!.isIntersecting && e!.boundingClientRect.top < 0), { threshold: 0 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  /** A value is selectable when some in-stock variant has it together with the other current selections. */
  const valueState = (name: string, value: string): "ok" | "out" | "none" => {
    const others = Object.fromEntries(Object.entries(sel).filter(([k]) => k !== name));
    const candidates = product.variants.filter((v) => v.optionValues[name] === value && matches(v.optionValues, others));
    if (!candidates.length) return "none";
    return candidates.some((v) => inStock(v.id)) ? "ok" : "out";
  };

  const pick = (name: string, value: string) => {
    const next = { ...sel, [name]: value };
    // Keep the choice valid: if no variant matches, take the first in-stock one with this value.
    if (!product.variants.some((v) => matches(v.optionValues, next))) {
      const v = product.variants.find((x) => x.optionValues[name] === value && inStock(x.id)) ?? product.variants.find((x) => x.optionValues[name] === value);
      if (v) return setSel({ ...v.optionValues });
    }
    setSel(next);
  };

  const add = async (mode: "add" | "buy", from?: Element | null) => {
    if (!variant || !available) return;
    setBusy(mode);
    try {
      await cart.add(variant.id, qty, { silent: true, productId: product.id, value: price * qty });
      if (mode === "buy") return router.push("/checkout");
      onAdded?.();
      // The product photo flies into the header bag, the badge bumps, then the mini cart slides in.
      const img = [...document.querySelectorAll("[data-gallery-main]")].find((el) => (el as HTMLElement).offsetParent !== null) ?? from;
      await flyToCart(compact ? from : img, imageUrl(product.images[0]?.url ?? null));
      cart.setMiniOpen(true);
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(null);
    }
  };

  const buttons = (bar?: boolean) => (
    <div className={cn("grid gap-2", bar ? "grid-cols-[1fr_1fr]" : "sm:grid-cols-2")}>
      <Button
        size="lg"
        variant="outline"
        className={cn("rounded-full border-primary/40 text-primary hover:bg-primary/5 hover:text-primary", bar ? "h-11 px-3 text-sm" : "h-12 text-base")}
        disabled={!available || !!busy || !shell.open}
        onClick={(e) => add("add", e.currentTarget)}
        data-testid={bar ? "add-to-cart-bar" : "add-to-cart"}
      >
        {busy === "add" ? <Loader2Icon className="animate-spin" /> : <ShoppingBagIcon />}
        {available ? (bar ? t("product.add") : t("product.addToCart")) : t("product.outOfStock")}
      </Button>
      <Button size="lg" className={cn("rounded-full bg-[image:var(--sf-gradient)]", bar ? "h-11 px-3 text-sm" : "h-12 text-base")} disabled={!available || !!busy || !shell.open} onClick={() => add("buy")} data-testid={bar ? "buy-now-bar" : "buy-now"}>
        {busy === "buy" ? <Loader2Icon className="animate-spin" /> : <ZapIcon />}
        {t("product.buyNow")}
      </Button>
    </div>
  );

  return (
    <div className="grid gap-6">
      <div>
        <div className="sf-price flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <AnimatedNumber value={price} format={(n) => money(Math.round(n))} className="font-display text-[2rem] leading-none font-semibold" data-testid="price" />
          <AnimatePresence initial={false} mode="popLayout">
            {pct > 0 && (
              <motion.span key={`${mrp}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="flex items-baseline gap-3">
                <s className="text-lg text-muted-foreground decoration-muted-foreground/60">
                  <span className="sr-only">{t("product.mrp")} </span>
                  {money(mrp)}
                </s>
                <span className="rounded-full bg-sale/12 px-2.5 py-0.5 text-sm font-bold text-sale">{t("product.off", { pct })}</span>
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <p className="mt-1 text-xs text-muted-foreground" data-testid="tax-note">
          {product.gstRule
            ? // Price-band GST (apparel / footwear): the rate depends on the selected size's price.
              t(product.taxInclusive ? "product.inclGstRate" : "product.plusGstRate", { rate: gstRateAtPrice(product.gstRule, price, product.taxInclusive) })
            : product.taxInclusive
              ? t("product.inclTax")
              : t("product.plusGst")}
        </p>
      </div>

      {options.map((o) => (
        <fieldset key={o.name}>
          <legend className="mb-2.5 flex w-full items-center justify-between gap-3 text-sm font-semibold">
            <span>
              {o.name}: <span className="font-normal text-muted-foreground">{sel[o.name] ?? t("product.selectOption", { name: o.name })}</span>
            </span>
            {sizeGuide && isSizeOption(o.name) && <SizeGuideButton>{sizeGuide}</SizeGuideButton>}
          </legend>
          <ToggleGroup
            type="single"
            value={sel[o.name] ?? ""}
            onValueChange={(v) => v && pick(o.name, v)}
            className="flex flex-wrap gap-2"
            aria-label={o.name}
          >
            {o.values.map((v) => {
              const state = valueState(o.name, v);
              const on = sel[o.name] === v;
              return (
                <ToggleGroupItem
                  key={v}
                  value={v}
                  disabled={state === "none"}
                  aria-label={state === "out" ? `${v} – ${t("product.outOfStock")}` : v}
                  className={cn(
                    "relative h-11 min-w-12 rounded-xl border bg-card px-4 text-sm font-semibold transition-[color,border-color] hover:bg-card data-[state=on]:bg-transparent",
                    on ? "border-primary text-primary-foreground data-[state=on]:text-primary-foreground" : "hover:border-foreground/40",
                    state === "out" && !on && "text-muted-foreground line-through decoration-1",
                    state === "out" && on && "opacity-75",
                    state === "none" && "cursor-not-allowed opacity-30",
                  )}
                >
                  {on && <motion.span layoutId={`${product.id}-${o.name}-pick`} className="absolute -inset-px rounded-xl bg-primary shadow-md shadow-primary/30" transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 35 }} />}
                  <span className="relative">{v}</span>
                </ToggleGroupItem>
              );
            })}
          </ToggleGroup>
        </fieldset>
      ))}

      <div className="flex flex-wrap items-center gap-4">
        <QtyStepper value={qty} max={99} onChange={setQty} disabled={!available} />
        <p className={cn("flex items-center gap-1.5 text-sm font-medium", available ? (low ? "text-warning-ink" : "text-success-ink") : "text-danger-ink")} role="status">
          {available ? <CheckCircle2Icon className="size-4" /> : null}
          {!variant ? t("product.unavailableCombo") : available ? (low ? t("product.lowStock") : t("product.inStock")) : t("product.outOfStock")}
        </p>
        <WishlistHeart productId={product.id} className="ms-auto" />
      </div>

      <div ref={mainRef}>{buttons()}</div>

      {!compact && <DeliveryCheck weightGrams={(variant?.weightGrams ?? 500) * qty} subtotal={price * qty} />}

      {/* Phone: sticky buy bar slides up once the main buttons scroll away. */}
      {!compact && stickyBar && (
        <AnimatePresence>
          {showBar && (
            <motion.div
              key="bar"
              initial={{ y: "100%" }}
              animate={{ y: 0 }}
              exit={{ y: "100%" }}
              transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 380, damping: 36 }}
              className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] shadow-[0_-8px_24px_-12px_rgb(0_0_0/0.25)] backdrop-blur lg:hidden"
              data-testid="buy-bar"
            >
              <div className="mx-auto flex max-w-lg items-center gap-3">
                <div className="min-w-0 shrink-0">
                  <AnimatedNumber value={price} format={(n) => money(Math.round(n))} className="sf-price block text-base font-bold" />
                  {variant?.title && <p className="max-w-24 truncate text-xs text-muted-foreground">{variant.title}</p>}
                </div>
                <div className="flex-1">{buttons(true)}</div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}

/** @deprecated kept for compatibility — use <WishlistHeart>. */
export function WishlistButton({ productId, className }: { productId: string; className?: string }) {
  return <WishlistHeart productId={productId} className={className} />;
}

const PIN_KEY = "sr_pincode";

/** PIN code → serviceability, ETA and COD via the public delivery quote. */
export function DeliveryCheck({ weightGrams, subtotal }: { weightGrams: number; subtotal: number }) {
  const { t, locale, shell } = useStore();
  const id = React.useId();
  const [pin, setPin] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [result, setResult] = React.useState<{ pin: string; quote: DeliveryQuote; place: PincodeInfo | null } | null>(null);

  const check = React.useCallback(
    async (p: string) => {
      if (!/^[1-9]\d{5}$/.test(p)) {
        setError(t("delivery.invalidPin"));
        return;
      }
      setError(null);
      setBusy(true);
      try {
        const [quote, place] = await Promise.all([
          call<DeliveryQuote>("/delivery/public/quote", { body: { pincode: p, weightGrams: Math.max(1, Math.round(weightGrams)), subtotal, cod: true }, auth: false }),
          call<PincodeInfo>(`/delivery/public/pincode/${p}`, { auth: false }).catch(() => null),
        ]);
        setResult({ pin: p, quote, place });
        try {
          localStorage.setItem(PIN_KEY, p);
        } catch {
          /* ignore */
        }
      } catch (err) {
        setError(errorMessage(err, t));
      } finally {
        setBusy(false);
      }
    },
    [subtotal, t, weightGrams],
  );

  React.useEffect(() => {
    try {
      const saved = localStorage.getItem(PIN_KEY);
      if (saved) {
        setPin(saved);
        void check(saved);
      }
    } catch {
      /* ignore */
    }
    // Only on mount; later checks are explicit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const best = result?.quote.options.slice().sort((a, b) => a.etaDays[0] - b.etaDays[0])[0];
  const cheapest = result?.quote.options.slice().sort((a, b) => a.amount - b.amount)[0];
  const cod = shell.codEnabled && !!result?.quote.options.some((o) => o.codAllowed);

  return (
    <section className="rounded-2xl border bg-card p-4 shadow-xs" aria-labelledby={`${id}-h`}>
      <h2 id={`${id}-h`} className="flex items-center gap-2 text-sm font-semibold">
        <TruckIcon className="size-4 text-primary" />
        {t("delivery.title")}
      </h2>
      <form
        className="mt-3 flex items-start gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void check(pin);
        }}
      >
        <label htmlFor={`${id}-pin`} className="sr-only">
          {t("delivery.pincode")}
        </label>
        <div className="relative flex-1">
          <MapPinIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            id={`${id}-pin`}
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="postal-code"
            placeholder={t("delivery.pincode")}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-pin-e` : undefined}
            className="block h-11 w-full rounded-xl border border-input bg-background ps-9 pe-3 text-sm tabular-nums tracking-wider outline-none focus:ring-[3px] focus:ring-ring/30 aria-invalid:border-destructive"
          />
        </div>
        <Button type="submit" variant="secondary" size="lg" className="rounded-xl px-5" disabled={busy}>
          {busy ? <Loader2Icon className="animate-spin" /> : t("delivery.check")}
        </Button>
      </form>
      <AnimatePresence initial={false}>
        {error && (
          <motion.p key="err" id={`${id}-pin-e`} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-2 flex items-center gap-1.5 text-sm text-danger-ink" role="alert">
            <AlertCircleIcon className="size-4" />
            {error}
          </motion.p>
        )}
      </AnimatePresence>
      <AnimatePresence initial={false} mode="wait">
      {result && !error && (
        <motion.div
          key={result.pin}
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="overflow-hidden"
        >
        <div className="mt-3 grid gap-1.5 rounded-xl bg-tint-1 p-3 text-sm" role="status" data-testid="delivery-result">
          {!result.quote.serviceable || !result.quote.options.length ? (
            <p className="text-danger-ink">{t("delivery.notServiceable", { pincode: result.pin })}</p>
          ) : (
            <>
              {result.place && <p className="text-muted-foreground">{t("delivery.deliverTo", { place: `${result.place.city}, ${result.place.state} ${result.pin}` })}</p>}
              {best && (
                <p className="flex items-center gap-1.5 font-medium">
                  <CheckCircle2Icon className="size-4 text-success-ink" />
                  {t("delivery.by", { date: etaRange(best.etaDays, locale) })}
                  {cheapest && <span className="ms-2 font-semibold text-success-ink">· {cheapest.amount === 0 ? t("delivery.free") : money(cheapest.amount)}</span>}
                </p>
              )}
              <p className={cn("flex items-center gap-1.5", cod ? "text-foreground/80" : "text-muted-foreground")}>
                <BanknoteIcon className="size-4" />
                {cod ? t("delivery.cod") : t("delivery.noCod")}
                {cod && best && best.codFee > 0 && <span className="text-xs text-muted-foreground">({t("delivery.codFee", { fee: money(best.codFee) })})</span>}
              </p>
            </>
          )}
        </div>
        </motion.div>
      )}
      </AnimatePresence>
    </section>
  );
}
