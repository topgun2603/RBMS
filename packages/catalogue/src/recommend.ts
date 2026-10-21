import { z } from "zod";

/**
 * Store recommendations (`GET /public/recommendations`), pure scoring. The service gathers a candidate pool (active
 * store products) and, when the host wires order data, purchase signals; these functions only rank ids.
 *
 * - product: "frequently bought together" = co-purchase counts in paid orders (empty without order data);
 *   "you may also like" = similarity (same / sibling category, price band, shared collection, tags, brand) plus a
 *   small trending boost, topped up with trending / newest products so small catalogues still fill a row.
 * - cart: co-purchases of everything in the cart first, then products similar to the cart items; never cart items.
 * - home: trending (recent paid orders) blended with the categories the shopper viewed (most recent weighs most),
 *   with a freshness nudge; a new shop without orders or history gets its newest products.
 *
 * Stock: the service ranks `REC_STOCK_SLACK`× more ids than it shows and, when the host wires availability
 * (inventory), `preferInStock` keeps the in-stock ones first — sold-out products only fill a row that would otherwise
 * be short, at its end.
 */

/** Rank this many times the requested limit, so sold-out products can drop off the end (see `preferInStock`). */
export const REC_STOCK_SLACK = 2;

/**
 * In-stock ids first (in their ranked order), then the sold-out ones, cut to `limit`. `inStock` null = stock unknown
 * (no inventory port, or it failed): the ranked order as is.
 */
export function preferInStock(ids: readonly string[], inStock: ReadonlySet<string> | null, limit: number): string[] {
  if (!inStock) return ids.slice(0, limit);
  return [...ids.filter((id) => inStock.has(id)), ...ids.filter((id) => !inStock.has(id))].slice(0, limit);
}

export const RECOMMENDATION_KINDS = ["product", "cart", "home", "bestsellers", "sale"] as const;
export type RecommendationKind = (typeof RECOMMENDATION_KINDS)[number];

const uuid = z.string().uuid();
const idList = (max: number) =>
  z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => (v === undefined ? [] : (Array.isArray(v) ? v : [v]).flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean)))
    .pipe(z.array(uuid).max(max))
    .transform((ids) => [...new Set(ids)]);

/** `kind`, the anchor products (`productIds`: the product, or the cart's products), viewed `categoryIds`, `exclude`, `limit`. */
export const recommendationQuerySchema = z.object({
  kind: z.enum(RECOMMENDATION_KINDS).default("home"),
  productIds: idList(50),
  categoryIds: idList(20),
  exclude: idList(50),
  limit: z.coerce.number().int().min(1).max(24).default(8),
});
export type RecommendationQuery = z.input<typeof recommendationQuerySchema>;

/** What scoring knows about a product. `price` = cheapest live variant (paise). */
export interface RecCandidate {
  id: string;
  categoryId: string | null;
  brand: string | null;
  tags: readonly string[];
  price: number;
  createdAt: Date | string;
  /** Manual collections the product is in. */
  collections?: readonly string[];
}

export interface RecSignals {
  /** Paid orders per product in the recent window ("trending" / best sellers). */
  sales?: ReadonlyMap<string, number>;
  /** Paid orders that also held the anchor products. */
  together?: ReadonlyMap<string, number>;
}

export interface RecContext {
  /** Parent of a category (null for top level / unknown): siblings count as related. */
  parentOf?: (categoryId: string) => string | null;
  now?: Date;
}

export const REC_WEIGHTS = {
  sameCategory: 4,
  siblingCategory: 1.5,
  /** At the same price; falls to 0 at half / double the price. */
  price: 2,
  collection: 1.5,
  tag: 0.5,
  maxTags: 2,
  brand: 1,
  /** Trending boost on top of similarity (0–1 × this). */
  trend: 1,
  /** Home: trending (0–1 × this). */
  homeTrend: 2,
  /** Home: the most recently viewed category (older ones decay by `viewDecay`). */
  viewedCategory: 3,
  viewDecay: 0.7,
  /** New in the last `freshDays`, fading to 0. */
  fresh: 0.6,
  freshDays: 60,
} as const;

const DAY = 86_400_000;
const time = (d: Date | string) => (d instanceof Date ? d.getTime() : Date.parse(d));

/** 1 at the same price, 0 at half or double (log scale); 0 when either price is unknown. */
export function priceAffinity(a: number, b: number): number {
  if (!(a > 0) || !(b > 0)) return 0;
  return Math.max(0, 1 - Math.abs(Math.log(b / a)) / Math.LN2);
}

/** 0–1: how a product's recent sales compare to the best seller (log scale, so one hit doesn't flatten the rest). */
export function trendScore(sales: number | undefined, maxSales: number): number {
  if (!sales || !(maxSales > 0)) return 0;
  return Math.log1p(sales) / Math.log1p(maxSales);
}

/** 0–1: how new a product is (1 today, 0 after `freshDays`). */
export function freshness(createdAt: Date | string, now: Date = new Date()): number {
  const age = (now.getTime() - time(createdAt)) / DAY;
  if (!Number.isFinite(age)) return 0;
  return Math.max(0, Math.min(1, 1 - age / REC_WEIGHTS.freshDays));
}

/** How much `c` is like `anchor` (0 = nothing in common). */
export function similarityScore(anchor: RecCandidate, c: RecCandidate, ctx: RecContext = {}): number {
  let s = 0;
  if (anchor.categoryId && c.categoryId) {
    if (anchor.categoryId === c.categoryId) s += REC_WEIGHTS.sameCategory;
    else {
      const pa = ctx.parentOf?.(anchor.categoryId) ?? null;
      const pc = ctx.parentOf?.(c.categoryId) ?? null;
      // Siblings, or one is the other's parent.
      if ((pa && pa === pc) || pa === c.categoryId || pc === anchor.categoryId) s += REC_WEIGHTS.siblingCategory;
    }
  }
  s += REC_WEIGHTS.price * priceAffinity(anchor.price, c.price);
  const cols = new Set(anchor.collections ?? []);
  if (cols.size && (c.collections ?? []).some((x) => cols.has(x))) s += REC_WEIGHTS.collection;
  const tags = new Set(anchor.tags.map((t) => t.toLowerCase()));
  const shared = c.tags.filter((t) => tags.has(t.toLowerCase())).length;
  s += Math.min(REC_WEIGHTS.maxTags, shared * REC_WEIGHTS.tag);
  if (anchor.brand && c.brand && anchor.brand.toLowerCase() === c.brand.toLowerCase()) s += REC_WEIGHTS.brand;
  return s;
}

const maxOf = (m: ReadonlyMap<string, number> | undefined) => Math.max(0, ...(m ? [...m.values()] : []));

/** Highest score first; ties: newer first, then id (stable output). */
function ordered(scored: { c: RecCandidate; score: number }[]): string[] {
  return scored
    .sort((a, b) => b.score - a.score || time(b.c.createdAt) - time(a.c.createdAt) || (a.c.id < b.c.id ? -1 : 1))
    .map((x) => x.c.id);
}

/** Tops `ids` up to `limit` with the rest of the pool by trend + freshness (so a row is never half empty). */
function topUp(ids: string[], pool: readonly RecCandidate[], skip: ReadonlySet<string>, signals: RecSignals, limit: number, now: Date): string[] {
  if (ids.length >= limit) return ids.slice(0, limit);
  const taken = new Set([...ids, ...skip]);
  const max = maxOf(signals.sales);
  const rest = ordered(
    pool.filter((c) => !taken.has(c.id)).map((c) => ({ c, score: trendScore(signals.sales?.get(c.id), max) * REC_WEIGHTS.homeTrend + freshness(c.createdAt, now) * REC_WEIGHTS.fresh })),
  );
  return [...ids, ...rest].slice(0, limit);
}

/** Ids by co-purchase count (most first), without `skip`. Empty when there's no order data. */
export function rankTogether(together: ReadonlyMap<string, number> | undefined, skip: ReadonlySet<string>, limit: number, pool?: ReadonlySet<string>): string[] {
  if (!together) return [];
  return [...together]
    .filter(([id, n]) => n > 0 && !skip.has(id) && (!pool || pool.has(id)))
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, limit)
    .map(([id]) => id);
}

/** "You may also like" for one product: similar first (with a trending nudge), then trending / newest. */
export function rankSimilar(anchor: RecCandidate, pool: readonly RecCandidate[], signals: RecSignals, opts: RecContext & { limit: number; skip?: ReadonlySet<string> }): string[] {
  const skip = new Set([anchor.id, ...(opts.skip ?? [])]);
  const max = maxOf(signals.sales);
  const now = opts.now ?? new Date();
  const scored = pool
    .filter((c) => !skip.has(c.id))
    .map((c) => ({ c, sim: similarityScore(anchor, c, opts) }))
    // Price alone (a different category at a similar price) isn't "similar".
    .filter((x) => x.sim > REC_WEIGHTS.price)
    .map(({ c, sim }) => ({ c, score: sim + trendScore(signals.sales?.get(c.id), max) * REC_WEIGHTS.trend }));
  return topUp(ordered(scored), pool, skip, signals, opts.limit, now);
}

/** Cart: bought with the cart's items, then like them (best match to any item), then trending; never what's in the cart. */
export function rankForCart(cart: readonly RecCandidate[], pool: readonly RecCandidate[], signals: RecSignals, opts: RecContext & { limit: number; skip?: ReadonlySet<string> }): string[] {
  const skip = new Set([...cart.map((c) => c.id), ...(opts.skip ?? [])]);
  const now = opts.now ?? new Date();
  const together = rankTogether(signals.together, skip, opts.limit, new Set(pool.map((c) => c.id)));
  const taken = new Set([...skip, ...together]);
  const max = maxOf(signals.sales);
  const similar = cart.length
    ? ordered(
        pool
          .filter((c) => !taken.has(c.id))
          .map((c) => ({ c, sim: Math.max(...cart.map((a) => similarityScore(a, c, opts))) }))
          .filter((x) => x.sim > REC_WEIGHTS.price)
          .map(({ c, sim }) => ({ c, score: sim + trendScore(signals.sales?.get(c.id), max) * REC_WEIGHTS.trend })),
      )
    : [];
  return topUp([...together, ...similar], pool, skip, signals, opts.limit, now);
}

/**
 * Home "recommended for you": trending + affinity to the viewed categories (`viewed`, most recent first; a sub- or
 * parent category of a viewed one counts half) + freshness. Without sales or views this is simply newest first.
 */
export function rankForHome(pool: readonly RecCandidate[], signals: RecSignals, viewed: readonly string[], opts: RecContext & { limit: number; skip?: ReadonlySet<string> }): string[] {
  const skip = new Set(opts.skip ?? []);
  const now = opts.now ?? new Date();
  const max = maxOf(signals.sales);
  const weight = new Map<string, number>();
  viewed.forEach((id, i) => {
    if (!weight.has(id)) weight.set(id, REC_WEIGHTS.viewedCategory * REC_WEIGHTS.viewDecay ** i);
  });
  const affinity = (categoryId: string | null) => {
    if (!categoryId) return 0;
    const direct = weight.get(categoryId);
    if (direct !== undefined) return direct;
    const parent = opts.parentOf?.(categoryId) ?? null;
    if (parent && weight.has(parent)) return weight.get(parent)! / 2;
    for (const [id, w] of weight) if (opts.parentOf?.(id) === categoryId) return w / 2;
    return 0;
  };
  return ordered(
    pool
      .filter((c) => !skip.has(c.id))
      .map((c) => ({ c, score: trendScore(signals.sales?.get(c.id), max) * REC_WEIGHTS.homeTrend + affinity(c.categoryId) + freshness(c.createdAt, now) * REC_WEIGHTS.fresh })),
  ).slice(0, opts.limit);
}

/** Best sellers by sales (most first), topped up with the newest products while the shop has few or no orders. */
export function rankBestsellers(pool: readonly RecCandidate[], signals: RecSignals, opts: { limit: number; skip?: ReadonlySet<string>; now?: Date }): string[] {
  const skip = new Set(opts.skip ?? []);
  const sold = rankTogether(signals.sales, skip, opts.limit, new Set(pool.map((c) => c.id)));
  return topUp(sold, pool, skip, {}, opts.limit, opts.now ?? new Date());
}
