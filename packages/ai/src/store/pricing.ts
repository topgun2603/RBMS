import type { AiRunner } from "../assist/hsn";
import { DATA_RULES, dataBlock, neutralise } from "../assist/safety";
import { allowedNumbers, checkNumbers } from "../insights/numbers";
import { hasTamil, inr } from "./common";
import { z } from "zod";

/**
 * Pricing hints for the owner (feature `pricing-hints`, light tier). EVERYTHING is computed in code from the shop's own sales:
 * which items changed price in the last 180 days, how fast they sold per day before and after (two windows of the same length,
 * corrected for how the whole shop's sales moved), and the margin before and after. A hint is raised only when the evidence is
 * clear (minimum sales on both sides). The light tier only writes a plain sentence around the figures (number-checked, en + ta);
 * it never sees a price it may change. Prices are never changed automatically.
 */
export const PRICING_FEATURE = "pricing-hints";
export const HINT_DAYS = 180;
export const MAX_WINDOW_DAYS = 60;
export const MIN_WINDOW_DAYS = 14;

export interface SaleRow {
  itemId: string;
  /** IST business date YYYY-MM-DD. */
  date: string;
  qty: number;
  /** Paise per unit, before GST and after the line's discount. */
  unitPrice: number;
}
export interface CostRow {
  itemId: string;
  date: string;
  /** Paise per unit (a purchase rate). */
  rate: number;
}
export interface ItemMeta {
  itemId: string;
  name: string;
  unit: string;
  /** Paise, the item's current cost price when set. */
  cost: number | null;
}
export interface HintThresholds {
  /** A price move smaller than this share is noise. */
  minChangePct: number;
  /** Units sold in the before window, and in the after window, at least. */
  minUnitsBefore: number;
  minUnitsAfter: number;
  /** Separate sales (bills lines) at least on each side. */
  minSalesEachSide: number;
  /** adjusted after/before rate at or above this = still selling well; at or below `slowed` = slowed. */
  held: number;
  slowed: number;
  /** "Room to raise": no price change for this many days, enough recent sales, demand not falling, a strong seller with a thin margin. */
  roomQuietDays: number;
  roomUnits60: number;
  roomSales60: number;
  roomDemand: number;
  roomTopShare: number;
  roomMaxMarginPct: number;
}
export const DEFAULT_THRESHOLDS: HintThresholds = {
  minChangePct: 2,
  minUnitsBefore: 10,
  minUnitsAfter: 6,
  minSalesEachSide: 5,
  held: 0.9,
  slowed: 0.7,
  roomQuietDays: 90,
  roomUnits60: 30,
  roomSales60: 15,
  roomDemand: 1.15,
  roomTopShare: 0.2,
  roomMaxMarginPct: 20,
};

const DAY = 86_400_000;
const dayNum = (d: string): number => Math.floor(Date.parse(`${d}T00:00:00Z`) / DAY);
export const dayStr = (n: number): string => new Date(n * DAY).toISOString().slice(0, 10);

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
/** Median of unit prices weighted by quantity (a big line counts more). */
function wMedian(rows: readonly SaleRow[]): number {
  const s = [...rows].sort((a, b) => a.unitPrice - b.unitPrice);
  const total = s.reduce((n, r) => n + r.qty, 0);
  let acc = 0;
  for (const r of s) {
    acc += r.qty;
    if (acc >= total / 2) return r.unitPrice;
  }
  return s.at(-1)?.unitPrice ?? 0;
}
const near = (p: number, ref: number, tol = 0.03) => ref > 0 && Math.abs(p - ref) / ref <= tol;
const units = (rows: readonly SaleRow[]) => rows.reduce((n, r) => n + r.qty, 0);

export interface PriceChange {
  /** First day sold at the new price. */
  date: string;
  oldPrice: number;
  newPrice: number;
  pct: number;
}

/**
 * The most recent clear price change of one item inside the last `HINT_DAYS`: candidate days are tried, and one counts when the
 * 60 days before and the 60 days after (as far as today allows) each hold at least 5 sales, the typical price differs by at
 * least `minChangePct`, and 70% of the sales on each side sit within 3% of that side's typical price (so a one-off discount
 * is not a "change"). Among the days of the latest such change, the one that splits the sales most cleanly wins. Pure.
 */
export function detectChange(sales: readonly SaleRow[], today: string, t: HintThresholds = DEFAULT_THRESHOLDS): PriceChange | null {
  const now = dayNum(today);
  const rows = sales.filter((s) => s.qty > 0 && s.unitPrice > 0).sort((a, b) => a.date.localeCompare(b.date));
  const dates = [...new Set(rows.map((r) => r.date))].filter((d) => dayNum(d) >= now - HINT_DAYS && dayNum(d) <= now - 3);
  const valid: { d: string; n: number; score: number; before: number; after: number }[] = [];
  for (const d of dates) {
    const n = dayNum(d);
    const before = rows.filter((r) => dayNum(r.date) >= n - MAX_WINDOW_DAYS && dayNum(r.date) < n);
    const after = rows.filter((r) => dayNum(r.date) >= n && dayNum(r.date) < n + MAX_WINDOW_DAYS);
    if (before.length < t.minSalesEachSide || after.length < 3) continue;
    const mb = wMedian(before);
    const ma = wMedian(after);
    const pct = ((ma - mb) / mb) * 100;
    if (Math.abs(pct) < t.minChangePct) continue;
    const cb = before.filter((r) => near(r.unitPrice, mb)).length / before.length;
    const ca = after.filter((r) => near(r.unitPrice, ma)).length / after.length;
    if (cb < 0.7 || ca < 0.7) continue;
    valid.push({ d, n, score: cb + ca, before: mb, after: ma });
  }
  if (!valid.length) return null;
  // the latest cluster of candidate days (a gap of more than 14 days starts another change)
  let start = valid.length - 1;
  while (start > 0 && valid[start]!.n - valid[start - 1]!.n <= 14) start--;
  const cluster = valid.slice(start);
  const best = cluster.reduce((a, b) => (b.score > a.score + 1e-9 || (Math.abs(b.score - a.score) <= 1e-9 && b.n > a.n) ? b : a));
  // first day actually sold at the new level
  const first = rows.find((r) => dayNum(r.date) >= best.n - 3 && near(r.unitPrice, best.after)) ?? rows.find((r) => r.date === best.d)!;
  return { date: first.date, oldPrice: Math.round(best.before), newPrice: Math.round(best.after), pct: ((best.after - best.before) / best.before) * 100 };
}

export type HintKind = "held_after_rise" | "slowed_after_rise" | "room_to_raise";

export interface Hint {
  itemId: string;
  name: string;
  unit: string;
  kind: HintKind;
  change: PriceChange | null;
  windowDays: number;
  before: { from: string; to: string; units: number; sales: number; perDay: number; avgPrice: number };
  after: { from: string; to: string; units: number; sales: number; perDay: number; avgPrice: number };
  /** The whole shop's units per day after / before (other items only); 1 when it could not be measured. */
  shopTrend: number;
  /** (after per day / before per day) / shopTrend. */
  adjusted: number;
  margin: { before: number | null; after: number | null } | null;
  /** Which of the checks passed, in words (for the screen's "why"). */
  evidence: string[];
}

const avgPrice = (rows: readonly SaleRow[]) => {
  const u = units(rows);
  return u > 0 ? rows.reduce((n, r) => n + r.unitPrice * r.qty, 0) / u : 0;
};

function costAt(costs: readonly CostRow[], meta: ItemMeta, date: string): number | null {
  const prior = costs.filter((c) => c.date <= date).sort((a, b) => b.date.localeCompare(a.date));
  if (prior[0]) return prior[0].rate;
  return meta.cost;
}
const marginPct = (price: number, cost: number | null) => (cost === null || price <= 0 ? null : ((price - cost) / price) * 100);

export interface HintInput {
  sales: readonly SaleRow[];
  costs?: readonly CostRow[];
  items: readonly ItemMeta[];
  today: string;
  thresholds?: Partial<HintThresholds>;
}

function windowStats(rows: readonly SaleRow[], from: number, to: number) {
  const r = rows.filter((x) => dayNum(x.date) >= from && dayNum(x.date) < to);
  return { rows: r, units: units(r), sales: r.length };
}

/** Pricing hints for a shop. Pure; the numbers in every hint are what the screen and the explanation show. */
export function computeHints(input: HintInput): Hint[] {
  const t = { ...DEFAULT_THRESHOLDS, ...input.thresholds };
  const now = dayNum(input.today);
  const byItem = new Map<string, SaleRow[]>();
  for (const s of input.sales) byItem.set(s.itemId, [...(byItem.get(s.itemId) ?? []), s]);
  const meta = new Map(input.items.map((i) => [i.itemId, i]));
  const costsBy = new Map<string, CostRow[]>();
  for (const c of input.costs ?? []) costsBy.set(c.itemId, [...(costsBy.get(c.itemId) ?? []), c]);

  // The shop's units per day by day (all items) to correct for the shop's own ups and downs.
  const shopByDay = new Map<number, number>();
  for (const s of input.sales) shopByDay.set(dayNum(s.date), (shopByDay.get(dayNum(s.date)) ?? 0) + s.qty);
  const shopUnits = (from: number, to: number, own: readonly SaleRow[]) => {
    let n = 0;
    for (let d = from; d < to; d++) n += shopByDay.get(d) ?? 0;
    return n - units(own.filter((r) => dayNum(r.date) >= from && dayNum(r.date) < to));
  };

  const hints: Hint[] = [];
  const last60 = new Map<string, number>();
  for (const [id, rows] of byItem) last60.set(id, units(rows.filter((r) => dayNum(r.date) > now - 60 && dayNum(r.date) <= now)));
  const ranked = [...last60.entries()].sort((a, b) => b[1] - a[1]);
  const topCut = Math.max(1, Math.ceil(ranked.length * t.roomTopShare));
  const top = new Set(ranked.slice(0, topCut).filter(([, u]) => u > 0).map(([id]) => id));

  for (const [itemId, rows] of byItem) {
    const m = meta.get(itemId);
    if (!m) continue;
    const costs = costsBy.get(itemId) ?? [];
    const change = detectChange(rows, input.today, t);

    if (change && change.pct > 0) {
      const d = dayNum(change.date);
      const L = Math.min(now + 1 - d, MAX_WINDOW_DAYS);
      if (L < MIN_WINDOW_DAYS) continue;
      const b = windowStats(rows, d - L, d);
      const a = windowStats(rows, d, d + L);
      if (b.units < t.minUnitsBefore || b.sales < t.minSalesEachSide || a.sales < 1) continue;
      const sb = shopUnits(d - L, d, rows);
      const sa = shopUnits(d, d + L, rows);
      const trendOk = sb >= 50;
      const shopTrend = trendOk ? Math.min(2, Math.max(0.5, sa / sb)) : 1;
      const rb = b.units / L;
      const ra = a.units / L;
      const adjusted = ra / rb / shopTrend;
      let kind: HintKind | null = null;
      if (adjusted <= t.slowed) kind = "slowed_after_rise";
      else if (adjusted >= t.held && a.units >= t.minUnitsAfter) kind = "held_after_rise";
      if (!kind) continue;
      const pb = avgPrice(b.rows);
      const pa = avgPrice(a.rows);
      const cb = costAt(costs, m, dayStr(d - 1));
      const ca = costAt(costs, m, dayStr(d));
      hints.push({
        itemId,
        name: m.name,
        unit: m.unit,
        kind,
        change,
        windowDays: L,
        before: { from: dayStr(d - L), to: dayStr(d - 1), units: b.units, sales: b.sales, perDay: rb, avgPrice: pb },
        after: { from: dayStr(d), to: dayStr(d + L - 1), units: a.units, sales: a.sales, perDay: ra, avgPrice: pa },
        shopTrend,
        adjusted,
        margin: { before: marginPct(pb, cb), after: marginPct(pa, ca) },
        evidence: [
          `price ${inr(change.oldPrice)} to ${inr(change.newPrice)}`,
          `${b.units} sold in the ${L} days before, ${a.units} in the ${L} days after`,
          trendOk ? "corrected for the shop's own sales trend" : "shop trend not measurable (too few sales), not corrected",
        ],
      });
      continue;
    }

    // ---- room to raise: nothing changed lately, a strong steady seller on a thin margin
    const lastChangeDays = change ? now - dayNum(change.date) : Infinity;
    if (lastChangeDays < t.roomQuietDays) continue;
    const first = Math.min(...rows.map((r) => dayNum(r.date)));
    if (now - first < 120) continue;
    const recent = windowStats(rows, now - 59, now + 1);
    const prior = windowStats(rows, now - 119, now - 59);
    if (recent.units < t.roomUnits60 || recent.sales < t.roomSales60 || prior.units < 10) continue;
    const sr = shopUnits(now - 59, now + 1, rows);
    const sp = shopUnits(now - 119, now - 59, rows);
    const shopTrend = sp >= 50 ? Math.min(2, Math.max(0.5, sr / sp)) : 1;
    const demand = recent.units / prior.units / shopTrend;
    if (demand < t.roomDemand || !top.has(itemId)) continue;
    const price = avgPrice(recent.rows);
    const margin = marginPct(price, costAt(costs, m, input.today));
    if (margin === null || margin > t.roomMaxMarginPct) continue;
    hints.push({
      itemId,
      name: m.name,
      unit: m.unit,
      kind: "room_to_raise",
      change: null,
      windowDays: 60,
      before: { from: dayStr(now - 119), to: dayStr(now - 60), units: prior.units, sales: prior.sales, perDay: prior.units / 60, avgPrice: avgPrice(prior.rows) },
      after: { from: dayStr(now - 59), to: input.today, units: recent.units, sales: recent.sales, perDay: recent.units / 60, avgPrice: price },
      shopTrend,
      adjusted: demand,
      margin: { before: null, after: margin },
      evidence: [`price unchanged for ${Math.min(lastChangeDays, HINT_DAYS)}+ days`, `${recent.units} sold in the last 60 days, among the top sellers`, `demand ${demand >= 1 ? "up" : "down"} against the 60 days before, corrected for the shop's trend`],
    });
  }
  const order: Record<HintKind, number> = { slowed_after_rise: 0, held_after_rise: 1, room_to_raise: 2 };
  return hints.sort((a, b) => order[a.kind] - order[b.kind] || b.after.units - a.after.units);
}

// ------------------------------------------------------------------ words

const r1 = (n: number) => Math.round(n * 10) / 10;
const pct0 = (n: number) => Math.round(n);

/** The facts sheet of one hint: every number the explanation may use, all computed in code. */
export function hintFacts(h: Hint): string {
  const lines = [`Item: ${h.name}`];
  if (h.change) lines.push(`Price changed on ${h.change.date} from ${inr(h.change.oldPrice)} to ${inr(h.change.newPrice)} per ${h.unit} (${pct0(h.change.pct)} percent up).`);
  lines.push(`Sold per day: ${r1(h.before.perDay)} before, ${r1(h.after.perDay)} after (${h.before.units} and ${h.after.units} ${h.unit} in two windows of ${h.windowDays} days).`);
  if (h.shopTrend !== 1) lines.push(`The whole shop sold ${pct0(Math.abs(h.shopTrend - 1) * 100)} percent ${h.shopTrend >= 1 ? "more" : "less"} in the same time.`);
  lines.push(`Compared with the shop's own trend, this item sold at ${pct0(h.adjusted * 100)} percent of its earlier pace.`);
  if (h.margin?.before != null && h.margin.after != null) lines.push(`Margin before ${pct0(h.margin.before)} percent, after ${pct0(h.margin.after)} percent.`);
  else if (h.margin?.after != null) lines.push(`Margin now about ${pct0(h.margin.after)} percent.`);
  return lines.join("\n");
}

/** The fixed wording when the AI is off, out of credits or its sentence fails the number check. */
export function templateHint(h: Hint): { en: string; ta: string } {
  const pace = `${r1(h.before.perDay)} → ${r1(h.after.perDay)}`;
  const chg = h.change ? `${inr(h.change.oldPrice)} → ${inr(h.change.newPrice)}` : "";
  const rel = pct0(h.adjusted * 100);
  if (h.kind === "held_after_rise")
    return {
      en: `Price went up (${chg}) and it is still selling: ${pace} a day, ${rel}% of its earlier pace after allowing for the shop's own trend.`,
      ta: `விலை உயர்ந்தும் (${chg}) தொடர்ந்து விற்கிறது: நாளுக்கு ${pace}; கடையின் போக்கைக் கணக்கில் கொண்டால் முந்தைய வேகத்தில் ${rel}%.`,
    };
  if (h.kind === "slowed_after_rise")
    return {
      en: `Sales slowed after the last increase (${chg}): ${pace} a day, only ${rel}% of its earlier pace after allowing for the shop's own trend.`,
      ta: `கடைசி விலை உயர்வுக்குப் (${chg}) பிறகு விற்பனை குறைந்தது: நாளுக்கு ${pace}; கடையின் போக்கைக் கணக்கில் கொண்டால் முந்தைய வேகத்தில் ${rel}% மட்டுமே.`,
    };
  return {
    en: `Price unchanged for a long time, selling strongly (${r1(h.after.perDay)} a day, demand ${rel}% of the 60 days before) on a thin margin${h.margin?.after != null ? ` (${pct0(h.margin.after)}%)` : ""}.`,
    ta: `நீண்ட நாட்களாக விலை மாறவில்லை, நன்றாக விற்கிறது (நாளுக்கு ${r1(h.after.perDay)}; முந்தைய 60 நாட்களின் ${rel}% தேவை), லாபம் குறைவு${h.margin?.after != null ? ` (${pct0(h.margin.after)}%)` : ""}.`,
  };
}

export const EXPLAIN_SYSTEM = [
  "You write ONE short, plain sentence (at most two) per item for a small Indian shop owner, in English and in simple spoken Tamil (Tamil script), explaining a pricing observation that was already worked out from the shop's own sales.",
  "Use ONLY the facts sheet of that item. Every number you write must appear in its facts sheet (you may write a percent as in the sheet). Do not add other numbers, dates or amounts, do not suggest a new price, do not promise or predict (never say it will sell more or earn more), do not give business advice beyond the observation. The observation kind tells you what to say:",
  "- held_after_rise: the item is still selling at about its earlier pace after the price went up.",
  "- slowed_after_rise: the item sold clearly slower after the latest price increase, even after allowing for how the whole shop's sales moved.",
  "- room_to_raise: the price has been unchanged a long time while the item sells strongly on a thin margin; the owner MAY consider a small increase, and should check it themselves.",
  "Keep the item name exactly as given. Tamil must be natural and short.",
  DATA_RULES,
].join("\n");

const OutZ = z.object({ items: z.array(z.object({ key: z.string(), en: z.string(), ta: z.string() })) });
const OUT_JSON = {
  type: "object",
  properties: { items: { type: "array", items: { type: "object", properties: { key: { type: "string" }, en: { type: "string" }, ta: { type: "string" } }, required: ["key", "en", "ta"], additionalProperties: false } } },
  required: ["items"],
  additionalProperties: false,
} as const;

const PROMISE = /\b(will|definitely|guarantee[sd]?|surely|certainly|always|earn more|sell more|increase (?:your )?(?:profit|sales))\b|உறுதி|நிச்சயம்/i;

export interface ExplainedHint {
  key: string;
  en: string;
  ta: string;
  source: "ai" | "template";
}

/** Checks one AI sentence pair against the item's facts: every number traced, Tamil is Tamil, no promise words. */
export function acceptExplanation(o: { en: string; ta: string }, facts: string, name: string): boolean {
  const allowed = allowedNumbers(facts);
  if (!o.en.trim() || !o.ta.trim()) return false;
  if (!checkNumbers(o.en, allowed).ok || !checkNumbers(o.ta, allowed).ok) return false;
  if (!hasTamil(o.ta)) return false;
  if (PROMISE.test(o.en) || PROMISE.test(o.ta)) return false;
  if (o.en.length > 320 || o.ta.length > 420) return false;
  void name;
  return true;
}

/** Keys are the hint's itemId. At most 12 hints per call (one light-tier call); anything that fails the checks gets the template. */
export async function explainHints(ai: AiRunner, p: { tenantId: string; userId?: string | null; hints: Hint[] }): Promise<{ items: ExplainedHint[]; runId: string | null; credits: number }> {
  const hints = p.hints.slice(0, 12);
  const sheet = new Map(hints.map((h) => [h.itemId, hintFacts({ ...h, name: neutralise(h.name).text || "item" })]));
  const text = hints.map((h) => dataBlock(`item ${h.itemId} (${h.kind})`, sheet.get(h.itemId)!)).join("\n");
  const r = await ai.run<z.infer<typeof OutZ>>({
    tenantId: p.tenantId,
    userId: p.userId ?? null,
    feature: PRICING_FEATURE,
    tier: "light",
    effort: "low",
    system: EXPLAIN_SYSTEM,
    input: { text: `For each item, return key = the id after "item " in its block label.\n${text}` },
    schema: { name: "pricing_hint_words", jsonSchema: OUT_JSON as unknown as Record<string, unknown>, zod: OutZ },
    maxTokens: 3500,
  });
  const got = new Map(r.output.items.map((i) => [i.key, i]));
  const items = hints.map((h): ExplainedHint => {
    const g = got.get(h.itemId);
    if (g && acceptExplanation(g, sheet.get(h.itemId)!, h.name)) return { key: h.itemId, en: g.en.trim(), ta: g.ta.trim(), source: "ai" };
    const t = templateHint(h);
    return { key: h.itemId, ...t, source: "template" };
  });
  return { items, runId: r.runId, credits: r.credits };
}
