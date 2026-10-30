import * as React from "react";
import { cn } from "@rbms/ui/lib/utils";
import type { ProductSummary, Rating } from "../types";
import { gridClass, gridCols, type GridColumns, type GridLayout } from "../lib/grid";
import { LiveProductGrid, ProductCardView, RevealProductGrid, type CardRating } from "../client/product-card";

type T = (key: string, vars?: Record<string, string | number | null | undefined>) => string;

const toRatings = (ratings?: Map<string, Rating>): Record<string, CardRating> | undefined =>
  ratings ? Object.fromEntries([...ratings].map(([id, r]) => [id, { average: r.average, count: r.count }])) : undefined;

/**
 * Server-safe entry points. The tile itself is a client island (hover, quick add, wishlist); its HTML is still
 * server-rendered. `t` is accepted for backwards compatibility — the island reads strings from the store context.
 */
export function ProductCard({ product, rating, eager, fresh, className }: { product: ProductSummary; rating?: Rating | null; t?: T; eager?: boolean; /** Show the "New" badge (see lib/cards freshIds). */ fresh?: boolean; className?: string }) {
  return <ProductCardView product={product} rating={rating ? { average: rating.average, count: rating.count } : null} eager={eager} fresh={fresh} className={className} />;
}

export function ProductGrid({
  products,
  ratings,
  className,
  eagerCount = 0,
  layout = "full",
  live,
  columns,
  view,
}: {
  products: ProductSummary[];
  ratings?: Map<string, Rating>;
  t?: T;
  className?: string;
  eagerCount?: number;
  layout?: GridLayout;
  /** Listing pages: animate tiles when filters change instead of revealing on scroll. */
  live?: boolean;
  /** Desktop columns (theme `listingColumns`). */
  columns?: GridColumns;
  /** Listing view (rows need `live`). */
  view?: "grid" | "list";
}) {
  if (live) return <LiveProductGrid products={products} ratings={toRatings(ratings)} eagerCount={eagerCount} layout={layout} columns={columns} view={view} className={className} />;
  return <RevealProductGrid products={products} ratings={toRatings(ratings)} eagerCount={eagerCount} layout={layout} columns={columns} className={className} />;
}

/** Skeleton grid for loading states (shimmering tiles with the same aspect ratio, so nothing jumps). */
export function ProductGridSkeleton({ count = 8, layout = "full", columns }: { count?: number; layout?: GridLayout; columns?: GridColumns }) {
  return (
    <ul className={cn("grid", columns ? gridClass(layout, columns) : gridCols[layout])} aria-hidden>
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
