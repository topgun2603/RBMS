"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle2Icon, GiftIcon, Loader2Icon, PackagePlusIcon, PlusIcon, SparklesIcon, TagIcon } from "lucide-react";
import { toast } from "@srirealtime/ui/components/sonner";
import { cn } from "@srirealtime/ui/lib/utils";
import { AnimatePresence, motion, Reveal } from "@srirealtime/ui/motion";
import { STORE_PATHS } from "@srirealtime/cms/seo";
import { imageUrl, money } from "../lib/format";
import { appliedOfferText, nudgeText, sortNudges } from "../lib/offers";
import type { BundleView, CartNudge, CartProductRef, PricedCart } from "../types";
import { SectionTitle, StoreImage } from "../components/bits";
import { errorMessage } from "./api";
import { flyToCart } from "./fly-to-cart";
import { useStore } from "./store-context";
import { toastAddedToCart } from "./toasts";

/*
 * Selling tools in the cart and on product pages: applied-offer rows, "you're close" nudges with one-tap adds, the
 * free-gift prompt, and combo (bundle) blocks. Prices always come from the server (cart / promotions endpoints).
 */

/** Applied offers as discount rows (inside the totals <dl>). */
export function CartOfferRows({ cart: c }: { cart: PricedCart }) {
  const { t } = useStore();
  const offers = (c.offers ?? []).filter((o) => o.discount > 0);
  if (!offers.length) return null;
  return (
    <>
      {offers.map((o) => (
        <motion.div key={o.id} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} className="flex justify-between gap-3 text-success-ink" data-testid="offer-row">
          <dt className="flex min-w-0 items-center gap-1.5">
            <SparklesIcon aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{appliedOfferText(o)}</span>
          </dt>
          <dd className="shrink-0 tabular-nums">−{money(o.discount)}</dd>
        </motion.div>
      ))}
    </>
  );
}

function QuickAddChip({ product, onNavigate }: { product: CartProductRef; onNavigate?: () => void }) {
  const { t, cart } = useStore();
  const [busy, setBusy] = React.useState(false);
  const href = STORE_PATHS.product(product.slug);
  return (
    <li className="flex w-52 shrink-0 items-center gap-2 rounded-xl border bg-card p-1.5">
      <Link href={href} onClick={onNavigate} className="block size-11 shrink-0 overflow-hidden rounded-lg bg-muted focus-ring">
        <StoreImage src={product.image} alt={product.name} />
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={href} onClick={onNavigate} className="line-clamp-1 text-xs font-medium hover:text-primary focus-ring">
          {product.name}
        </Link>
        <span className="text-xs font-semibold tabular-nums">{money(product.price)}</span>
      </div>
      {product.variantId ? (
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await cart.add(product.variantId!, 1, { silent: true, productId: product.id, value: product.price });
            } catch (err) {
              toast.error(errorMessage(err, t));
            } finally {
              setBusy(false);
            }
          }}
          aria-label={`${t("product.addToCart")}: ${product.name}`}
          className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors hover:bg-primary hover:text-primary-foreground focus-ring"
        >
          {busy ? <Loader2Icon className="size-4 animate-spin" /> : <PlusIcon className="size-4" />}
        </button>
      ) : (
        <Link href={href} onClick={onNavigate} aria-label={`${t("product.chooseOptions")}: ${product.name}`} className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary hover:bg-primary hover:text-primary-foreground focus-ring">
          <PlusIcon className="size-4" />
        </Link>
      )}
    </li>
  );
}

/**
 * "You're close": the cart's nudges (add N more to get one free, ₹X away from a tier or a gift, complete a combo), most
 * reachable first, with one-tap adds for the products that would complete them. `limit` keeps the mini cart short.
 */
export function OfferNudges({
  cart: c,
  limit = 2,
  compact,
  skipStoreWide,
  onNavigate,
  className,
}: {
  cart: PricedCart;
  limit?: number;
  compact?: boolean;
  /** Leave store-wide "add N more" nudges to the suggestions row (mini cart). */
  skipStoreWide?: boolean;
  onNavigate?: () => void;
  className?: string;
}) {
  const { t } = useStore();
  const nudges = sortNudges(
    (c.nudges ?? []).filter(
      (n) => (n.reward.type !== "gift" || !(c.gifts ?? []).some((g) => g.offerId === n.offerId && g.unlocked)) && !(skipStoreWide && n.scope === "all" && !n.products?.length && n.reward.type !== "gift"),
    ),
  ).slice(0, limit);
  if (!nudges.length) return null;
  return (
    <section className={cn("grid gap-2", className)} aria-label={t("nudge.title")} data-testid="offer-nudges">
      <AnimatePresence initial={false}>
        {nudges.map((n) => (
          <motion.div
            key={n.offerId}
            layout
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, height: 0 }}
            className="grid gap-2 rounded-2xl border border-dashed border-primary/40 bg-primary/5 p-3"
            role="status"
          >
            <p className="flex items-start gap-2 text-sm font-medium">
              <NudgeIcon nudge={n} />
              <span className="min-w-0">
                {nudgeText(t, n)}
                {!compact && n.name && n.name !== n.label && <span className="block text-xs font-normal text-muted-foreground">{n.name}</span>}
              </span>
            </p>
            {!!n.products?.length && (
              <ul className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-0.5 scrollbar-none">
                {n.products.map((p) => (
                  <QuickAddChip key={p.id} product={p} onNavigate={onNavigate} />
                ))}
              </ul>
            )}
          </motion.div>
        ))}
      </AnimatePresence>
    </section>
  );
}

function NudgeIcon({ nudge }: { nudge: CartNudge }) {
  const Icon = nudge.reward.type === "gift" ? GiftIcon : nudge.reward.type === "bundle" ? PackagePlusIcon : TagIcon;
  return (
    <span className="icon-chip mt-px size-6 shrink-0 text-primary">
      <Icon aria-hidden className="size-3.5" />
    </span>
  );
}

/** Unlocked free gifts that aren't in the cart yet: "You've unlocked a free gift" + Add. */
export function GiftPrompt({ cart: c, className }: { cart: PricedCart; className?: string }) {
  const { t, cart } = useStore();
  const [busy, setBusy] = React.useState<string | null>(null);
  const gifts = (c.gifts ?? []).filter((g) => g.unlocked && !g.inCart && g.product);
  if (!gifts.length) return null;
  return (
    <div className={cn("grid gap-2", className)}>
      {gifts.map((g) => (
        <motion.div key={g.offerId} initial={{ opacity: 0, scale: 0.97 }} animate={{ opacity: 1, scale: 1 }} className="flex items-center gap-3 rounded-2xl border border-success/40 bg-success/8 p-3" data-testid="gift-prompt" role="status">
          <span className="block size-12 shrink-0 overflow-hidden rounded-xl bg-muted">
            <StoreImage src={g.product!.image} alt={g.product!.name} />
          </span>
          <p className="min-w-0 flex-1 text-sm font-medium text-success-ink">
            <GiftIcon aria-hidden className="me-1 inline size-4 align-[-3px]" />
            {t("gift.unlocked", { name: g.product!.name })}
          </p>
          <button
            type="button"
            disabled={busy === g.offerId}
            onClick={async () => {
              setBusy(g.offerId);
              try {
                await cart.add(g.variantId, g.qty, { silent: true, productId: g.productId, value: 0 });
                toast.success(t("gift.added"));
              } catch (err) {
                toast.error(errorMessage(err, t));
              } finally {
                setBusy(null);
              }
            }}
            className="sf-btn inline-flex h-9 shrink-0 items-center gap-1.5 bg-success px-3 text-xs font-semibold text-white focus-ring disabled:opacity-60"
          >
            {busy === g.offerId ? <Loader2Icon className="size-4 animate-spin" /> : <PlusIcon className="size-4" />}
            {t("gift.add")}
          </button>
        </motion.div>
      ))}
    </div>
  );
}

/** A cart line's offer saving ("−₹599" or FREE when the whole line is free). */
export function LineOfferTag({ discount, lineTotal }: { discount?: number; lineTotal: number }) {
  const { t } = useStore();
  if (!discount || discount <= 0) return null;
  const free = discount >= lineTotal;
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-success/12 px-2 py-0.5 text-[11px] font-semibold text-success-ink" data-testid="line-offer">
      <SparklesIcon aria-hidden className="size-3" />
      {free ? t("offer.free") : `−${money(discount)}`}
      <span className="sr-only">{t("offer.applied")}</span>
    </span>
  );
}

// ------------------------------------------------------------------ bundles

/** One combo: the items (with option pickers), combo price vs bought separately, the saving, and "Add combo". */
export function BundleCard({ bundle: b, className, headingLevel = 3 }: { bundle: BundleView; className?: string; headingLevel?: 2 | 3 }) {
  const { t, cart, shell } = useStore();
  const [picks, setPicks] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(b.items.filter((i) => !i.variantId && i.options.length === 1).map((i) => [i.productId, i.options[0]!.variantId])),
  );
  const [busy, setBusy] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const id = React.useId();
  const H = headingLevel === 2 ? "h2" : "h3";
  // Live price with the chosen options (the server re-prices in the cart).
  const unit = (i: BundleView["items"][number]) => (i.variantId ? i.price : (i.options.find((o) => o.variantId === picks[i.productId])?.price ?? i.price));
  const regular = b.items.reduce((s, i) => s + unit(i) * i.qty, 0);
  const price = b.priceType === "fixed" ? Math.min(b.value, regular) : regular - Math.round((regular * b.value) / 100);
  const save = Math.max(0, regular - price);
  const missing = b.items.filter((i) => !i.variantId && !picks[i.productId]);
  const add = async () => {
    if (missing.length) {
      toast.error(t("bundle.chooseFirst"));
      document.getElementById(`${id}-${missing[0]!.productId}`)?.focus();
      return;
    }
    setBusy(true);
    try {
      await cart.addBundle(b.id, picks, { silent: true });
      await flyToCart(ref.current, imageUrl(b.items[0]?.image ?? b.imageUrl));
      toastAddedToCart({
        title: t("bundle.added"),
        name: b.name,
        image: b.items[0]?.image ?? b.imageUrl,
        actionLabel: t("cart.viewCart"),
        closeLabel: t("common.close"),
        onView: () => cart.setMiniOpen(true),
      });
    } catch (err) {
      toast.error(errorMessage(err, t));
    } finally {
      setBusy(false);
    }
  };
  return (
    <article aria-labelledby={`${id}-title`} className={cn("grid gap-5 rounded-[var(--sf-radius-card)] border bg-card p-4 text-card-foreground shadow-xs sm:p-6 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] lg:items-center lg:gap-8", className)} data-testid="bundle-card">
      <div ref={ref} className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 scrollbar-none sm:gap-3">
        {b.items.map((i, k) => (
          <React.Fragment key={`${i.productId}-${k}`}>
            {k > 0 && <PlusIcon aria-hidden className="size-5 shrink-0 text-muted-foreground" />}
            <Link href={STORE_PATHS.product(i.slug)} className="relative block w-24 shrink-0 overflow-hidden rounded-xl bg-muted ring-1 ring-black/5 focus-ring sm:w-32" aria-label={i.name}>
              <span className="block aspect-square">
                <StoreImage src={i.image} alt="" name={i.name} />
              </span>
              {i.qty > 1 && <span className="absolute end-1.5 top-1.5 rounded-full bg-background/90 px-1.5 text-xs font-semibold tabular-nums">×{i.qty}</span>}
            </Link>
          </React.Fragment>
        ))}
      </div>
      <div className="grid gap-3">
        <div>
          <p className="text-xs font-semibold tracking-[0.14em] text-primary uppercase">{t("bundle.eyebrow")}</p>
          <H id={`${id}-title`} className="mt-1 font-display text-lg font-semibold text-balance">
            {b.name}
          </H>
          {b.description && <p className="mt-1 text-sm text-muted-foreground">{b.description}</p>}
        </div>
        <ul className="grid gap-2">
          {b.items.map((i, k) => (
            <li key={`${i.productId}-${k}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <CheckCircle2Icon aria-hidden className="size-4 shrink-0 text-success-ink" />
              <span className="min-w-0 flex-1">
                <span className="line-clamp-1 font-medium">
                  {i.qty > 1 ? `${i.qty} × ` : ""}
                  {i.name}
                </span>
                {i.variantId && i.variantTitle && <span className="block text-xs text-muted-foreground">{i.variantTitle}</span>}
              </span>
              {!i.variantId && i.options.length > 1 && (
                <>
                  <label htmlFor={`${id}-${i.productId}`} className="sr-only">
                    {t("bundle.choose", { name: i.name })}
                  </label>
                  <select
                    id={`${id}-${i.productId}`}
                    value={picks[i.productId] ?? ""}
                    onChange={(e) => setPicks((p) => ({ ...p, [i.productId]: e.target.value }))}
                    className="h-9 max-w-[10rem] rounded-lg border border-input bg-background px-2 text-sm outline-none focus:ring-[3px] focus:ring-ring/30"
                  >
                    <option value="" disabled>
                      {t("bundle.option")}
                    </option>
                    {i.options.map((o) => (
                      <option key={o.variantId} value={o.variantId}>
                        {o.title || i.name}
                      </option>
                    ))}
                  </select>
                </>
              )}
              <span className="shrink-0 font-semibold tabular-nums">{money(unit(i) * i.qty)}</span>
            </li>
          ))}
        </ul>
        <div className="flex flex-wrap items-end justify-between gap-3 border-t pt-3">
          <div className="grid">
            <span className="text-xs text-muted-foreground">
              {t("bundle.regular")} <s className="tabular-nums">{money(regular)}</s>
            </span>
            <span className="flex items-baseline gap-2">
              <span className="sr-only">{t("bundle.price")}</span>
              <span className="sf-price text-xl font-bold tabular-nums">{money(price)}</span>
              {save > 0 && <span className="rounded-full bg-success/12 px-2 py-0.5 text-xs font-semibold text-success-ink">{t("bundle.save", { amount: money(save) })}</span>}
            </span>
          </div>
          {shell.open && (
            <button
              type="button"
              onClick={() => void add()}
              disabled={busy || !b.available}
              className="sf-btn inline-flex h-11 items-center gap-2 bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/25 focus-ring disabled:opacity-60"
              data-testid="add-bundle"
            >
              {busy ? <Loader2Icon className="size-4 animate-spin" /> : <PackagePlusIcon className="size-4" />}
              {b.available ? t("bundle.add") : t("bundle.unavailable")}
            </button>
          )}
        </div>
      </div>
    </article>
  );
}

/** Product page: "Buy together and save ₹X" with the combos this product is part of. */
export function ProductBundles({ bundles }: { bundles: BundleView[] }) {
  const { t } = useStore();
  if (!bundles.length) return null;
  const best = Math.max(...bundles.map((b) => b.save));
  return (
    <Reveal as="section" className="mt-16 border-t pt-12" aria-label={t("bundle.title")} data-testid="product-bundles">
      <SectionTitle title={best > 0 ? `${t("bundle.title")} · ${t("bundle.save", { amount: money(best) })}` : t("bundle.title")} eyebrow={t("bundle.eyebrow")} href="/bundles" linkLabel={t("bundle.viewAll")} />
      <div className="grid gap-4">
        {bundles.map((b) => (
          <BundleCard key={b.id} bundle={b} />
        ))}
      </div>
    </Reveal>
  );
}

/** The combos page grid. */
export function BundleList({ bundles }: { bundles: BundleView[] }) {
  return (
    <div className="grid gap-5">
      {bundles.map((b) => (
        <BundleCard key={b.id} bundle={b} headingLevel={2} />
      ))}
    </div>
  );
}
