"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangleIcon, ArrowRightIcon, CheckCircle2Icon, Loader2Icon, LockIcon, PartyPopperIcon, TagIcon, TicketPercentIcon, TruckIcon, XIcon } from "lucide-react";
import { Button } from "@srirealtime/ui/components/button";
import { toast } from "@srirealtime/ui/components/sonner";
import { cn } from "@srirealtime/ui/lib/utils";
import { AnimatedNumber, AnimatePresence, motion, useReducedMotionSafe } from "@srirealtime/ui/motion";
import { STORE_PATHS } from "@srirealtime/cms/seo";
import { etaRange, money } from "../lib/format";
import type { PricedCart } from "../types";
import { Empty } from "../components/bits";
import { EmptyBagArt } from "../components/illustrations";
import { PaymentIcons } from "../components/trust";
import { errorMessage } from "./api";
import { CartLineRow } from "./cart-lines";
import { useStore } from "./store-context";

export function couponMessage(t: (k: string) => string, reason: string | undefined): string {
  if (!reason) return t("coupon.generic");
  const key = `coupon.${reason}`;
  const v = t(key);
  return v === key ? reason : v;
}

export function CartView() {
  const { t, cart, shell } = useStore();
  const c = cart.cart;
  if (!cart.ready && !c) return <CartSkeleton />;
  if (!c || c.lines.length === 0) {
    return (
      <Empty
        className="mx-auto max-w-lg"
        illustration={<EmptyBagArt />}
        title={t("cart.empty")}
        body={t("cart.emptyHint")}
        action={
          <Button asChild size="lg" className="rounded-full px-8">
            <Link href={STORE_PATHS.products}>{t("cart.startShopping")}</Link>
          </Button>
        }
      />
    );
  }
  const blocked = c.lines.some((l) => !l.available || l.problem === "qty_reduced");
  const goods = c.subtotal - c.discount;
  const belowMin = shell.minOrderValue > 0 && goods < shell.minOrderValue;
  const savings = c.lines.reduce((s, l) => s + (l.available && l.mrp && l.mrp > l.price ? (l.mrp - l.price) * l.qty : 0), 0) + c.discount;

  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px] lg:gap-12">
      <div className="min-w-0">
        <CartWarnings cart={c} />
        <ul className="divide-y overflow-x-hidden border-y">
          <AnimatePresence initial={false} mode="popLayout">
            {c.lines.map((l) => (
              <CartLineRow key={l.variantId} line={l} />
            ))}
          </AnimatePresence>
        </ul>
        <Link href={STORE_PATHS.products} className="mt-5 inline-flex items-center gap-1 text-sm font-semibold text-primary hover:underline">
          ← {t("cart.continue")}
        </Link>
      </div>

      <aside className="lg:sticky lg:top-24 lg:self-start" aria-label={t("checkout.summary")}>
        <div className="grid gap-5 rounded-3xl border bg-card p-5 shadow-[var(--elevation-1)] sm:p-6">
          <FreeShippingMeter cart={c} />
          <CouponForm cart={c} />
          <DeliveryOptions cart={c} />
          <Totals cart={c} />
          <AnimatePresence initial={false}>
            {savings > 0 && (
              <motion.p
                key="savings"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                className="-mt-2 flex items-center justify-center gap-1.5 rounded-xl bg-success/10 px-3 py-2 text-center text-sm font-semibold text-success-ink"
              >
                <PartyPopperIcon className="size-4" />
                {t("cart.savings", { amount: money(savings) })}
              </motion.p>
            )}
          </AnimatePresence>
          {belowMin && <p className="text-sm text-warning-ink">{t("cart.minOrder", { amount: money(shell.minOrderValue) })}</p>}
          <Button asChild size="lg" className={cn("h-12 rounded-full text-base", (blocked || belowMin || !shell.open) && "pointer-events-none opacity-50")}>
            <Link href="/checkout" aria-disabled={blocked || belowMin || !shell.open} data-testid="checkout-button">
              <LockIcon />
              {t("cart.checkout")}
              <ArrowRightIcon />
            </Link>
          </Button>
          <PaymentIcons t={t} cod={shell.codEnabled} className="justify-center" />
        </div>
      </aside>
    </div>
  );
}

function CartSkeleton() {
  return (
    <div className="grid gap-8 lg:grid-cols-[1fr_380px]" aria-busy>
      <div className="grid gap-4">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex gap-4">
            <div className="size-24 sf-shimmer rounded-xl" />
            <div className="grid flex-1 content-start gap-2">
              <div className="h-4 w-2/3 sf-shimmer rounded" />
              <div className="h-3 w-1/4 sf-shimmer rounded" />
            </div>
          </div>
        ))}
      </div>
      <div className="h-72 sf-shimmer rounded-3xl" />
    </div>
  );
}

export function CartWarnings({ cart }: { cart: PricedCart }) {
  const { t } = useStore();
  const w = cart.warnings.filter((x) => x !== "coupon_invalid");
  if (!w.length) return null;
  return (
    <ul className="mb-4 grid gap-2">
      {w.map((x) => (
        <li key={x} className="flex items-start gap-2 rounded-xl bg-warning/12 px-3 py-2.5 text-sm text-warning-ink">
          <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" />
          {t(`cart.warning.${x}`)}
        </li>
      ))}
    </ul>
  );
}

export function CouponForm({ cart: c }: { cart: PricedCart }) {
  const { t, cart } = useStore();
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [shake, setShake] = React.useState(0);
  const id = React.useId();
  const fail = (msg: string) => {
    setError(msg);
    setShake((n) => n + 1);
    toast.error(msg);
  };
  return (
    <AnimatePresence initial={false} mode="wait">
      {c.coupon ? (
        <motion.div
          key="applied"
          initial={{ opacity: 0, y: 8, scale: 0.97 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.97 }}
          transition={{ type: "spring", stiffness: 420, damping: 30 }}
          className={cn("flex items-center gap-3 rounded-2xl border border-dashed p-3", c.coupon.valid ? "border-success/50 bg-success/5" : "border-destructive/40 bg-destructive/5")}
          data-testid="coupon-status"
        >
          <motion.span initial={{ rotate: -30, scale: 0.4 }} animate={{ rotate: 0, scale: 1 }} transition={{ type: "spring", stiffness: 500, damping: 15, delay: 0.05 }} className="flex">
            <TicketPercentIcon className={cn("size-5 shrink-0", c.coupon.valid ? "text-success-ink" : "text-danger-ink")} />
          </motion.span>
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold">{c.coupon.valid ? t("cart.couponApplied", { code: c.coupon.code }) : c.coupon.code}</p>
            {!c.coupon.valid && <p className="text-xs text-danger-ink">{couponMessage(t, c.coupon.reason)}</p>}
            {c.coupon.valid && c.coupon.freeShipping && <p className="text-xs text-success-ink">{t("cart.freeShipping")}</p>}
          </div>
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await cart.removeCoupon();
              } catch (err) {
                toast.error(errorMessage(err, t));
              } finally {
                setBusy(false);
              }
            }}
            className="flex size-8 items-center justify-center rounded-full hover:bg-accent focus-ring"
            aria-label={t("cart.removeCoupon")}
          >
            {busy ? <Loader2Icon className="size-4 animate-spin" /> : <XIcon className="size-4" />}
          </button>
        </motion.div>
      ) : (
        <motion.form
          key="form"
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          className="grid gap-1.5"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!code.trim()) return;
            setBusy(true);
            setError(null);
            try {
              const r = await cart.applyCoupon(code.trim().toUpperCase());
              if (r?.coupon && !r.coupon.valid) fail(couponMessage(t, r.coupon.reason));
              else if (r?.coupon?.valid) toast.success(t("cart.couponApplied", { code: r.coupon.code }));
              setCode("");
            } catch (err) {
              const reason = (err as { details?: { reason?: string } }).details?.reason;
              fail(reason ? couponMessage(t, reason) : errorMessage(err, t));
            } finally {
              setBusy(false);
            }
          }}
        >
          <div key={shake} className={cn("flex items-start gap-2", shake > 0 && "sf-shake")}>
            <label htmlFor={id} className="sr-only">
              {t("cart.coupon")}
            </label>
            <div className="relative flex-1">
              <TagIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id={id}
                value={code}
                onChange={(e) => {
                  setCode(e.target.value);
                  setError(null);
                }}
                placeholder={t("cart.coupon")}
                autoCapitalize="characters"
                aria-invalid={!!error}
                aria-describedby={error ? `${id}-err` : undefined}
                className="block h-11 w-full rounded-xl border border-input bg-background ps-9 pe-3 text-sm font-medium uppercase outline-none transition-[border-color,box-shadow] placeholder:normal-case focus:ring-[3px] focus:ring-ring/30 aria-[invalid=true]:border-destructive"
                data-testid="coupon-input"
              />
            </div>
            <Button type="submit" variant="secondary" size="lg" className="rounded-xl px-5" disabled={busy || !code.trim()}>
              {busy ? <Loader2Icon className="animate-spin" /> : t("cart.applyCoupon")}
            </Button>
          </div>
          <AnimatePresence>
            {error && (
              <motion.p id={`${id}-err`} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="text-xs font-medium text-danger-ink" role="alert">
                {error}
              </motion.p>
            )}
          </AnimatePresence>
        </motion.form>
      )}
    </AnimatePresence>
  );
}

/**
 * "Add ₹X more for free delivery" with a progress bar, when the delivery quote tells us the free-shipping threshold
 * (options carry `freeAbove`) or a free-shipping coupon is applied. Renders nothing while the threshold is unknown.
 */
export function FreeShippingMeter({ cart: c, className }: { cart: PricedCart; className?: string }) {
  const { t } = useStore();
  const reduced = useReducedMotionSafe();
  const goods = c.subtotal - c.discount;
  const thresholds = (c.delivery?.options ?? []).map((o) => o.freeAbove).filter((n): n is number => typeof n === "number" && n > 0);
  const freeAbove = thresholds.length ? Math.min(...thresholds) : null;
  // A serviceable quote whose cheapest option is ₹0 also means delivery is free for this cart.
  const quotedFree = !!c.delivery?.serviceable && (c.delivery.options.length ?? 0) > 0 && Math.min(...c.delivery.options.map((o) => o.amount)) === 0;
  const unlocked = (!!c.coupon?.valid && c.coupon.freeShipping) || (freeAbove !== null && goods >= freeAbove) || quotedFree;
  if (!unlocked && freeAbove === null) return null;
  const pct = unlocked ? 1 : Math.max(0.04, goods / (freeAbove ?? 1));
  return (
    <div className={cn("grid gap-2", className)} data-testid="free-shipping">
      <p className={cn("flex items-center gap-2 text-sm font-medium", unlocked ? "text-success-ink" : "text-foreground/85")}>
        {unlocked ? <CheckCircle2Icon className="size-4 shrink-0" /> : <TruckIcon className="size-4 shrink-0 text-primary" />}
        {unlocked ? t("cart.freeUnlocked") : t("cart.freeMore", { amount: money((freeAbove ?? 0) - goods) })}
      </p>
      <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-label={t("cart.freeProgress")} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct * 100)}>
        <motion.div
          className={cn("h-full origin-left rounded-full", unlocked ? "bg-success" : "bg-[image:var(--sf-gradient)]")}
          initial={false}
          animate={{ scaleX: pct }}
          transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 120, damping: 20 }}
        />
      </div>
    </div>
  );
}

function DeliveryOptions({ cart: c }: { cart: PricedCart }) {
  const { t, cart, locale } = useStore();
  const [pin, setPin] = React.useState(c.pincode ?? "");
  const [busy, setBusy] = React.useState(false);
  const id = React.useId();
  return (
    <div className="grid gap-2">
      <form
        className="flex items-start gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (!/^[1-9]\d{5}$/.test(pin)) return toast.error(t("delivery.invalidPin"));
          setBusy(true);
          try {
            await cart.setPincode(pin);
          } catch (err) {
            toast.error(errorMessage(err, t));
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor={id} className="sr-only">
          {t("delivery.pincode")}
        </label>
        <input id={id} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" placeholder={t("delivery.pincode")} className="h-11 flex-1 rounded-xl border border-input bg-background px-3 text-sm tabular-nums outline-none focus:ring-[3px] focus:ring-ring/30" />
        <Button type="submit" variant="secondary" size="lg" className="rounded-xl px-5" disabled={busy}>
          {busy ? <Loader2Icon className="animate-spin" /> : t("delivery.check")}
        </Button>
      </form>
      <AnimatePresence initial={false}>
      {c.delivery && (
        <motion.div key={c.pincode ?? "d"} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden text-sm">
          {!c.delivery.serviceable || !c.delivery.options.length ? (
            <p className="text-danger-ink">{t("delivery.notServiceable", { pincode: c.pincode ?? "" })}</p>
          ) : (
            <ul className="grid gap-1">
              {c.delivery.options.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2 text-foreground/80">
                  <span>
                    {o.name} · <span className="text-muted-foreground">{etaRange(o.etaDays, locale)}</span>
                  </span>
                  <span className="font-semibold tabular-nums">{o.amount === 0 || c.coupon?.freeShipping ? t("delivery.free") : money(o.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </motion.div>
      )}
      </AnimatePresence>
    </div>
  );
}

export function Totals({ cart: c, shipping, codFee }: { cart: PricedCart; shipping?: number | null; codFee?: number }) {
  const { t } = useStore();
  const tax = c.taxExtra ?? 0;
  const ship = shipping ?? null;
  const total = c.total + tax + (ship ?? 0) + (codFee ?? 0);
  return (
    <dl className="grid gap-2 text-sm">
      <div className="flex justify-between">
        <dt className="text-muted-foreground">
          {t("cart.subtotal")} <span className="text-xs">({t("cart.items", { count: c.itemCount })})</span>
        </dt>
        <dd className="tabular-nums">
          <AnimatedNumber value={c.subtotal} format={(n) => money(Math.round(n))} />
        </dd>
      </div>
      {c.discount > 0 && (
        <motion.div initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} className="flex justify-between text-success-ink">
          <dt>
            {t("cart.discount")}
            {c.coupon?.valid ? ` (${c.coupon.code})` : ""}
          </dt>
          <dd className="tabular-nums">−{money(c.discount)}</dd>
        </motion.div>
      )}
      {tax > 0 && (
        <div className="flex justify-between">
          <dt className="text-muted-foreground">{t("cart.gstExtra")}</dt>
          <dd className="tabular-nums">{money(tax)}</dd>
        </div>
      )}
      <div className="flex justify-between">
        <dt className="text-muted-foreground">{t("cart.shipping")}</dt>
        <dd className={cn("tabular-nums", ship === 0 && "font-semibold text-success-ink")}>{ship === null ? <span className="text-xs text-muted-foreground">{t("cart.shippingAtCheckout")}</span> : ship === 0 ? t("delivery.free") : money(ship)}</dd>
      </div>
      {codFee ? (
        <div className="flex justify-between">
          <dt className="text-muted-foreground">{t("checkout.codFee")}</dt>
          <dd className="tabular-nums">{money(codFee)}</dd>
        </div>
      ) : null}
      <div className="mt-1 flex items-baseline justify-between border-t pt-3">
        <dt className="font-semibold">{t("cart.total")}</dt>
        <dd className="sf-price font-display text-2xl font-semibold" data-testid="cart-total">
          <AnimatedNumber value={total} format={(n) => money(Math.round(n))} />
        </dd>
      </div>
    </dl>
  );
}
