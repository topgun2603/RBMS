import { z } from "zod";
import { DATA_RULES, dataBlock, neutralise } from "../assist/safety";
import type { AiRunner } from "../assist/hsn";
import { allowedNumbers, checkNumbers, qtyText } from "./numbers";

/**
 * Reorder suggestions. Every number (average daily sales, cover days, festival uplift, suggested quantity) is computed
 * here from the shop's own history. The AI (light tier) only writes one plain line per group of items, and its numbers are
 * checked against the group's facts; a line that fails the check is replaced by the template line.
 */

export const REORDER_FEATURE = "reorder";
export const DEFAULT_LEAD_DAYS = 3;
/** Days of sales a purchase should cover once it arrives. */
export const DEFAULT_COVER_DAYS = 7;
const Z_SAFETY = 1.28; // about 90% service level

export type ReorderGroup = "festival" | "out" | "running_low" | "trending" | "routine";
export const REORDER_GROUPS: readonly ReorderGroup[] = ["festival", "out", "running_low", "trending", "routine"];

export type ReasonCode = "out_of_stock" | "below_reorder_level" | "lead_time" | "trend_up" | "festival";

/** What the shop's data says about the nearest relevant festival for one item (from last year's same window). */
export interface FestivalSignal {
  id: string;
  name: string;
  nameTa: string;
  daysAway: number;
  /** Shopping window as days from today: [from, to]. */
  windowFromDay: number;
  windowToDay: number;
  /** Units sold in last year's same window, and the days it covered. */
  lastYearQty: number;
  lastYearDays: number;
  /** Units sold in the weeks before that window, and the days it covered. */
  baselineQty: number;
  baselineDays: number;
}

export interface ReorderInput {
  itemId: string;
  name: string;
  unit: string;
  /** Sellable stock now (qty minus reserved). */
  stock: number;
  reorderLevel: number;
  /** Open purchase orders (sent, not yet received). */
  onOrder: number;
  sold28: number;
  sold90: number;
  /** Days the shop has sales history for (max 90 counted). */
  historyDays: number;
  /** Units sold per day for the last 28 days (oldest first), for the safety stock. */
  daily28: number[];
  leadDays?: number;
  supplierId?: string | null;
  supplierName?: string | null;
  /** Paise per unit, excluding GST (last purchase rate). */
  lastRate?: number | null;
  gstRate?: number | null;
  hsn?: string | null;
  festival?: FestivalSignal | null;
}

export interface FestivalUplift {
  /** Daily sales in last year's window divided by daily sales in the weeks before it. */
  ratio: number;
  lastYearDaily: number;
  baselineDaily: number;
}

/** Last year's same-festival uplift for an item, or null when the data does not show a real lift. */
export function festivalUplift(s: Pick<FestivalSignal, "lastYearQty" | "lastYearDays" | "baselineQty" | "baselineDays">): FestivalUplift | null {
  if (s.lastYearDays <= 0 || s.baselineDays <= 0) return null;
  // Too few sales on either side and a ratio means nothing.
  if (s.lastYearQty < 3 || s.baselineQty < 3) return null;
  const lastYearDaily = s.lastYearQty / s.lastYearDays;
  const baselineDaily = s.baselineQty / s.baselineDays;
  const ratio = lastYearDaily / baselineDaily;
  if (!Number.isFinite(ratio) || ratio < 1.15) return null;
  return { ratio: Math.min(4, Math.round(ratio * 100) / 100), lastYearDaily, baselineDaily };
}

export interface ReorderSuggestion {
  itemId: string;
  name: string;
  unit: string;
  qty: number;
  group: ReorderGroup;
  reasons: ReasonCode[];
  stock: number;
  onOrder: number;
  reorderLevel: number;
  /** Units a day (blend of the last 28 and 90 days), 2 decimals. */
  avgDaily: number;
  avgDaily28: number;
  avgDaily90: number;
  /** Trend of the last 28 days against the last 90, in percent (null when under 4 weeks of history). */
  trendPct: number | null;
  /** Days the stock lasts at the current pace (1 decimal), null when nothing sells. */
  daysCover: number | null;
  leadDays: number;
  safetyStock: number;
  festival?: { id: string; name: string; nameTa: string; daysAway: number; ratio: number; extraQty: number };
  supplierId: string | null;
  supplierName: string | null;
  lastRate: number | null;
  gstRate: number | null;
  hsn: string | null;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r1 = (n: number) => Math.round(n * 10) / 10;

function stdev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1));
}

/** One item's suggestion, or null when it needs nothing (enough stock, or too little history to say). Pure. */
export function suggestItem(i: ReorderInput, opts: { coverDays?: number } = {}): ReorderSuggestion | null {
  const lead = i.leadDays ?? DEFAULT_LEAD_DAYS;
  const cover = opts.coverDays ?? DEFAULT_COVER_DAYS;
  const hist = Math.max(0, Math.min(90, Math.floor(i.historyDays)));
  if (hist < 7) return null;
  const d28 = Math.min(28, hist);
  const avg28 = i.sold28 / d28;
  const avg90 = i.sold90 / Math.min(90, hist);
  // With under 4 weeks of history the 28-day figure is the only honest one.
  const rate = hist >= 28 ? 0.6 * avg28 + 0.4 * avg90 : avg28;
  const trendPct = hist >= 28 && avg90 > 0 ? Math.round((avg28 / avg90 - 1) * 100) : null;
  const safety = rate > 0 ? Math.ceil(Z_SAFETY * stdev(i.daily28) * Math.sqrt(lead)) : 0;

  let uplift: FestivalUplift | null = null;
  let extra = 0;
  const fs = i.festival ?? null;
  if (fs && rate > 0) {
    uplift = festivalUplift(fs);
    if (uplift) {
      // Festival days that fall inside the stretch this purchase has to cover (today to arrival + cover).
      const horizon = lead + cover;
      const from = Math.max(0, fs.windowFromDay);
      const to = Math.min(horizon, fs.windowToDay);
      const overlap = Math.max(0, to - from + 1);
      extra = rate * (uplift.ratio - 1) * overlap;
    }
  }

  const demand = rate * (lead + cover) + extra + safety;
  const have = Math.max(0, i.stock) + Math.max(0, i.onOrder);
  let need = demand - have;
  const reasons: ReasonCode[] = [];
  const out = i.stock <= 0;
  const daysCover = rate > 0 ? r1(Math.max(0, i.stock) / rate) : null;

  if (rate === 0) {
    // Not selling: only top up to the level the owner set.
    if (i.reorderLevel > 0 && i.stock < i.reorderLevel && i.onOrder <= 0) {
      need = i.reorderLevel - i.stock;
      reasons.push(out ? "out_of_stock" : "below_reorder_level");
    } else return null;
  } else {
    if (need <= 0) return null;
    if (out) reasons.push("out_of_stock");
    else if (i.reorderLevel > 0 && i.stock <= i.reorderLevel) reasons.push("below_reorder_level");
    if (!out && daysCover !== null && daysCover < lead + 2) reasons.push("lead_time");
    if (trendPct !== null && trendPct >= 25) reasons.push("trend_up");
    if (uplift && extra > 0) reasons.push("festival");
    if (reasons.length === 0) reasons.push("lead_time");
  }
  const qty = Math.ceil(need - 1e-9);
  if (qty < 1) return null;

  const group: ReorderGroup =
    reasons.includes("festival") && extra >= 0.25 * qty
      ? "festival"
      : out
        ? "out"
        : reasons.includes("below_reorder_level") || reasons.includes("lead_time")
          ? "running_low"
          : reasons.includes("trend_up")
            ? "trending"
            : "routine";

  return {
    itemId: i.itemId,
    name: i.name,
    unit: i.unit,
    qty,
    group,
    reasons,
    stock: r2(i.stock),
    onOrder: r2(i.onOrder),
    reorderLevel: r2(i.reorderLevel),
    avgDaily: r2(rate),
    avgDaily28: r2(avg28),
    avgDaily90: r2(avg90),
    trendPct,
    daysCover,
    leadDays: lead,
    safetyStock: safety,
    ...(fs && uplift && extra > 0 ? { festival: { id: fs.id, name: fs.name, nameTa: fs.nameTa, daysAway: fs.daysAway, ratio: uplift.ratio, extraQty: Math.ceil(extra) } } : {}),
    supplierId: i.supplierId ?? null,
    supplierName: i.supplierName ?? null,
    lastRate: i.lastRate ?? null,
    gstRate: i.gstRate ?? null,
    hsn: i.hsn ?? null,
  };
}

export type ReorderLang = "en" | "ta";

export interface GroupSummary {
  group: ReorderGroup;
  items: number;
  /** Festival of the group (festival group only). */
  festival?: { name: string; nameTa: string; daysAway: number; maxRatio: number };
  /** The biggest few suggestions. */
  top: { name: string; qty: number; unit: string; stock: number; daysCover: number | null }[];
  /** How many of the group's items are out of stock now. */
  outCount: number;
}

/** Groups the suggestions (biggest first inside a group; groups in a fixed order). */
export function groupSuggestions(list: ReorderSuggestion[]): { summary: GroupSummary; items: ReorderSuggestion[] }[] {
  const out: { summary: GroupSummary; items: ReorderSuggestion[] }[] = [];
  for (const g of REORDER_GROUPS) {
    const items = list.filter((x) => x.group === g).sort((a, b) => b.qty - a.qty);
    if (!items.length) continue;
    const fest = items.find((x) => x.festival)?.festival;
    out.push({
      items,
      summary: {
        group: g,
        items: items.length,
        ...(g === "festival" && fest ? { festival: { name: fest.name, nameTa: fest.nameTa, daysAway: fest.daysAway, maxRatio: Math.max(...items.map((x) => x.festival?.ratio ?? 0)) } } : {}),
        top: items.slice(0, 3).map((x) => ({ name: x.name, qty: x.qty, unit: x.unit, stock: x.stock, daysCover: x.daysCover })),
        outCount: items.filter((x) => x.stock <= 0).length,
      },
    });
  }
  return out;
}

const names = (s: GroupSummary) => s.top.map((t) => t.name).join(", ");

/** The deterministic one-line reason for a group. Uses only numbers from the summary. */
export function templateGroupLine(s: GroupSummary, lang: ReorderLang): string {
  const ta = lang === "ta";
  switch (s.group) {
    case "festival": {
      const f = s.festival;
      if (f) {
        return ta
          ? `${f.nameTa}க்கு இன்னும் ${f.daysAway} நாள் உள்ளது; கடந்த ஆண்டு இதே நாட்களில் விற்பனை ${qtyText(f.maxRatio)} மடங்கு வரை உயர்ந்தது. இவற்றை முன்கூட்டியே வாங்குங்கள்: ${names(s)}.`
          : `${f.name} is ${f.daysAway} days away and last year these sold up to ${qtyText(f.maxRatio)}× faster in the same weeks. Stock up early: ${names(s)}.`;
      }
      return ta ? `பண்டிகைக்கு முன் தேவை கூடும்: ${names(s)}.` : `Demand rises before the festival: ${names(s)}.`;
    }
    case "out":
      return ta ? `${s.items} பொருள் கையிருப்பில் இல்லை, ஆனால் விற்பனையாகிறது: ${names(s)}.` : `${s.items} items are out of stock but still selling: ${names(s)}.`;
    case "running_low":
      return ta ? `${s.items} பொருள் ஆர்டர் வந்து சேரும் முன் தீர்ந்துவிடும் நிலையில் உள்ளது: ${names(s)}.` : `${s.items} items will run out before an order can arrive: ${names(s)}.`;
    case "trending":
      return ta ? `${s.items} பொருளின் விற்பனை சமீபத்தில் அதிகரித்துள்ளது: ${names(s)}.` : `Sales of ${s.items} items have picked up recently: ${names(s)}.`;
    default:
      return ta ? `${s.items} பொருளுக்கு வழக்கமான மறுநிரப்பல்: ${names(s)}.` : `Routine top-up for ${s.items} items: ${names(s)}.`;
  }
}

/** The facts sheet one group's line is written from (also the source of the numbers the line may use). */
export function groupSheet(s: GroupSummary): string {
  const lines = [`Group: ${s.group}`, `Items needing stock: ${s.items}`, `Out of stock now: ${s.outCount}`];
  if (s.festival) lines.push(`Festival: ${s.festival.name} (${s.festival.nameTa}) in ${s.festival.daysAway} days`, `Last year in the same weeks, sales per day were up to ${qtyText(s.festival.maxRatio)}x normal`);
  for (const t of s.top) lines.push(`Item: ${neutralise(t.name).text} | suggest ${qtyText(t.qty)} ${t.unit} | in stock ${qtyText(t.stock)}${t.daysCover !== null ? ` | lasts ${qtyText(t.daysCover)} days` : ""}`);
  return lines.join("\n");
}

export const REORDER_SYSTEM = [
  "You write one short, plain line for a small Indian shop owner about WHY a group of items should be reordered now. The line goes next to a list the shop's software already worked out.",
  "Use only the facts sheet of each group. Every number you write must be copied exactly from that group's sheet (for example the festival name, days away, how many items, the 'x' times). Never calculate or invent a number, price, discount or date. Do not promise anything.",
  "One sentence, at most 28 words, friendly and direct, in the requested language (en = English, ta = natural spoken Tamil in Tamil script; item names stay as given).",
  DATA_RULES,
].join("\n");

const Lines = z.object({ lines: z.array(z.object({ group: z.string(), text: z.string() })).max(8) });
const LINES_JSON = {
  type: "object",
  properties: { lines: { type: "array", items: { type: "object", properties: { group: { type: "string" }, text: { type: "string" } }, required: ["group", "text"], additionalProperties: false } } },
  required: ["lines"],
  additionalProperties: false,
} as const;

export interface ReasonLine {
  group: ReorderGroup;
  text: string;
  source: "ai" | "template";
}

export interface ExplainResult {
  lines: ReasonLine[];
  runId: string | null;
  credits: number;
  /** Why the AI was not used (error code), when it was not. */
  aiNote: string | null;
}

/**
 * One light-tier call for all groups. Per group: the AI line is kept only if every number in it is in that group's sheet;
 * otherwise the template line is used. A failed call (AI off, no credits...) gives template lines and the error code in
 * `aiNote`, so the suggestions still show.
 */
export async function explainGroups(ai: AiRunner, req: { tenantId: string; userId?: string | null; groups: GroupSummary[]; lang: ReorderLang }): Promise<ExplainResult> {
  const templates: ReasonLine[] = req.groups.map((g) => ({ group: g.group, text: templateGroupLine(g, req.lang), source: "template" }));
  if (!req.groups.length) return { lines: [], runId: null, credits: 0, aiNote: null };
  const sheets = new Map(req.groups.map((g) => [g.group as string, groupSheet(g)]));
  const text = [`Language: ${req.lang}`, ...req.groups.map((g) => dataBlock(`group ${g.group}`, sheets.get(g.group)!))].join("\n");
  try {
    const r = await ai.run<z.infer<typeof Lines>>({
      tenantId: req.tenantId,
      userId: req.userId ?? null,
      feature: REORDER_FEATURE,
      tier: "light",
      system: REORDER_SYSTEM,
      input: { text },
      schema: { name: "reorder_lines", jsonSchema: LINES_JSON as unknown as Record<string, unknown>, zod: Lines },
      maxTokens: 2500,
    });
    const lines = templates.map((t) => {
      const got = r.output.lines.find((l) => l.group === t.group)?.text?.replace(/\s+/g, " ").trim();
      if (!got || got.length > 320) return t;
      if (!checkNumbers(got, allowedNumbers(sheets.get(t.group)!)).ok) return t;
      return { group: t.group, text: got, source: "ai" as const };
    });
    return { lines, runId: r.runId, credits: r.credits, aiNote: null };
  } catch (e) {
    const code = (e as { code?: string }).code ?? "ai_failed";
    return { lines: templates, runId: null, credits: 0, aiNote: code };
  }
}
