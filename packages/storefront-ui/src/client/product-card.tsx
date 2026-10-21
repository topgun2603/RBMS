"use client";

import * as React from "react";
import Link from "next/link";
import { EyeIcon, Loader2Icon, PlusIcon, ShoppingBagIcon } from "lucide-react";
import type { CardBadge } from "../lib/cards";
import { toast } from "@srirealtime/ui/components/sonner";
import { cn } from "@srirealtime/ui/lib/utils";
import { AnimatePresence, LayoutGroup, motion, RevealGroup, RevealItem, useReducedMotionSafe, type Variants } from "@srirealtime/ui/motion";
import { STORE_PATHS } from "@srirealtime/cms/seo";
import { imageUrl, percentOff } from "../lib/format";
import { cardBadges, freshIds, hoverEffects } from "../lib/cards";
import { gridClass, listClass, type GridColumns, type GridLayout } from "../lib/grid";
import type { Product, ProductSummary } from "../types";
import { Price, Stars, StoreImage } from "../components/bits";
import { call, errorMessage } from "./api";
import { useCardStock } from "./card-stock";
import { CompareToggle } from "./compare";
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
const peekVariants: Variants = { rest: { opacity: 0, scale: 0.85 }, hover: { opacity: 1, scale: 1 } };

const BADGE_CLS: Record<CardBadge["kind"], string> = {
  sale: "bg-sale text-white",
  new: "bg-foreground text-background",
  low: "bg-amber-400 text-neutral-950",
  out: "bg-neutral-900/85 text-white",
};

/** Sale %, few left, new, sold out: the same ribbons on every card look (and the quick view). */
export function CardBadges({ badges, className }: { badges: CardBadge[]; className?: string }) {
  if (!badges.length) return null;
  return (
    <span className={cn("pointer-events-none absolute start-0 top-3 z-[2] flex flex-col items-start gap-1", className)}>
      {badges.map((b) => (
        <span key={b.kind} className={cn("rounded-e-full py-1 ps-2.5 pe-3 text-[11px] font-bold tracking-wide shadow-sm", BADGE_CLS[b.kind])} data-badge={b.kind}>
          {b.label}
        </span>
      ))}
    </span>
  );
}

/**
 * Product tile. Theme `card`: standard (photo over text) · minimal (no frame) · framed (bordered tile, add button
 * always shown) · overlay (text on the photo) · boxed (filled card, photo edge to edge) · editorial (big photo,
 * centred serif name). `cardHover`: rich (lift with a brand-tinted glow, zoom, cross-fade to the second photo) · zoom
 * · swap · lift · none. `cardButton`: hover (an "Add" bar slides up; a round + on touch screens; framed cards keep
 * their button) · always (a button under every card) · none. A quick-view eye sits under the wishlist heart on hover.
 * Badges (sale %, few left, new, sold out) and the rating are the same on every look. The whole tile is one link
 * (stretched title link); the buttons sit above it.
 */
export function ProductCardView({ product, rating, eager, fresh = false, className }: { product: ProductSummary; rating?: CardRating | null; eager?: boolean; fresh?: boolean; className?: string }) {
  const { t, shell, quickView } = useStore();
  const reduced = useReducedMotionSafe();
  const pct = percentOff(product.priceMin, product.mrp);
  const href = STORE_PATHS.product(product.slug);
  const media = React.useRef<HTMLDivElement>(null);
  const { busy, run } = useQuickAdd(product);
  const stock = useCardStock(product.id, product.variantIds);
  const second = product.images?.[1] ?? null;
  const spring = { type: "spring" as const, stiffness: 320, damping: 26 };
  const soldOut = stock === "out";
  const addLabel = soldOut ? t("product.outOfStock") : product.variantCount > 1 ? t("product.chooseOptions") : t("product.addToCart");
  const { card: variant, cardHover, cardButton } = shell.theme;
  const overlay = variant === "overlay";
  const framed = variant === "framed";
  const boxed = variant === "boxed";
  const editorial = variant === "editorial";
  const fx = hoverEffects(cardHover, !!second);
  const glow = fx.lift && (variant === "standard" || overlay || boxed);
  // Hover bar (and the touch +) vs a button under the card; framed cards always had theirs below.
  const buttonBelow = shell.open && !soldOut && (cardButton === "always" || (cardButton === "hover" && framed));
  const buttonOnHover = shell.open && !soldOut && cardButton === "hover" && !framed;
  const badges = cardBadges({ pct, fresh, stock }, t);

  return (
    <motion.article
      className={cn(
        "group/card relative flex h-full flex-col",
        boxed ? "gap-0 overflow-hidden rounded-[var(--sf-radius-card)] border border-border/60 bg-card text-card-foreground shadow-card" : "gap-3",
        framed && "rounded-[var(--sf-radius-card)] border bg-card p-2.5 shadow-xs",
        className,
      )}
      initial="rest"
      animate="rest"
      whileHover={reduced ? undefined : "hover"}
      // Boxed cards lift as a whole; the others lift their picture.
      variants={boxed && fx.lift && !reduced ? liftVariants : cardVariants}
      transition={spring}
      data-testid="product-card"
      data-card={variant}
    >
      <motion.div variants={reduced || !fx.lift || boxed ? undefined : liftVariants} transition={spring} className="relative">
        {/* Glow lives on its own layer and only fades (opacity), so hover never repaints the shadow. */}
        {glow && !boxed && <motion.span aria-hidden variants={glowVariants} transition={{ duration: 0.25 }} className="pointer-events-none absolute inset-0 rounded-[var(--sf-radius-card)] shadow-lift" />}
        <div
          ref={media}
          className={cn(
            "relative aspect-[var(--sf-image-ratio,4/5)] overflow-hidden bg-muted",
            variant === "minimal" || editorial
              ? "rounded-[calc(var(--radius)*0.5)]"
              : framed
                ? "rounded-[calc(var(--sf-radius-card)-0.375rem)]"
                : boxed
                  ? "rounded-none"
                  : "rounded-[var(--sf-radius-card)] ring-1 ring-black/5 dark:ring-white/5",
          )}
        >
          <motion.div variants={reduced || !fx.zoom ? undefined : zoomVariants} transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }} className={cn("size-full", soldOut && "opacity-70 grayscale-[0.6]")}>
            <StoreImage src={product.image} alt={product.name} eager={eager} sizes="(min-width: 1280px) 20vw, (min-width: 1024px) 25vw, (min-width: 768px) 33vw, 50vw" />
          </motion.div>
          {second && fx.swap && (
            <motion.div variants={secondVariants} transition={{ duration: 0.35 }} className="absolute inset-0" aria-hidden>
              <StoreImage src={second} alt="" sizes="(min-width: 1024px) 25vw, 50vw" />
            </motion.div>
          )}
          <CardBadges badges={badges} />
          <WishlistHeart productId={product.id} size="sm" className="absolute end-2.5 top-2.5 z-[3]" />
          {cardButton !== "none" && (
            // Quick view (desktop hover / keyboard focus): gallery, options and add to cart in a dialog.
            <motion.button
              type="button"
              variants={reduced ? undefined : peekVariants}
              transition={{ duration: 0.2 }}
              onClick={() => quickView.open(product.slug)}
              aria-label={`${t("product.quickView")}: ${product.name}`}
              title={t("product.quickView")}
              className="absolute end-2.5 top-[3.25rem] z-[3] hidden size-9 items-center justify-center rounded-full bg-background/95 text-foreground shadow-[var(--elevation-2)] backdrop-blur focus-ring hover:bg-primary hover:text-primary-foreground focus-visible:!opacity-100 [@media(hover:hover)]:flex"
              data-testid="quick-view-button"
            >
              <EyeIcon className="size-4" />
            </motion.button>
          )}

          {overlay && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] bg-gradient-to-t from-black/75 via-black/35 to-transparent px-3 pt-12 pb-3 pe-14 text-white">
              <p className="line-clamp-2 text-sm leading-snug font-semibold sm:text-[15px]">{product.name}</p>
              <div className="mt-0.5 text-sm font-semibold tabular-nums opacity-90 [&_*]:!text-white">
                <Price price={product.priceMin} priceMax={product.priceMax} mrp={null} t={t} size="sm" />
              </div>
            </div>
          )}

          {buttonOnHover && (
            <>
              {/* Desktop: a bar that slides up on hover (and stays reachable by keyboard focus). */}
              <motion.div
                variants={reduced ? undefined : barVariants}
                transition={spring}
                className={cn("absolute inset-x-2.5 bottom-2.5 z-[3] hidden focus-within:![transform:none] focus-within:!opacity-100", !overlay && "[@media(hover:hover)]:block")}
              >
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
                className={cn(
                  "absolute end-2.5 bottom-2.5 z-[3] flex size-10 items-center justify-center rounded-full bg-background/95 text-foreground shadow-[var(--elevation-2)] backdrop-blur focus-ring",
                  !overlay && "[@media(hover:hover)]:hidden",
                )}
              >
                {busy ? <Loader2Icon className="size-4 animate-spin" /> : <PlusIcon className="size-5" />}
              </motion.button>
            </>
          )}
        </div>
      </motion.div>

      <div className={cn("flex flex-col gap-1 px-0.5", overlay && "sr-only", boxed && "flex-1 p-3 pt-3", editorial && "items-center gap-1.5 pt-1 text-center")}>
        {product.categoryName && variant !== "minimal" && !editorial && <p className="truncate text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{product.categoryName}</p>}
        <h3
          className={cn(
            "line-clamp-2 transition-colors group-hover/card:text-foreground",
            editorial ? "font-display text-base leading-tight font-medium text-foreground sm:text-lg" : "text-sm leading-snug font-medium text-foreground/90 sm:text-[15px]",
          )}
        >
          <Link href={href} className="outline-none after:absolute after:inset-0 after:z-[1] after:rounded-[var(--sf-radius-card)] focus-visible:after:shadow-[var(--sf-focus)]">
            {product.name}
          </Link>
        </h3>
        <Price price={product.priceMin} priceMax={product.priceMax} mrp={product.mrp} t={t} size="sm" className={editorial ? "justify-center" : undefined} />
        {rating && rating.count > 0 && <Stars value={rating.average} count={rating.count} t={t} />}
      </div>
      <CompareToggle product={product} className={cn(boxed && "mx-3 mb-2", editorial && "self-center", overlay && "mt-0.5")} />
      {overlay && (
        // The stretched link of the (visually hidden) title still covers the tile; keep one visible link target for keyboards.
        <Link href={href} aria-hidden tabIndex={-1} className="absolute inset-0 z-[1] rounded-[var(--sf-radius-card)]" />
      )}
      {buttonBelow && (
        <button
          type="button"
          onClick={() => run(media.current)}
          disabled={busy}
          className={cn(
            "sf-btn relative z-[2] mt-auto flex h-9 w-full items-center justify-center gap-2 border border-primary/40 text-sm font-semibold text-primary transition-colors focus-ring hover:bg-primary hover:text-primary-foreground",
            boxed && "mx-3 mb-3 w-auto",
          )}
          data-testid="quick-add"
        >
          {busy ? <Loader2Icon className="size-4 animate-spin" /> : product.variantCount > 1 ? <EyeIcon className="size-4" /> : <PlusIcon className="size-4" />}
          {addLabel}
        </button>
      )}
    </motion.article>
  );
}

/**
 * Listing "list" view (theme `listingView` / the shopper's toggle): a row with the photo on the start side and the
 * name, price, rating and buttons beside it. Same link, badges, quick add and compare as the tile.
 */
export function ProductRowView({ product, rating, eager, fresh = false }: { product: ProductSummary; rating?: CardRating | null; eager?: boolean; fresh?: boolean }) {
  const { t, shell, quickView } = useStore();
  const pct = percentOff(product.priceMin, product.mrp);
  const href = STORE_PATHS.product(product.slug);
  const media = React.useRef<HTMLDivElement>(null);
  const { busy, run } = useQuickAdd(product);
  const stock = useCardStock(product.id, product.variantIds);
  const soldOut = stock === "out";
  const addLabel = soldOut ? t("product.outOfStock") : product.variantCount > 1 ? t("product.chooseOptions") : t("product.addToCart");
  const badges = cardBadges({ pct, fresh, stock }, t);
  return (
    <article className="group/card relative flex h-full gap-3 rounded-[var(--sf-radius-card)] border bg-card p-2.5 text-card-foreground shadow-xs transition-shadow hover:shadow-card sm:gap-4 sm:p-3" data-testid="product-card" data-card="row">
      <div ref={media} className="relative aspect-[var(--sf-image-ratio,4/5)] w-28 shrink-0 self-start overflow-hidden rounded-[calc(var(--sf-radius-card)-0.375rem)] bg-muted sm:w-36">
        <StoreImage src={product.image} alt={product.name} eager={eager} sizes="150px" className={cn(soldOut && "opacity-70 grayscale-[0.6]")} />
        <CardBadges badges={badges.slice(0, 1)} className="top-2" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-1 py-0.5">
        {product.categoryName && <p className="truncate text-[11px] font-semibold tracking-[0.08em] text-muted-foreground uppercase">{product.categoryName}</p>}
        <h3 className="line-clamp-2 text-sm leading-snug font-semibold sm:text-base">
          <Link href={href} className="outline-none after:absolute after:inset-0 after:z-[1] after:rounded-[var(--sf-radius-card)] focus-visible:after:shadow-[var(--sf-focus)]">
            {product.name}
          </Link>
        </h3>
        <Price price={product.priceMin} priceMax={product.priceMax} mrp={product.mrp} t={t} size="sm" />
        {rating && rating.count > 0 && <Stars value={rating.average} count={rating.count} t={t} />}
        <div className="mt-auto flex flex-wrap items-center gap-2 pt-2">
          {shell.open && !soldOut && (
            <button
              type="button"
              onClick={() => run(media.current)}
              disabled={busy}
              className="sf-btn relative z-[2] inline-flex h-9 items-center gap-2 bg-primary px-4 text-sm font-semibold text-primary-foreground focus-ring disabled:opacity-70"
              data-testid="quick-add"
            >
              {busy ? <Loader2Icon className="size-4 animate-spin" /> : product.variantCount > 1 ? <EyeIcon className="size-4" /> : <ShoppingBagIcon className="size-4" />}
              {addLabel}
            </button>
          )}
          <button
            type="button"
            onClick={() => quickView.open(product.slug)}
            aria-label={`${t("product.quickView")}: ${product.name}`}
            className="relative z-[2] hidden size-9 items-center justify-center rounded-full border text-foreground focus-ring hover:bg-muted sm:flex"
          >
            <EyeIcon className="size-4" />
          </button>
          <CompareToggle product={product} />
          <WishlistHeart productId={product.id} size="sm" className="relative z-[2] ms-auto" />
        </div>
      </div>
    </article>
  );
}

interface GridProps {
  products: ProductSummary[];
  ratings?: Record<string, CardRating>;
  eagerCount?: number;
  layout?: GridLayout;
  /** Desktop columns (theme `listingColumns`); default: the layout's own. */
  columns?: GridColumns;
  /** Listing view: tiles or rows. */
  view?: "grid" | "list";
  className?: string;
}

/** Home / collection grid: tiles stagger in as the grid scrolls into view (SSR-visible, see <RevealGroup>). */
export function RevealProductGrid({ products, ratings, eagerCount = 0, layout = "full", columns, className }: GridProps) {
  const fresh = freshIds(products);
  return (
    <RevealGroup as="ul" className={cn("grid", gridClass(layout, columns), className)} stagger={0.05}>
      {products.map((p, i) => (
        <RevealItem as="li" key={p.id}>
          <ProductCardView product={p} rating={ratings?.[p.id]} eager={i < eagerCount} fresh={fresh.has(p.id)} />
        </RevealItem>
      ))}
    </RevealGroup>
  );
}

/**
 * Listing grid: when filters / sort change (a server navigation), tiles that stay glide to their new place, new ones
 * fade + scale in and removed ones fade out. The first render is static (server HTML stays visible).
 */
export function LiveProductGrid({ products, ratings, eagerCount = 0, layout = "sidebar", columns, view = "grid", className }: GridProps) {
  const reduced = useReducedMotionSafe();
  const fresh = freshIds(products);
  const list = view === "list";
  return (
    <LayoutGroup>
      <ul className={cn("grid", list ? listClass(layout) : gridClass(layout, columns), className)} data-testid="product-grid" data-view={view}>
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
              {list ? (
                <ProductRowView product={p} rating={ratings?.[p.id]} eager={i < eagerCount} fresh={fresh.has(p.id)} />
              ) : (
                <ProductCardView product={p} rating={ratings?.[p.id]} eager={i < eagerCount} fresh={fresh.has(p.id)} />
              )}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </LayoutGroup>
  );
}
