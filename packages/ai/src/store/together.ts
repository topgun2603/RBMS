import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@rbms/db";
import { aiItemPairs } from "../schema";

/**
 * "Often bought together" (feature `bought-together`, NO model, no credits): a daily job counts which products share a basket
 * (a bill or a store order) in the last 180 days and keeps, for each product, the partners that appear with it clearly more than
 * chance would explain. Shown on the store's product page ("Often bought together", with a combo add-to-cart) and as "customers
 * also buy" chips in the POS cart.
 *
 *   support(A,B)    = baskets with both / all baskets
 *   confidence(A->B) = baskets with both / baskets with A
 *   lift(A->B)      = confidence / (baskets with B / all baskets)      1 = no link, 2 = twice as likely as chance
 */
export const TOGETHER_FEATURE = "bought-together";
export const TOGETHER_JOB = "ai.bought-together";
export const TOGETHER_DAYS = 180;

export interface TogetherOptions {
  /** Baskets holding both products at least this many times. */
  minTogether: number;
  /** Baskets holding A at least this many times for A to get recommendations. */
  minCountA: number;
  minConfidence: number;
  minLift: number;
  /** Products in more than this share of baskets (carry bags, a plastic cover...) are left out on both sides. */
  maxBasketShare: number;
  /** The share limit only applies with at least this many baskets (a tiny shop's few baskets are all "common"). */
  shareFloorBaskets: number;
  /** Partners kept per product. */
  perProduct: number;
  /** Baskets needed at all. */
  minBaskets: number;
}

export const DEFAULT_TOGETHER: TogetherOptions = {
  minTogether: 3,
  minCountA: 5,
  minConfidence: 0.05,
  minLift: 1.2,
  maxBasketShare: 0.35,
  shareFloorBaskets: 60,
  perProduct: 8,
  minBaskets: 30,
};

export interface PairStat {
  productId: string;
  withProductId: string;
  together: number;
  countA: number;
  countB: number;
  baskets: number;
  support: number;
  confidence: number;
  lift: number;
}

/** Names that are never a sensible "also buy" (carry bags, bag charges, delivery lines). Matched on the whole, lowercased name. */
const INCIDENTAL = /\b(carry|carrier|plastic|polythene|shopping|paper|jute|cloth)?\s*bags?\b|\bbag charge|\bcover charge\b|\bdelivery (charge|fee)\b|\bpacking\b|\bround ?off\b/i;
export const isIncidental = (name: string): boolean => INCIDENTAL.test(name) && name.trim().split(/\s+/).length <= 4;

/**
 * Pair statistics from baskets (each an array of product ids; duplicates inside a basket count once). Pure.
 * `exclude` = product ids never recommended and never recommended for.
 */
export function computePairs(baskets: readonly (readonly string[])[], opts: Partial<TogetherOptions> = {}, exclude: ReadonlySet<string> = new Set()): PairStat[] {
  const o = { ...DEFAULT_TOGETHER, ...opts };
  const sets = baskets.map((b) => [...new Set(b)]).filter((b) => b.length > 0);
  const N = sets.length;
  if (N < o.minBaskets) return [];
  const count = new Map<string, number>();
  for (const b of sets) for (const p of b) count.set(p, (count.get(p) ?? 0) + 1);
  const common = new Set<string>();
  if (N >= o.shareFloorBaskets) for (const [p, c] of count) if (c / N > o.maxBasketShare) common.add(p);
  const usable = (p: string) => !exclude.has(p) && !common.has(p);

  const pair = new Map<string, number>();
  for (const b of sets) {
    const items = b.filter(usable);
    if (items.length < 2 || items.length > 40) continue; // a 40-line bill says nothing about two items
    items.sort();
    for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
      const k = `${items[i]}|${items[j]}`;
      pair.set(k, (pair.get(k) ?? 0) + 1);
    }
  }
  const out: PairStat[] = [];
  for (const [k, together] of pair) {
    if (together < o.minTogether) continue;
    const [a, b] = k.split("|") as [string, string];
    const ca = count.get(a)!;
    const cb = count.get(b)!;
    for (const [x, y, cx, cy] of [[a, b, ca, cb], [b, a, cb, ca]] as const) {
      if (cx < o.minCountA) continue;
      const confidence = together / cx;
      const lift = confidence / (cy / N);
      if (confidence < o.minConfidence || lift < o.minLift) continue;
      out.push({ productId: x, withProductId: y, together, countA: cx, countB: cy, baskets: N, support: together / N, confidence, lift });
    }
  }
  // strongest partners per product
  const by = new Map<string, PairStat[]>();
  for (const p of out) by.set(p.productId, [...(by.get(p.productId) ?? []), p]);
  return [...by.values()].flatMap((list) => list.sort((x, y) => y.lift - x.lift || y.together - x.together || x.withProductId.localeCompare(y.withProductId)).slice(0, o.perProduct));
}

export interface BasketRow {
  basket: string;
  productId: string;
}

export interface TogetherPorts {
  /** Product ids per basket (bills and store orders, last `days` days, no cancelled/draft/imported/duplicate-of-bill orders). */
  baskets(tenantId: string, days: number): Promise<BasketRow[]>;
  /** Products that must never be suggested (carry bags...). */
  incidental(tenantId: string): Promise<string[]>;
  /** Shops with the store or billing in use (the daily job's list). */
  tenants(): Promise<string[]>;
  /** Is the shop's switch on? (settings ai.features["bought-together"] !== false, plan feature). */
  enabled(tenantId: string): Promise<boolean>;
}

export interface Partner {
  productId: string;
  score: number;
  confidence: number;
  lift: number;
  together: number;
}

export class TogetherService {
  constructor(
    private readonly d: { db: Db; ports: TogetherPorts; now?: () => Date; log?: { warn(o: object, m?: string): void } },
  ) {}

  private now() {
    return this.d.now?.() ?? new Date();
  }

  /** Recomputes one shop: replaces its rows in one transaction. Returns what was kept. */
  async refresh(tenantId: string, opts: Partial<TogetherOptions> = {}): Promise<{ baskets: number; pairs: number }> {
    const [rows, excluded] = await Promise.all([this.d.ports.baskets(tenantId, TOGETHER_DAYS), this.d.ports.incidental(tenantId)]);
    const byBasket = new Map<string, string[]>();
    for (const r of rows) byBasket.set(r.basket, [...(byBasket.get(r.basket) ?? []), r.productId]);
    const baskets = [...byBasket.values()];
    const pairs = computePairs(baskets, opts, new Set(excluded));
    const at = this.now();
    await this.d.db.transaction(async (tx) => {
      await tx.delete(aiItemPairs).where(eq(aiItemPairs.tenantId, tenantId));
      for (let i = 0; i < pairs.length; i += 500) {
        await tx.insert(aiItemPairs).values(pairs.slice(i, i + 500).map((p) => ({ tenantId, ...p, computedAt: at })));
      }
    });
    return { baskets: baskets.length, pairs: pairs.length };
  }

  /** The daily job body: every shop with the switch on; one shop failing does not stop the others. */
  async refreshAll(): Promise<{ shops: number; pairs: number; failed: number }> {
    let shops = 0;
    let pairs = 0;
    let failed = 0;
    for (const t of await this.d.ports.tenants()) {
      try {
        if (!(await this.d.ports.enabled(t))) continue;
        const r = await this.refresh(t);
        shops++;
        pairs += r.pairs;
      } catch (err) {
        failed++;
        this.d.log?.warn({ tenantId: t, err: err instanceof Error ? err.message : String(err) }, "ai: bought-together refresh failed");
      }
    }
    return { shops, pairs, failed };
  }

  /**
   * Partners for a set of products (a product page: one; a POS cart: several). A candidate's score adds the confidence it has
   * from each cart product (more links = higher); products already in `have` never come back.
   */
  async partners(tenantId: string, productIds: string[], limit = 6, have: readonly string[] = productIds): Promise<Partner[]> {
    if (!productIds.length) return [];
    const rows = await this.d.db
      .select()
      .from(aiItemPairs)
      .where(and(eq(aiItemPairs.tenantId, tenantId), inArray(aiItemPairs.productId, productIds.slice(0, 40))))
      .orderBy(desc(aiItemPairs.lift))
      .limit(400);
    const skip = new Set(have);
    const by = new Map<string, Partner>();
    for (const r of rows) {
      if (skip.has(r.withProductId)) continue;
      const cur = by.get(r.withProductId) ?? { productId: r.withProductId, score: 0, confidence: 0, lift: 0, together: 0 };
      cur.score += r.confidence * Math.min(r.lift, 10);
      cur.confidence = Math.max(cur.confidence, r.confidence);
      cur.lift = Math.max(cur.lift, r.lift);
      cur.together += r.together;
      by.set(r.withProductId, cur);
    }
    return [...by.values()].sort((a, b) => b.score - a.score || b.together - a.together).slice(0, limit);
  }

  /** Is there any data for the shop (the store hides the section and the POS chips otherwise). */
  async hasData(tenantId: string): Promise<boolean> {
    const [r] = await this.d.db.select({ n: sql<number>`count(*)::int` }).from(aiItemPairs).where(eq(aiItemPairs.tenantId, tenantId)).limit(1);
    return (r?.n ?? 0) > 0;
  }
}
