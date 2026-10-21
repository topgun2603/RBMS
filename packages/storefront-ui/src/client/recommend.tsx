"use client";

import * as React from "react";
import Link from "next/link";
import { CheckIcon, EyeIcon, Loader2Icon, PlusIcon, ShoppingBagIcon } from "lucide-react";
import { toast } from "@srirealtime/ui/components/sonner";
import { cn } from "@srirealtime/ui/lib/utils";
import { Reveal } from "@srirealtime/ui/motion";
import { STORE_PATHS } from "@srirealtime/cms/seo";
import { imageUrl, money } from "../lib/format";
import type { ProductSummary, Rating, Recommendations } from "../types";
import { Price, SectionTitle, StoreImage } from "../components/bits";
import { call, errorMessage } from "./api";
import { Carousel } from "./carousel";
import { flyToCart } from "./fly-to-cart";
import { ProductCardView, useQuickAdd } from "./product-card";
import { readRecent } from "./recently-viewed";
import { useStore } from "./store-context";
import { toastAddedToCart } from "./toasts";

/*
 * Recommendation blocks that need the browser: "frequently bought together" (a checkbox bundle), the cart's "you
 * might also need" (cart page and mini cart) and the home "recommended for you" (blended with this shopper's
 * recently viewed categories). Data: GET /catalog/public/recommendations (scoring in the catalogue package).
 */

const ratingMap = (rows: Rating[] | { items: Rating[] }) => {
  const list = Array.isArray(rows) ? rows : (rows.items ?? []);
  return Object.fromEntries(list.filter((r) => r.count > 0).map((r) => [r.productId, { average: r.average, count: r.count }]));
};

export interface BundleBase {
  id: string;
  slug: string;
  name: string;
  image: string | null;
  price: number;
  /** The only variant (null when the product has options to choose). */
  variantId: string | null;
}

/**
 * "Frequently bought together": this product plus up to three that were bought with it, each with a checkbox; the
 * total updates and "Add selected to cart" adds them in one go. Products with options to choose can't be added blind:
 * they show "Choose options" (quick view) instead of a checkbox.
 */
export function BoughtTogether({ base, items }: { base: BundleBase; items: ProductSummary[] }) {
  const { t, cart, quickView, shell } = useStore();
  const all = [
    { ...base, variantCount: base.variantId ? 1 : 2, self: true },
    ...items.map((p) => ({ id: p.id, slug: p.slug, name: p.name, image: p.image, price: p.priceMin, variantId: p.variantCount === 1 ? (p.variantIds?.[0] ?? null) : null, variantCount: p.variantCount, self: false })),
  ];
  const [picked, setPicked] = React.useState<Set<string>>(() => new Set(all.filter((x) => x.variantId).map((x) => x.id)));
  const [busy, setBusy] = React.useState(false);
  const ref = React.useRef<HTMLDivElement>(null);
  const chosen = all.filter((x) => x.variantId && picked.has(x.id));
  const total = chosen.reduce((s, x) => s + x.price, 0);
  const flip = (id: string) =>
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const addAll = async () => {
    if (!chosen.length) return;
    setBusy(true);
    try {
      for (const x of chosen) await cart.add(x.variantId!, 1, { silent: true, productId: x.id, value: x.price });
      await flyToCart(ref.current, imageUrl(chosen[0]!.image));
      toastAddedToCart({
        title: t("rec.added", { count: chosen.length }),
        name: chosen.map((x) => x.name).join(" + "),
        image: chosen[0]!.image,
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
    <Reveal as="section" className="mt-16 border-t pt-12" aria-labelledby="fbt-title" data-testid="bought-together">
      <SectionTitle title={t("rec.boughtTogether")} eyebrow={t("rec.boughtTogetherEyebrow")} className="[&_h2]:!scroll-mt-24" />
      <div className="grid gap-6 rounded-[var(--sf-radius-card)] border bg-card p-4 text-card-foreground shadow-xs sm:p-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] lg:items-center lg:gap-10">
        <div ref={ref} className="-mx-1 flex items-center gap-2 overflow-x-auto px-1 pb-1 scrollbar-none sm:gap-3">
          {all.map((x, i) => (
            <React.Fragment key={x.id}>
              {i > 0 && <PlusIcon aria-hidden className="size-5 shrink-0 text-muted-foreground" />}
              <Link
                href={STORE_PATHS.product(x.slug)}
                className={cn("block w-24 shrink-0 overflow-hidden rounded-xl bg-muted ring-2 transition-[opacity,box-shadow] focus-ring sm:w-32", x.variantId && picked.has(x.id) ? "ring-primary/60" : "opacity-60 ring-transparent")}
                aria-label={x.name}
              >
                <span className="block aspect-square">
                  <StoreImage src={x.image} alt="" name={x.name} />
                </span>
              </Link>
            </React.Fragment>
          ))}
        </div>
        <div className="grid gap-3">
          <ul className="grid gap-2">
            {all.map((x) => {
              const on = !!x.variantId && picked.has(x.id);
              return (
                <li key={x.id} className="flex items-center gap-3 text-sm">
                  {x.variantId ? (
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      aria-label={t("rec.pick", { name: x.name })}
                      onClick={() => flip(x.id)}
                      className={cn("flex size-5 shrink-0 items-center justify-center rounded border-2 transition-colors focus-ring", on ? "border-primary bg-primary text-primary-foreground" : "border-border")}
                    >
                      {on && <CheckIcon className="size-3.5" />}
                    </button>
                  ) : (
                    <span aria-hidden className="size-5 shrink-0 rounded border-2 border-dashed border-border" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="line-clamp-1 font-medium">
                      {x.self && <span className="me-1 font-semibold text-primary">{t("rec.thisItem")}:</span>}
                      {x.name}
                    </span>
                    {!x.variantId &&
                      (x.self ? (
                        <span className="block text-xs text-muted-foreground">{t("rec.chooseHint")}</span>
                      ) : (
                        <button type="button" onClick={() => quickView.open(x.slug)} className="inline-flex items-center gap-1 text-xs font-semibold text-primary underline-offset-4 hover:underline focus-ring">
                          <EyeIcon className="size-3.5" /> {t("rec.choose")}
                        </button>
                      ))}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">{money(x.price)}</span>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-3">
            <p className="text-sm">
              <span className="text-muted-foreground">{t("rec.total", { count: chosen.length })}: </span>
              <span className="sf-price text-lg font-bold tabular-nums">{money(total)}</span>
            </p>
            {shell.open && (
              <button
                type="button"
                onClick={() => void addAll()}
                disabled={busy || chosen.length === 0}
                className="sf-btn inline-flex h-11 items-center gap-2 bg-primary px-5 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/25 focus-ring disabled:opacity-60"
                data-testid="add-selected"
              >
                {busy ? <Loader2Icon className="size-4 animate-spin" /> : <ShoppingBagIcon className="size-4" />}
                {t("rec.addSelected")}
              </button>
            )}
          </div>
        </div>
      </div>
    </Reveal>
  );
}

/** Loads cart recommendations for the cart's products (refetches when the cart's products change). */
function useCartRecs(limit: number) {
  const { cart } = useStore();
  const ids = [...new Set((cart.cart?.lines ?? []).map((l) => l.productId))].sort();
  const key = ids.join(",");
  const [items, setItems] = React.useState<ProductSummary[]>([]);
  React.useEffect(() => {
    if (!key) {
      setItems([]);
      return;
    }
    const ctrl = new AbortController();
    call<Recommendations>("/catalog/public/recommendations", { auth: false, signal: ctrl.signal, query: { kind: "cart", productIds: key, limit } })
      .then((r) => setItems(r.items))
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [key, limit]);
  return items;
}

/** Cart page: "You might also need" as a row of product cards (nothing while the cart is empty or there are none). */
export function CartRecommendations({ className }: { className?: string }) {
  const { t } = useStore();
  const items = useCartRecs(10);
  if (!items.length) return null;
  return (
    <Reveal as="section" className={cn("mt-14 border-t pt-10", className)} aria-label={t("rec.cartTitle")} data-testid="cart-recs">
      <SectionTitle title={t("rec.cartTitle")} eyebrow={t("product.relatedEyebrow")} />
      <Carousel label={t("rec.cartTitle")}>
        {items.map((p) => (
          <ProductCardView key={p.id} product={p} />
        ))}
      </Carousel>
    </Reveal>
  );
}

function MiniRow({ product, onNavigate }: { product: ProductSummary; onNavigate?: () => void }) {
  const { t } = useStore();
  const { busy, run } = useQuickAdd(product);
  const ref = React.useRef<HTMLButtonElement>(null);
  return (
    <li className="flex w-56 shrink-0 items-center gap-3 rounded-xl border bg-card p-2">
      <Link href={STORE_PATHS.product(product.slug)} onClick={onNavigate} className="block size-14 shrink-0 overflow-hidden rounded-lg bg-muted focus-ring">
        <StoreImage src={product.image} alt={product.name} />
      </Link>
      <div className="min-w-0 flex-1">
        <Link href={STORE_PATHS.product(product.slug)} onClick={onNavigate} className="line-clamp-1 text-xs font-medium hover:text-primary focus-ring">
          {product.name}
        </Link>
        <Price price={product.priceMin} mrp={product.mrp} t={t} size="sm" className="[&_span:first-child]:text-sm" />
      </div>
      <button
        ref={ref}
        type="button"
        onClick={() => run(ref.current)}
        disabled={busy}
        aria-label={`${product.variantCount > 1 ? t("product.chooseOptions") : t("product.addToCart")}: ${product.name}`}
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary transition-colors hover:bg-primary hover:text-primary-foreground focus-ring"
      >
        {busy ? <Loader2Icon className="size-4 animate-spin" /> : product.variantCount > 1 ? <EyeIcon className="size-4" /> : <PlusIcon className="size-4" />}
      </button>
    </li>
  );
}

/** Mini cart (drawer): a compact swipe row of "You might also need" with one-tap add. */
export function MiniCartRecommendations({ onNavigate }: { onNavigate?: () => void }) {
  const { t } = useStore();
  const items = useCartRecs(6);
  if (!items.length) return null;
  return (
    <section className="border-t px-4 py-3" aria-label={t("rec.cartTitle")} data-testid="mini-cart-recs">
      <h3 className="mb-2 text-xs font-semibold tracking-wider text-muted-foreground uppercase">{t("rec.cartTitle")}</h3>
      <ul className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 scrollbar-none">
        {items.map((p) => (
          <MiniRow key={p.id} product={p} onNavigate={onNavigate} />
        ))}
      </ul>
    </section>
  );
}

/**
 * Home "recommended for you": starts with the server's list (trending / newest, crawlable), then — when this shopper
 * has recently viewed products — swaps in the list blended with those categories (their products left out).
 */
export function RecommendedShelf({ initial, limit, layout, title, eyebrow }: { initial: ProductSummary[]; limit: number; layout: "grid" | "carousel"; title: string; eyebrow: string }) {
  const { t } = useStore();
  const [items, setItems] = React.useState(initial);
  const [ratings, setRatings] = React.useState<Record<string, { average: number; count: number }>>({});
  React.useEffect(() => {
    const recent = readRecent();
    const cats = [...new Set(recent.map((r) => r.categoryId).filter((x): x is string => !!x))].slice(0, 10);
    if (!cats.length) return;
    const ctrl = new AbortController();
    call<Recommendations>("/catalog/public/recommendations", {
      auth: false,
      signal: ctrl.signal,
      query: { kind: "home", categoryIds: cats.join(","), exclude: recent.slice(0, 20).map((r) => r.id).join(","), limit },
    })
      .then((r) => {
        if (!r.items.length) return;
        setItems(r.items);
        return call<Rating[] | { items: Rating[] }>("/reviews/public/ratings", { auth: false, query: { productIds: r.items.map((p) => p.id).join(",") } }).then((rows) => setRatings(ratingMap(rows)));
      })
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [limit]);
  if (!items.length) return null;
  return (
    <>
      <SectionTitle title={title} eyebrow={eyebrow} href={STORE_PATHS.products} linkLabel={t("list.viewAll")} />
      {layout === "carousel" ? (
        <Carousel label={title}>
          {items.map((p) => (
            <ProductCardView key={p.id} product={p} rating={ratings[p.id]} />
          ))}
        </Carousel>
      ) : (
        <ul className="grid grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5 md:grid-cols-3 lg:grid-cols-4">
          {items.map((p) => (
            <li key={p.id}>
              <ProductCardView product={p} rating={ratings[p.id]} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
