"use client";

import * as React from "react";
import Link from "next/link";
import { EyeIcon, Loader2Icon, PlusIcon, ShoppingBagIcon } from "lucide-react";
import { toast } from "@srirealtime/ui/components/sonner";
import { cn } from "@srirealtime/ui/lib/utils";
import { AnimatePresence, LayoutGroup, motion, RevealGroup, RevealItem, useReducedMotionSafe, type Variants } from "@srirealtime/ui/motion";
import { STORE_PATHS } from "@srirealtime/cms/seo";
import { imageUrl, percentOff } from "../lib/format";
import { gridCols, type GridLayout } from "../lib/grid";
import type { Product, ProductSummary } from "../types";
import { Price, Stars, StoreImage } from "../components/bits";
import { call, errorMessage } from "./api";
import { flyToCart } from "./fly-to-cart";
import { useStore } from "./store-context";
import { toastAddedToCart } from "./toasts";
import { WishlistHeart } from "./wishlist";

export interface CardRating {
  average: number;
  count: number;
}

/** Adds the only variant straight away; products with choices open the quick view instead. */
export function useQuickAdd(product: Pick<ProductSummary, "id" | "slug" | "name" | "image" | "variantCount">) {
  const { t, cart, quickView } = useStore();
  const [busy, setBusy] = React.useState(false);
  const run = async (from: Element | null) => {
    if (product.variantCount > 1) return quickView.open(product.slug);
    setBusy(true);
    try {
      const p = await call<Product>(`/catalog/public/products/${encodeURIComponent(product.slug)}`, { auth: false });
      const v = p.variants.find((x) => x.isDefault) ?? p.variants[0];
      if (!v) return quickView.open(product.slug);
      await cart.add(v.id, 1, { silent: true, productId: product.id, value: v.price });
      await flyToCart(from, imageUrl(product.image));
      toastAddedToCart({
        title: t("product.addedToCart"),
        name: product.name,
        image: product.image,
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
  return { busy, run };
}

const cardVariants: Variants = { rest: {}, hover: {} };
const liftVariants: Variants = { rest: { y: 0 }, hover: { y: -6 } };
const glowVariants: Variants = { rest: { opacity: 0 }, hover: { opacity: 1 } };
const zoomVariants: Variants = { rest: { scale: 1 }, hover: { scale: 1.06 } };
const secondVariants: Variants = { rest: { opacity: 0 }, hover: { opacity: 1 } };
const barVariants: Variants = { rest: { y: "110%", opacity: 0 }, hover: { y: 0, opacity: 1 } };

/**
 * Product tile: lifts with a brand-tinted glow on hover, the image zooms (and cross-fades to the second photo when the
 * API sends one), a quick "Add" bar slides up (always-visible round button on touch screens), wishlist heart with a
 * burst, discount ribbon and rating. The whole tile is one link (stretched title link); the buttons sit above it.
 */
export function ProductCardView({ product, rating, eager, className }: { product: ProductSummary; rating?: CardRating | null; eager?: boolean; className?: string }) {
  const { t, shell } = useStore();
  const reduced = useReducedMotionSafe();
  const pct = percentOff(product.priceMin, product.mrp);
  const href = STORE_PATHS.product(product.slug);
  const media = React.useRef<HTMLDivElement>(null);
  const { busy, run } = useQuickAdd(product);
  const second = product.images?.[1] ?? null;
  const spring = { type: "spring" as const, stiffness: 320, damping: 26 };
  const addLabel = product.variantCount > 1 ? t("product.chooseOptions") : t("product.addToCart");

  return (
    <motion.article
      className={cn("group/card relative flex h-full flex-col gap-3", className)}
      initial="rest"
      animate="rest"
      whileHover={reduced ? undefined : "hover"}
      variants={cardVariants}
      data-testid="product-card"
    >
      <motion.div variants={reduced ? undefined : liftVariants} transition={spring} className="relative">
        {/* Glow lives on its own layer and only fades (opacity), so hover never repaints the shadow. */}
        <motion.span aria-hidden variants={glowVariants} transition={{ duration: 0.25 }} className="pointer-events-none absolute inset-0 rounded-[var(--sf-radius-card)] shadow-lift" />
        <div ref={media} className="relative aspect-[4/5] overflow-hidden rounded-[var(--sf-radius-card)] bg-muted ring-1 ring-black/5 dark:ring-white/5">
          <motion.div variants={reduced ? undefined : zoomVariants} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }} className="size-full">
            <StoreImage src={product.image} alt={product.name} eager={eager} sizes="(min-width: 1280px) 20vw, (min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw" />
          </motion.div>
          {second && (
            <motion.div variants={secondVariants} transition={{ duration: 0.35 }} className="absolute inset-0" aria-hidden>
              <StoreImage src={second} alt="" sizes="(min-width: 1024px) 25vw, 50vw" />
            </motion.div>
          )}
          {pct > 0 && (
            <span className="absolute top-3 left-0 z-[2] rounded-r-full bg-sale py-1 ps-2.5 pe-3 text-[11px] font-bold tracking-wide text-white shadow-sm">
              {t("product.off", { pct })}
            </span>
          )}
          <WishlistHeart productId={product.id} size="sm" className="absolute top-2.5 right-2.5 z-[3]" />

          {shell.open && (
            <>
              {/* Desktop: a bar that slides up on hover (and stays reachable by keyboard focus). */}
              <motion.div variants={reduced ? undefined : barVariants} transition={spring} className="absolute inset-x-2.5 bottom-2.5 z-[3] hidden [@media(hover:hover)]:block focus-within:![transform:none] focus-within:!opacity-100">
                <button
                  type="button"
                  onClick={() => run(media.current)}
                  disabled={busy}
                  className="flex h-10 w-full items-center justify-center gap-2 rounded-full bg-background/95 text-sm font-semibold text-foreground shadow-[var(--elevation-2)] backdrop-blur transition-colors focus-ring hover:bg-primary hover:text-primary-foreground"
                  data-testid="quick-add"
                >
                  {busy ? <Loader2Icon className="size-4 animate-spin" /> : product.variantCount > 1 ? <EyeIcon className="size-4" /> : <ShoppingBagIcon className="size-4" />}
                  {addLabel}
                </button>
              </motion.div>
              {/* Touch: a round + button that's always there. */}
              <motion.button
                type="button"
                onClick={() => run(media.current)}
                disabled={busy}
                whileTap={reduced ? undefined : { scale: 0.88 }}
                aria-label={`${addLabel}: ${product.name}`}
                className="absolute right-2.5 bottom-2.5 z-[3] flex size-10 items-center justify-center rounded-full bg-background/95 text-foreground shadow-[var(--elevation-2)] backdrop-blur focus-ring [@media(hover:hover)]:hidden"
              >
                {busy ? <Loader2Icon className="size-4 animate-spin" /> : <PlusIcon className="size-5" />}
              </motion.button>
            </>
          )}
        </div>
      </motion.div>

      <div className="flex flex-col gap-1 px-0.5">
        {product.categoryName && <p className="truncate text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{product.categoryName}</p>}
        <h3 className="line-clamp-2 text-sm leading-snug font-medium text-foreground/90 transition-colors group-hover/card:text-foreground sm:text-[15px]">
          <Link href={href} className="outline-none after:absolute after:inset-0 after:z-[1] after:rounded-[var(--sf-radius-card)] focus-visible:after:shadow-[var(--sf-focus)]">
            {product.name}
          </Link>
        </h3>
        <Price price={product.priceMin} priceMax={product.priceMax} mrp={product.mrp} t={t} size="sm" />
        {rating && rating.count > 0 && <Stars value={rating.average} count={rating.count} t={t} />}
      </div>
    </motion.article>
  );
}

interface GridProps {
  products: ProductSummary[];
  ratings?: Record<string, CardRating>;
  eagerCount?: number;
  layout?: GridLayout;
  className?: string;
}

/** Home / collection grid: tiles stagger in as the grid scrolls into view (SSR-visible, see <RevealGroup>). */
export function RevealProductGrid({ products, ratings, eagerCount = 0, layout = "full", className }: GridProps) {
  return (
    <RevealGroup as="ul" className={cn("grid", gridCols[layout], className)} stagger={0.05}>
      {products.map((p, i) => (
        <RevealItem as="li" key={p.id}>
          <ProductCardView product={p} rating={ratings?.[p.id]} eager={i < eagerCount} />
        </RevealItem>
      ))}
    </RevealGroup>
  );
}

/**
 * Listing grid: when filters / sort change (a server navigation), tiles that stay glide to their new place, new ones
 * fade + scale in and removed ones fade out. The first render is static (server HTML stays visible).
 */
export function LiveProductGrid({ products, ratings, eagerCount = 0, layout = "sidebar", className }: GridProps) {
  const reduced = useReducedMotionSafe();
  return (
    <LayoutGroup>
      <ul className={cn("grid", gridCols[layout], className)} data-testid="product-grid">
        <AnimatePresence initial={false} mode="popLayout">
          {products.map((p, i) => (
            <motion.li
              key={p.id}
              layout={reduced ? false : "position"}
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 300, damping: 30, opacity: { duration: 0.2 } }}
            >
              <ProductCardView product={p} rating={ratings?.[p.id]} eager={i < eagerCount} />
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </LayoutGroup>
  );
}
