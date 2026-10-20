import * as React from "react";
import { cn } from "@srirealtime/ui/lib/utils";
import type { ProductSummary, Rating } from "../types";
import { gridCols, type GridLayout } from "../lib/grid";
import { LiveProductGrid, ProductCardView, RevealProductGrid, type CardRating } from "../client/product-card";

type T = (key: string, vars?: Record<string, string | number | null | undefined>) => string;

const toRatings = (ratings?: Map<string, Rating>): Record<string, CardRating> | undefined =>
  ratings ? Object.fromEntries([...ratings].map(([id, r]) => [id, { average: r.average, count: r.count }])) : undefined;

/**
 * Server-safe entry points. The tile itself is a client island (hover, quick add, wishlist); its HTML is still
 * server-rendered. `t` is accepted for backwards compatibility — the island reads strings from the store context.
 */
export function ProductCard({ product, rating, eager, className }: { product: ProductSummary; rating?: Rating | null; t?: T; eager?: boolean; className?: string }) {
  return <ProductCardView product={product} rating={rating ? { average: rating.average, count: rating.count } : null} eager={eager} className={className} />;
}

export function ProductGrid({
  products,
  ratings,
  className,
  eagerCount = 0,
  layout = "full",
  live,
}: {
  products: ProductSummary[];
  ratings?: Map<string, Rating>;
  t?: T;
  className?: string;
  eagerCount?: number;
  layout?: GridLayout;
  /** Listing pages: animate tiles when filters change instead of revealing on scroll. */
  live?: boolean;
}) {
  const Grid = live ? LiveProductGrid : RevealProductGrid;
  return <Grid products={products} ratings={toRatings(ratings)} eagerCount={eagerCount} layout={layout} className={className} />;
}

/** Skeleton grid for loading states (shimmering tiles with the same aspect ratio, so nothing jumps). */
export function ProductGridSkeleton({ count = 8, layout = "full" }: { count?: number; layout?: GridLayout }) {
  return (
    <ul className={cn("grid", gridCols[layout])} aria-hidden>
      {Array.from({ length: count }, (_, i) => (
        <li key={i} className="flex flex-col gap-3">
          <div className="sf-shimmer aspect-[var(--sf-image-ratio,4/5)] rounded-[var(--sf-radius-card)]" />
          <div className="sf-shimmer h-2.5 w-1/3 rounded-full" />
          <div className="sf-shimmer h-3.5 w-4/5 rounded-full" />
          <div className="sf-shimmer h-3.5 w-2/5 rounded-full" />
        </li>
      ))}
    </ul>
  );
}
