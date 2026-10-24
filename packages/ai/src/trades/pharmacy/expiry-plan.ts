/**
 * Near-expiry plan for a pharmacy. Every number (quantity, value, sell-through, days of stock, discount ceiling) is
 * computed here, in code, from the batches and the shop's own recent sales. The light tier only writes one plain reason
 * line per group of batches, and a line whose numbers are not in that group's facts sheet is replaced by a template.
 * Nothing is changed by this helper: write-offs and returns are done by the pharmacist.
 */
import { z } from "zod";
import type { AiRunner } from "../../assist/hsn";
import { DATA_RULES, dataBlock } from "../../assist/safety";
import { allowedNumbers, checkNumbers, rupees } from "../../insights/numbers";
import { daysBetween, round2 } from "../common";

export const EXPIRY_FEATURE = "expiry-plan";
export const EXPIRY_ACTIONS = ["write_off", "return", "discount", "move_front", "sell_first"] as const;
export type ExpiryAction = (typeof EXPIRY_ACTIONS)[number];

export interface PlanBatch {
  batchId: string;
  itemId: string;
  itemName: string;
  batchNo: string;
  /** YYYY-MM-DD, last day the batch may be sold. */
  expiry: string;
  qty: number;
  /** Paise per unit. */
  mrp: number | null;
  purchaseRate: number | null;
  supplier: string | null;
}

export interface ItemSales {
  itemId: string;
  /** Units sold in the window. */
  sold: number;
  /** Days the window covers (at most 60; shorter for a young shop). */
  windowDays: number;
}

export interface PlanOptions {
  today: string;
  /** Batches expiring within this many days are planned (default 90). */
  withinDays: number;
  /** Days before expiry up to which the supplier takes stock back; null = unknown. */
  returnMinDays: number | null;
}

export interface PlanRow {
  batchId: string;
  itemId: string;
  itemName: string;
  batchNo: string;
  expiry: string;
  supplier: string | null;
  qty: number;
  daysLeft: number;
  expired: boolean;
  /** Paise at purchase rate (MRP when no rate). */
  unitValue: number;
  value: number;
  /** Units per day sold over the window (0 when none). */
  dailyRate: number;
  /** Units of this batch expected to sell before it expires (earlier-expiring batches of the item go first). */
  likelySold: number;
  atRiskQty: number;
  atRiskValue: number;
  /** Days to sell this and every earlier-expiring batch at the current pace; null when nothing sells. */
  daysOfStock: number | null;
  action: ExpiryAction;
  /** For "discount": the most that can come off the MRP and still recover the purchase cost, whole percent. */
  maxDiscountPct: number | null;
  suggestDiscountPct: number | null;
}

export const unitValueOf = (b: Pick<PlanBatch, "purchaseRate" | "mrp">) => b.purchaseRate ?? b.mrp ?? 0;

export function buildPlan(batches: PlanBatch[], sales: ItemSales[], opt: PlanOptions): PlanRow[] {
  const rateOf = new Map(sales.map((s) => [s.itemId, s.windowDays > 0 ? s.sold / s.windowDays : 0]));
  const live = batches.filter((b) => b.qty > 0).sort((a, b) => (a.expiry === b.expiry ? a.batchNo.localeCompare(b.batchNo) : a.expiry < b.expiry ? -1 : 1));
  // Quantity of the same item expiring earlier and not yet expired: sold first (FEFO).
  const earlier = new Map<string, number>();
  const rows: PlanRow[] = [];
  for (const b of live) {
    const daysLeft = daysBetween(opt.today, b.expiry);
    const expired = daysLeft < 0;
    const ahead = earlier.get(b.itemId) ?? 0;
    if (!expired) earlier.set(b.itemId, ahead + b.qty);
    if (daysLeft > opt.withinDays) continue;
    const rate = rateOf.get(b.itemId) ?? 0;
    const unitValue = unitValueOf(b);
    const sellable = expired ? 0 : Math.min(b.qty, Math.max(0, Math.floor(rate * daysLeft - ahead)));
    const atRiskQty = b.qty - sellable;
    const daysOfStock = rate > 0 ? round2((ahead + b.qty) / rate) : null;
    const returnable = !expired && opt.returnMinDays !== null && daysLeft >= opt.returnMinDays;
    let action: ExpiryAction;
    if (expired) action = "write_off";
    else if (atRiskQty <= 0) action = daysOfStock !== null && daysOfStock > 0.6 * daysLeft ? "move_front" : "sell_first";
    else if (returnable && b.supplier) action = "return";
    else if (daysLeft >= 5) action = "discount";
    else action = "write_off";
    // The ceiling: sell no lower than the purchase cost. Needs both prices.
    let maxDiscountPct: number | null = null;
    if (b.mrp && b.purchaseRate && b.mrp > 0) maxDiscountPct = Math.max(0, Math.floor((1 - b.purchaseRate / b.mrp) * 100));
    const suggest = action === "discount" ? (maxDiscountPct === null ? 10 : Math.min(maxDiscountPct, Math.max(5, Math.round(Math.min(maxDiscountPct, 25) / 5) * 5))) : null;
    rows.push({
      batchId: b.batchId,
      itemId: b.itemId,
      itemName: b.itemName,
      batchNo: b.batchNo,
      expiry: b.expiry,
      supplier: b.supplier,
      qty: b.qty,
      daysLeft,
      expired,
      unitValue,
      value: Math.round(b.qty * unitValue),
      dailyRate: round2(rate),
      likelySold: sellable,
      atRiskQty,
      atRiskValue: Math.round(atRiskQty * unitValue),
      daysOfStock,
      action,
      maxDiscountPct,
      suggestDiscountPct: suggest,
    });
  }
  return rows.sort((a, b) => a.daysLeft - b.daysLeft || b.atRiskValue - a.atRiskValue);
}

export interface PlanGroup {
  action: ExpiryAction;
  batches: number;
  qty: number;
  value: number;
  atRiskQty: number;
  atRiskValue: number;
  /** Soonest and latest days left in the group. */
  minDays: number;
  maxDays: number;
  top: { itemName: string; qty: number; daysLeft: number; value: number }[];
}

export function groupPlan(rows: PlanRow[]): PlanGroup[] {
  return EXPIRY_ACTIONS.flatMap((action) => {
    const list = rows.filter((r) => r.action === action);
    if (list.length === 0) return [];
    return [
      {
        action,
        batches: list.length,
        qty: list.reduce((s, r) => s + r.qty, 0),
        value: list.reduce((s, r) => s + r.value, 0),
        atRiskQty: list.reduce((s, r) => s + r.atRiskQty, 0),
        atRiskValue: list.reduce((s, r) => s + r.atRiskValue, 0),
        minDays: Math.min(...list.map((r) => r.daysLeft)),
        maxDays: Math.max(...list.map((r) => r.daysLeft)),
        top: [...list].sort((a, b) => b.value - a.value).slice(0, 3).map((r) => ({ itemName: r.itemName, qty: r.qty, daysLeft: r.daysLeft, value: r.value })),
      },
    ];
  });
}

/** Return list per supplier for print (the shop's debit-note path needs a recorded purchase; batches carry only the supplier name). */
export function returnList(rows: PlanRow[]): { supplier: string; value: number; rows: PlanRow[] }[] {
  const map = new Map<string, PlanRow[]>();
  for (const r of rows.filter((x) => x.action === "return")) {
    const k = r.supplier ?? "";
    map.set(k, [...(map.get(k) ?? []), r]);
  }
  return [...map.entries()].map(([supplier, list]) => ({ supplier, value: list.reduce((s, r) => s + r.atRiskValue, 0), rows: list }));
}

// ------------------------------------------------------------------ words

export type PlanLang = "en" | "ta";

/** The facts a reason line may use. Only numbers written here are allowed in the AI's line. */
export function groupSheet(g: PlanGroup): string {
  return [
    `group: ${g.action}`,
    `batches: ${g.batches}`,
    `units: ${g.qty}`,
    `stock value: ${rupees(g.value)}`,
    `units unlikely to sell before expiry: ${g.atRiskQty}`,
    `value at risk: ${rupees(g.atRiskValue)}`,
    `days to expiry: from ${g.minDays} to ${g.maxDays}`,
    ...g.top.map((t) => `${t.itemName}: ${t.qty} units, ${t.daysLeft} days left, ${rupees(t.value)}`),
  ].join("\n");
}

const ACTION_EN: Record<ExpiryAction, string> = {
  write_off: "Take off the shelf and write off",
  return: "Ask the supplier to take back",
  discount: "Offer a discount to sell before expiry",
  move_front: "Move to the front of the shelf",
  sell_first: "Sell first (first-expiry-first-out)",
};
const ACTION_TA: Record<ExpiryAction, string> = {
  write_off: "அலமாரியிலிருந்து எடுத்து வெட்டிவிடவும்",
  return: "சப்ளையரிடம் திருப்பி எடுக்கச் சொல்லவும்",
  discount: "காலாவதிக்கு முன் விற்க தள்ளுபடி வழங்கவும்",
  move_front: "அலமாரியின் முன்பக்கம் வைக்கவும்",
  sell_first: "முதலில் விற்கவும் (முதலில் காலாவதி ஆவது முதலில்)",
};
export const actionLabel = (a: ExpiryAction, lang: PlanLang) => (lang === "ta" ? ACTION_TA[a] : ACTION_EN[a]);

export function templateLine(g: PlanGroup, lang: PlanLang): string {
  if (lang === "ta") return `${ACTION_TA[g.action]}: ${g.batches} பேட்ச், ${g.qty} எண்ணிக்கை, மதிப்பு ${rupees(g.value)}; விற்காமல் போகும் அபாயம் ${rupees(g.atRiskValue)}.`;
  return `${ACTION_EN[g.action]}: ${g.batches} batch(es), ${g.qty} units worth ${rupees(g.value)}; ${rupees(g.atRiskValue)} is at risk of not selling in time.`;
}

export const EXPIRY_SYSTEM = [
  "You help a pharmacy owner in Tamil Nadu act on medicines that are close to expiry.",
  "For each group you get a facts sheet computed by the software. Write ONE plain sentence per group (at most 30 words) saying why that action fits, in the language asked (en = English, ta = Tamil).",
  "Use only numbers that are written in that group's facts sheet; never calculate, round or invent a number, price, discount or date.",
  "Do not give medical advice and do not say a medicine is safe or unsafe to use or sell. Do not mention a supplier's policy.",
  DATA_RULES,
].join("\n");

const Lines = z.object({ lines: z.array(z.object({ group: z.string(), text: z.string() })).max(8) });
const LINES_JSON = {
  type: "object",
  properties: { lines: { type: "array", items: { type: "object", properties: { group: { type: "string" }, text: { type: "string" } }, required: ["group", "text"], additionalProperties: false } } },
  required: ["lines"],
  additionalProperties: false,
} as const;

export interface PlanLine {
  action: ExpiryAction;
  text: string;
  source: "ai" | "template";
}

const UNSAFE_CLAIM = /\b(safe|unsafe|harmless|still (?:good|fine|usable)|can be used|effective)\b|பாதுகாப்பான|பாதுகாப்பற்ற|தொடர்ந்து பயன்படுத்தலாம்/i;

/** One light-tier call for all groups; lines that break the number rule (or make a safety claim) become template lines. */
export async function explainPlan(ai: AiRunner, req: { tenantId: string; userId?: string | null; groups: PlanGroup[]; lang: PlanLang }) {
  const templates: PlanLine[] = req.groups.map((g) => ({ action: g.action, text: templateLine(g, req.lang), source: "template" }));
  if (!req.groups.length) return { lines: [] as PlanLine[], runId: null as string | null, credits: 0, aiNote: null as string | null };
  const sheets = new Map(req.groups.map((g) => [g.action as string, groupSheet(g)]));
  const text = [`Language: ${req.lang}`, ...req.groups.map((g) => dataBlock(`group ${g.action}`, sheets.get(g.action)!))].join("\n");
  try {
    const r = await ai.run<z.infer<typeof Lines>>({
      tenantId: req.tenantId,
      userId: req.userId ?? null,
      feature: EXPIRY_FEATURE,
      tier: "light",
      system: EXPIRY_SYSTEM,
      input: { text },
      schema: { name: "expiry_plan_lines", jsonSchema: LINES_JSON as unknown as Record<string, unknown>, zod: Lines },
      maxTokens: 2500,
    });
    const lines = templates.map((t) => {
      const got = r.output.lines.find((l) => l.group === t.action)?.text?.replace(/\s+/g, " ").trim();
      if (!got || got.length > 320) return t;
      if (UNSAFE_CLAIM.test(got)) return t;
      if (req.lang === "ta" && !/[஀-௿]/.test(got)) return t;
      if (!checkNumbers(got, allowedNumbers(sheets.get(t.action)!)).ok) return t;
      return { action: t.action, text: got, source: "ai" as const };
    });
    return { lines, runId: r.runId as string | null, credits: r.credits, aiNote: null as string | null };
  } catch (e) {
    return { lines: templates, runId: null as string | null, credits: 0, aiNote: (e as { code?: string }).code ?? "ai_failed" };
  }
}
