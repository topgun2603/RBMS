/** Pure overview assembly from daily metric rows. */
import { addDaysISO } from "./ingest";
import { FUNNEL_STEPS, METRICS, type FunnelStep } from "./rollup";

export interface DatedMetricRow {
  date: string;
  metric: string;
  dimension: string;
  value: number;
}

export interface Overview {
  from: string;
  to: string;
  /** Sum of daily distinct visitors (a visitor coming on two days counts twice). */
  visitors: number;
  sessions: number;
  pageViews: number;
  productViews: number;
  addToCart: number;
  checkouts: number;
  purchases: number;
  /** Paise. */
  revenue: number;
  /** Purchases per session, in percent with 2 decimals (2.5 = 2.5 %). */
  conversionRate: number;
  trend: { date: string; visitors: number; purchases: number; revenue: number }[];
  funnel: { step: FunnelStep; count: number }[];
  topProducts: { productId: string; name: string; views: number; addToCart: number; purchases: number }[];
  topSearches: { query: string; count: number }[];
  sources: { source: string; sessions: number }[];
  devices: { device: string; sessions: number }[];
}

export const TOP_PRODUCTS = 10;
export const TOP_SEARCHES = 10;

/** purchases / sessions × 100, rounded to 2 decimals; 0 without sessions. */
export function conversionRate(purchases: number, sessions: number): number {
  if (!sessions || sessions <= 0) return 0;
  return Math.round((purchases / sessions) * 10_000) / 100;
}

/** Every date from `from` to `to`, inclusive. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 1000; d = addDaysISO(d, 1)) out.push(d);
  return out;
}

const sortDesc = <T>(items: T[], value: (t: T) => number, key: (t: T) => string) =>
  items.sort((a, b) => value(b) - value(a) || key(a).localeCompare(key(b)));

/** Builds the overview from rollup rows (product names filled later, see `withProductNames`). */
export function assembleOverview(from: string, to: string, rows: readonly DatedMetricRow[]): Overview {
  const totals = new Map<string, number>();
  const daily = new Map<string, Map<string, number>>();
  const dims = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (r.date < from || r.date > to) continue;
    if (r.dimension === "") {
      totals.set(r.metric, (totals.get(r.metric) ?? 0) + r.value);
      let d = daily.get(r.date);
      if (!d) daily.set(r.date, (d = new Map()));
      d.set(r.metric, (d.get(r.metric) ?? 0) + r.value);
    } else {
      let m = dims.get(r.metric);
      if (!m) dims.set(r.metric, (m = new Map()));
      m.set(r.dimension, (m.get(r.dimension) ?? 0) + r.value);
    }
  }
  const t = (metric: string) => totals.get(metric) ?? 0;
  const dim = (metric: string) => dims.get(metric) ?? new Map<string, number>();

  const productIds = new Set([
    ...dim(METRICS.productViewsBy).keys(),
    ...dim(METRICS.productAddToCartBy).keys(),
    ...dim(METRICS.productPurchasesBy).keys(),
  ]);
  const products = [...productIds].map((productId) => ({
    productId,
    name: "",
    views: dim(METRICS.productViewsBy).get(productId) ?? 0,
    addToCart: dim(METRICS.productAddToCartBy).get(productId) ?? 0,
    purchases: dim(METRICS.productPurchasesBy).get(productId) ?? 0,
  }));
  products.sort(
    (a, b) => b.views - a.views || b.purchases - a.purchases || b.addToCart - a.addToCart || a.productId.localeCompare(b.productId),
  );

  const sessions = t(METRICS.sessions);
  const purchases = t(METRICS.purchases);
  return {
    from,
    to,
    visitors: t(METRICS.visitors),
    sessions,
    pageViews: t(METRICS.pageViews),
    productViews: t(METRICS.productViews),
    addToCart: t(METRICS.addToCart),
    checkouts: t(METRICS.checkouts),
    purchases,
    revenue: t(METRICS.revenue),
    conversionRate: conversionRate(purchases, sessions),
    trend: dateRange(from, to).map((date) => {
      const d = daily.get(date);
      return {
        date,
        visitors: d?.get(METRICS.visitors) ?? 0,
        purchases: d?.get(METRICS.purchases) ?? 0,
        revenue: d?.get(METRICS.revenue) ?? 0,
      };
    }),
    funnel: FUNNEL_STEPS.map((step) => ({ step, count: dim(METRICS.funnelSessions).get(step) ?? 0 })),
    topProducts: products.slice(0, TOP_PRODUCTS),
    topSearches: sortDesc(
      [...dim(METRICS.searches)].map(([query, count]) => ({ query, count })),
      (x) => x.count,
      (x) => x.query,
    ).slice(0, TOP_SEARCHES),
    sources: sortDesc(
      [...dim(METRICS.sourceSessions)].map(([source, s]) => ({ source, sessions: s })),
      (x) => x.sessions,
      (x) => x.source,
    ),
    devices: sortDesc(
      [...dim(METRICS.deviceSessions)].map(([device, s]) => ({ device, sessions: s })),
      (x) => x.sessions,
      (x) => x.device,
    ),
  };
}

/** Fills `topProducts[].name`; products the catalogue doesn't know (deleted) show as "Deleted product". */
export function withProductNames(o: Overview, names: Readonly<Record<string, string>>): Overview {
  return { ...o, topProducts: o.topProducts.map((p) => ({ ...p, name: names[p.productId] ?? "Deleted product" })) };
}
