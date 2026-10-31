/** Pure daily aggregation of raw events into analytics_daily rows. */
import type { Device, EventType } from "./schema";

/** Metric names in analytics_daily. Totals have dimension "". */
export const METRICS = {
  visitors: "visitors",
  sessions: "sessions",
  pageViews: "page_views",
  productViews: "product_views",
  addToCart: "add_to_cart",
  removeFromCart: "remove_from_cart",
  checkouts: "begin_checkout",
  purchases: "purchases",
  revenue: "revenue",
  /** dimension = source ("direct", a referrer host or utm source). */
  sourceSessions: "source_sessions",
  /** dimension = device. */
  deviceSessions: "device_sessions",
  /** dimension = funnel step; value = sessions that reached it. */
  funnelSessions: "funnel_sessions",
  /** dimension = product id. */
  productViewsBy: "product_views_by",
  productAddToCartBy: "product_add_to_cart_by",
  productPurchasesBy: "product_purchases_by",
  /** dimension = product id; value = paise sold in purchases (from `purchase_item` events). */
  productRevenueBy: "product_revenue_by",
  /** dimension = normalised query. */
  searches: "searches",
} as const;

export const FUNNEL_STEPS = ["visit", "product_view", "add_to_cart", "begin_checkout", "purchase"] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];

/** Per day, at most this many products and searches are kept. */
export const MAX_PRODUCTS_PER_DAY = 200;
export const MAX_SEARCHES_PER_DAY = 100;

export interface RollupEvent {
  at: Date;
  type: EventType;
  sessionId: string;
  anonymousId: string;
  productId: string | null;
  value: number | null;
  query: string | null;
  referrerHost: string | null;
  utmSource: string | null;
  device: Device;
}

export interface MetricRow {
  metric: string;
  dimension: string;
  value: number;
}

/** A session's source: utm_source, else the referring host, else "direct". */
export const sourceOf = (e: Pick<RollupEvent, "utmSource" | "referrerHost">): string => e.utmSource || e.referrerHost || "direct";

const inc = (m: Map<string, number>, k: string, by = 1) => m.set(k, (m.get(k) ?? 0) + by);

const topN = (m: Map<string, number>, n: number) =>
  [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, n);

/** Same-instant tie-break: the storefront batches events with millisecond times, so a page view and the product view
 * it triggers often share `at`; the page view (the only event carrying referrer / UTM) must count as first. */
const TYPE_ORDER: Record<EventType, number> = {
  page_view: 0,
  search: 1,
  product_view: 2,
  add_to_cart: 3,
  remove_from_cart: 4,
  begin_checkout: 5,
  purchase: 6,
  purchase_item: 7,
};

/** Whether the event says where the visit came from (only page views carry referrer / UTM). */
const hasSource = (e: Pick<RollupEvent, "utmSource" | "referrerHost">) => !!(e.utmSource || e.referrerHost);

/**
 * Aggregates one day of one tenant's events. Sessions take their device from their first event and their source from
 * the first event that has one (utm / referrer), else "direct"; visitors are distinct anonymous ids; revenue is the sum
 * of purchase values (paise). The result doesn't depend on the order of `events`.
 */
export function aggregateDay(events: readonly RollupEvent[]): MetricRow[] {
  if (events.length === 0) return [];
  const sorted = [...events].sort((a, b) => a.at.getTime() - b.at.getTime() || TYPE_ORDER[a.type] - TYPE_ORDER[b.type]);

  const visitors = new Set<string>();
  const sessions = new Map<string, { source: string; sourced: boolean; device: Device; steps: Set<FunnelStep> }>();
  const counts = { page_view: 0, product_view: 0, add_to_cart: 0, remove_from_cart: 0, begin_checkout: 0, purchase: 0, search: 0 };
  let revenue = 0;
  const pViews = new Map<string, number>();
  const pCart = new Map<string, number>();
  const pBuys = new Map<string, number>();
  const pRevenue = new Map<string, number>();
  const searches = new Map<string, number>();

  for (const e of sorted) {
    visitors.add(e.anonymousId);
    let s = sessions.get(e.sessionId);
    if (!s) {
      s = { source: sourceOf(e), sourced: hasSource(e), device: e.device, steps: new Set(["visit"]) };
      sessions.set(e.sessionId, s);
    } else if (!s.sourced && hasSource(e)) {
      s.source = sourceOf(e);
      s.sourced = true;
    }
    if (e.type === "purchase_item") {
      if (e.productId) {
        inc(pBuys, e.productId);
        inc(pRevenue, e.productId, Math.max(e.value ?? 0, 0));
      }
      continue;
    }
    counts[e.type]++;
    if (e.type === "product_view" || e.type === "add_to_cart" || e.type === "begin_checkout" || e.type === "purchase") {
      s.steps.add(e.type);
    }
    if (e.type === "purchase") revenue += Math.max(e.value ?? 0, 0);
    if (e.productId) {
      if (e.type === "product_view") inc(pViews, e.productId);
      else if (e.type === "add_to_cart") inc(pCart, e.productId);
      else if (e.type === "purchase") inc(pBuys, e.productId);
    }
    if (e.type === "search" && e.query) inc(searches, e.query);
  }

  const rows: MetricRow[] = [];
  const total = (metric: string, value: number) => rows.push({ metric, dimension: "", value });
  total(METRICS.visitors, visitors.size);
  total(METRICS.sessions, sessions.size);
  total(METRICS.pageViews, counts.page_view);
  total(METRICS.productViews, counts.product_view);
  total(METRICS.addToCart, counts.add_to_cart);
  total(METRICS.removeFromCart, counts.remove_from_cart);
  total(METRICS.checkouts, counts.begin_checkout);
  total(METRICS.purchases, counts.purchase);
  total(METRICS.revenue, revenue);

  const bySource = new Map<string, number>();
  const byDevice = new Map<string, number>();
  const byStep = new Map<string, number>();
  for (const s of sessions.values()) {
    inc(bySource, s.source);
    inc(byDevice, s.device);
    for (const step of s.steps) inc(byStep, step);
  }
  for (const [k, v] of bySource) rows.push({ metric: METRICS.sourceSessions, dimension: k, value: v });
  for (const [k, v] of byDevice) rows.push({ metric: METRICS.deviceSessions, dimension: k, value: v });
  for (const step of FUNNEL_STEPS) rows.push({ metric: METRICS.funnelSessions, dimension: step, value: byStep.get(step) ?? 0 });

  // Keep the most active products (views + carts + purchases), each metric for the same set.
  const activity = new Map<string, number>();
  for (const m of [pViews, pCart, pBuys]) for (const [k, v] of m) inc(activity, k, v);
  for (const [productId] of topN(activity, MAX_PRODUCTS_PER_DAY)) {
    const add = (metric: string, m: Map<string, number>) => {
      const v = m.get(productId);
      if (v) rows.push({ metric, dimension: productId, value: v });
    };
    add(METRICS.productViewsBy, pViews);
    add(METRICS.productAddToCartBy, pCart);
    add(METRICS.productPurchasesBy, pBuys);
    add(METRICS.productRevenueBy, pRevenue);
  }
  for (const [q, v] of topN(searches, MAX_SEARCHES_PER_DAY)) rows.push({ metric: METRICS.searches, dimension: q, value: v });

  return rows;
}
