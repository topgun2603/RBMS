/**
 * Recipes and dish food cost. Every number here is computed in code from the recipe lines, the ingredient prices (latest
 * purchase rate or item cost when the shop buys through the inventory module, else the price the owner typed) and the
 * dish's selling price. The model drafts ingredient lists (recipe-draft.ts) and writes one summary sentence (below, with
 * the number check); it never calculates a cost.
 */
import { z } from "zod";
import type { AiRunner } from "../../assist/hsn";
import { DATA_RULES, dataBlock } from "../../assist/safety";
import { allowedNumbers, checkNumbers, rupees } from "../../insights/numbers";
import { round2 } from "../common";

export const DISH_COST_FEATURE = "dish-cost";
export const DEFAULT_TARGET_PCT = 35;

// ------------------------------------------------------------------ units

export type UnitFamily = "mass" | "volume" | "count";
/** Multipliers to the family's base unit (g, ml, piece). */
const UNITS: Record<string, { family: UnitFamily; to: number }> = {
  mg: { family: "mass", to: 0.001 },
  g: { family: "mass", to: 1 },
  gm: { family: "mass", to: 1 },
  gram: { family: "mass", to: 1 },
  grams: { family: "mass", to: 1 },
  kg: { family: "mass", to: 1000 },
  kgs: { family: "mass", to: 1000 },
  ml: { family: "volume", to: 1 },
  l: { family: "volume", to: 1000 },
  lt: { family: "volume", to: 1000 },
  ltr: { family: "volume", to: 1000 },
  litre: { family: "volume", to: 1000 },
  liter: { family: "volume", to: 1000 },
  tsp: { family: "volume", to: 5 },
  tbsp: { family: "volume", to: 15 },
  cup: { family: "volume", to: 240 },
  pcs: { family: "count", to: 1 },
  pc: { family: "count", to: 1 },
  nos: { family: "count", to: 1 },
  no: { family: "count", to: 1 },
  piece: { family: "count", to: 1 },
  pieces: { family: "count", to: 1 },
  each: { family: "count", to: 1 },
  dozen: { family: "count", to: 12 },
};

/** Units the recipe editor offers. */
export const RECIPE_UNITS = ["g", "kg", "ml", "l", "tsp", "tbsp", "cup", "pcs"] as const;
/** Units an ingredient price can be quoted in. */
export const PRICE_UNITS = ["kg", "g", "l", "ml", "pcs", "dozen"] as const;

export const normUnit = (u: string | null | undefined) => (u ?? "").trim().toLowerCase().replace(/\.$/, "");
export const unitFamily = (u: string): UnitFamily | null => UNITS[normUnit(u)]?.family ?? null;

/** `qty` of `from` expressed in `to`; null when the two are different kinds (mass vs volume vs count) or unknown. */
export function convertQty(qty: number, from: string, to: string): number | null {
  const a = UNITS[normUnit(from)];
  const b = UNITS[normUnit(to)];
  if (!a || !b || a.family !== b.family || !Number.isFinite(qty)) return null;
  return (qty * a.to) / b.to;
}

// ------------------------------------------------------------------ cost

export interface IngredientPrice {
  /** Paise per `unit`, excluding GST. */
  price: number | null;
  /** The unit the price is for: "kg", "l", "pcs"... */
  unit: string;
  /** Where the price came from, for the screen. */
  source: "purchase" | "avg_cost" | "item_cost" | "manual" | null;
}

export interface CostLine {
  name: string;
  qty: number;
  unit: string;
  price: IngredientPrice | null;
}

export interface CostedLine extends CostLine {
  /** Paise, null when the line cannot be priced. */
  cost: number | null;
  /** Why not: "no_price" | "unit_mismatch". */
  problem: "no_price" | "unit_mismatch" | null;
}

export interface DishCost {
  lines: CostedLine[];
  /** Paise per portion, of the lines that could be priced. */
  cost: number;
  /** Lines that could not be priced: the cost is then a lower bound. */
  incomplete: boolean;
  /** Selling price per portion, paise excluding GST. */
  sellingPrice: number;
  /** cost / selling price, percent with one decimal; null when there is no price or no priced line. */
  foodCostPct: number | null;
  targetPct: number;
  overTarget: boolean;
  /** Paise left per portion at the selling price. */
  margin: number;
}

export function costLine(l: CostLine): CostedLine {
  if (!l.price || l.price.price === null) return { ...l, cost: null, problem: "no_price" };
  const q = convertQty(l.qty, l.unit, l.price.unit);
  if (q === null) return { ...l, cost: null, problem: "unit_mismatch" };
  return { ...l, cost: Math.round(q * l.price.price), problem: null };
}

export function costDish(lines: CostLine[], sellingPrice: number, targetPct = DEFAULT_TARGET_PCT): DishCost {
  const costed = lines.map(costLine);
  const cost = costed.reduce((s, l) => s + (l.cost ?? 0), 0);
  const priced = costed.some((l) => l.cost !== null);
  const pct = sellingPrice > 0 && priced ? Math.round((cost / sellingPrice) * 1000) / 10 : null;
  return {
    lines: costed,
    cost,
    incomplete: costed.some((l) => l.cost === null),
    sellingPrice,
    foodCostPct: pct,
    targetPct,
    // An incomplete cost is a lower bound: it can prove a dish is over target, never that it is under.
    overTarget: pct !== null && pct > targetPct,
    margin: sellingPrice - cost,
  };
}

// ------------------------------------------------------------------ summary sentence (light tier)

export type CostLang = "en" | "ta";

export interface DishRow {
  name: string;
  foodCostPct: number | null;
  cost: number;
  sellingPrice: number;
  incomplete: boolean;
  overTarget: boolean;
}

export interface CostSummaryFacts {
  targetPct: number;
  dishes: number;
  withRecipe: number;
  over: DishRow[];
  /** Number of dishes over target (may exceed `over.length`). */
  overCount: number;
  incompleteCount: number;
}

export function summaryFacts(rows: DishRow[], total: number, targetPct: number): CostSummaryFacts {
  const withCost = rows.filter((r) => r.foodCostPct !== null);
  const over = withCost.filter((r) => r.overTarget).sort((a, b) => (b.foodCostPct ?? 0) - (a.foodCostPct ?? 0));
  return { targetPct, dishes: total, withRecipe: rows.length, over: over.slice(0, 5), overCount: over.length, incompleteCount: rows.filter((r) => r.incomplete).length };
}

export function factsSheet(f: CostSummaryFacts): string {
  return [
    `target food cost: ${f.targetPct}%`,
    `dishes: ${f.dishes}`,
    `dishes with a recipe: ${f.withRecipe}`,
    `dishes above target: ${f.overCount}`,
    `recipes with an unpriced ingredient: ${f.incompleteCount}`,
    ...f.over.map((d) => `${d.name}: food cost ${d.foodCostPct}% (cost ${rupees(d.cost)} on price ${rupees(d.sellingPrice)})`),
  ].join("\n");
}

export function templateSummary(f: CostSummaryFacts, lang: CostLang): string {
  if (f.withRecipe === 0) return lang === "ta" ? "இன்னும் எந்த உணவுக்கும் சமையல் குறிப்பு இல்லை." : "No dish has a recipe yet.";
  if (f.overCount === 0) return lang === "ta" ? `${f.withRecipe} உணவுகளும் ${f.targetPct}% இலக்குக்குள் உள்ளன.` : `All ${f.withRecipe} costed dishes are within the ${f.targetPct}% target.`;
  const names = f.over.slice(0, 3).map((d) => `${d.name} (${d.foodCostPct}%)`).join(", ");
  return lang === "ta" ? `${f.overCount} உணவுகள் ${f.targetPct}% இலக்கை மீறுகின்றன: ${names}.` : `${f.overCount} dish(es) are above the ${f.targetPct}% target: ${names}.`;
}

export const COST_SUMMARY_SYSTEM = [
  "You write one short sentence (at most 35 words) summarising the food cost of a restaurant's menu for the owner, in the language asked (en = English, ta = Tamil).",
  "Use only numbers that are written in the facts sheet; never calculate, round or invent a number. Do not give pricing, menu or hiring advice; just say which dishes are above the target.",
  DATA_RULES,
].join("\n");
const Out = z.object({ summary: z.string() });
const OUT_JSON = { type: "object", properties: { summary: { type: "string" } }, required: ["summary"], additionalProperties: false } as const;

export async function writeCostSummary(ai: AiRunner, req: { tenantId: string; userId?: string | null; facts: CostSummaryFacts; lang: CostLang }) {
  const template = templateSummary(req.facts, req.lang);
  if (req.facts.withRecipe === 0) return { text: template, source: "template" as const, runId: null as string | null, credits: 0, aiNote: null as string | null };
  const sheet = factsSheet(req.facts);
  try {
    const r = await ai.run<z.infer<typeof Out>>({
      tenantId: req.tenantId,
      userId: req.userId ?? null,
      feature: DISH_COST_FEATURE,
      tier: "light",
      system: COST_SUMMARY_SYSTEM,
      input: { text: `Language: ${req.lang}\n${dataBlock("facts sheet", sheet)}` },
      schema: { name: "food_cost_summary", jsonSchema: OUT_JSON as unknown as Record<string, unknown>, zod: Out },
      maxTokens: 1500,
    });
    const got = r.output.summary.replace(/\s+/g, " ").trim();
    const ok = got.length > 0 && got.length <= 320 && checkNumbers(got, allowedNumbers(sheet)).ok && (req.lang !== "ta" || /[஀-௿]/.test(got));
    return { text: ok ? got : template, source: ok ? ("ai" as const) : ("template" as const), runId: r.runId as string | null, credits: r.credits, aiNote: ok ? null : "numbers" };
  } catch (e) {
    return { text: template, source: "template" as const, runId: null as string | null, credits: 0, aiNote: (e as { code?: string }).code ?? "ai_failed" };
  }
}

export { round2 };
