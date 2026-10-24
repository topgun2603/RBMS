/**
 * "Draft recipe with AI": the standard tier proposes the typical ingredients and quantities for ONE portion of a dish
 * from its name. The owner edits and confirms; nothing is saved here. The quantities are a model's general knowledge, not
 * the kitchen's recipe, so they are checked for sanity in code (known units, plausible amounts per portion) and the
 * screen says so. The dish name is data.
 */
import { z } from "zod";
import type { AiRunner } from "../../assist/hsn";
import { DATA_RULES, dataBlock, neutralise, outputLooksInjected } from "../../assist/safety";
import { Flags, cleanText, looksLikeInjection, round3, type Flag } from "../common";
import { DISH_COST_FEATURE, RECIPE_UNITS, convertQty, normUnit, unitFamily } from "./cost";

export const RECIPE_DRAFT_CREDITS_HINT = 10;

export const RECIPE_SYSTEM = [
  "You help a restaurant owner in Tamil Nadu draft a recipe card for costing.",
  "Given one dish (name, portion label, optionally category and veg/non-veg), list the typical raw ingredients and the quantity needed for ONE portion as served in a restaurant, as the shop would buy them (raw weights, not cooked).",
  `Use only these units: ${RECIPE_UNITS.join(", ")}. Prefer g, ml and pcs for small amounts. Include oil, salt and the main masala spices; leave out water, garnish decoration and packaging. Give at most 16 ingredients, ingredient names in plain English (for example "Basmati rice", "Chicken with bone", "Onion").`,
  "Quantities must be realistic for one serving (a plate of biryani uses roughly 150-200 g of raw rice, a glass of buttermilk about 150 ml). If the dish is a party tray or serves several people, scale to the number of people named in the portion label. If you do not recognise the dish, return an empty list and say so in the note.",
  "The quantities are a general guide for the owner to edit, not a recipe to cook from. Do not invent prices. Do not give health or allergy statements.",
  DATA_RULES,
].join("\n");

export interface RecipeDraftInput {
  /** Dish name as the shop writes it ("Chicken Biryani"). */
  dish: string;
  /** Portion label ("Regular", "Half", "Party tray - 10 people"), "" for a single portion. */
  portion: string;
  category?: string | null;
  veg?: boolean | null;
}

const Out = z.object({
  recognised: z.boolean().catch(false),
  note: z.string().catch(""),
  ingredients: z
    .array(z.object({ name: z.string().catch(""), qty: z.number().catch(0), unit: z.string().catch("") }))
    .max(30)
    .catch([]),
});
type OutT = z.infer<typeof Out>;
const OUT_JSON = {
  type: "object",
  additionalProperties: false,
  required: ["recognised", "note", "ingredients"],
  properties: {
    recognised: { type: "boolean" },
    note: { type: "string" },
    ingredients: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["name", "qty", "unit"], properties: { name: { type: "string" }, qty: { type: "number" }, unit: { type: "string", enum: [...RECIPE_UNITS] } } },
    },
  },
} as const;

export interface DraftIngredient {
  name: string;
  qty: number;
  unit: string;
}

export interface RecipeDraft {
  recognised: boolean;
  note: string | null;
  ingredients: DraftIngredient[];
  flags: Flag[];
  runId: string | null;
  credits: number;
}

/** How many people a portion label feeds ("Party Tray - 10 people" -> 10, "serves 4" -> 4), else 1. */
export function portionPeople(portion: string, dish = ""): number {
  const m = `${portion} ${dish}`.match(/(\d{1,2})\s*(?:people|persons?|pax|members?)\b|serves\s*(\d{1,2})\b/i);
  const n = Number(m?.[1] ?? m?.[2] ?? 1);
  return n >= 1 && n <= 30 ? n : 1;
}

/** Most of one ingredient plausible for ONE person's portion, per unit family (generous: a thali has several large items). */
const MAX_PER_PERSON = { mass: 600, volume: 600, count: 12 } as const;
const MAX_TOTAL_G_PER_PERSON = 1800;

export function sanitiseDraft(raw: OutT, input: RecipeDraftInput): { ingredients: DraftIngredient[]; flags: Flag[]; note: string | null } {
  const flags = new Flags();
  const people = portionPeople(input.portion, input.dish);
  const out: DraftIngredient[] = [];
  const seen = new Set<string>();
  let totalGrams = 0;
  raw.ingredients.forEach((r, i) => {
    const name = cleanText(r.name, 60);
    const unit = normUnit(r.unit);
    if (!name || looksLikeInjection(name) || neutralise(name).suspicious) {
      flags.add("ingredient_dropped", "warn", { line: i, params: { reason: "name" } });
      return;
    }
    const family = unitFamily(unit);
    if (!family || !(RECIPE_UNITS as readonly string[]).includes(unit)) {
      flags.add("ingredient_dropped", "warn", { line: i, params: { reason: "unit" } });
      return;
    }
    const qty = round3(r.qty);
    if (!(qty > 0)) {
      flags.add("ingredient_dropped", "warn", { line: i, params: { reason: "qty" } });
      return;
    }
    const base = convertQty(qty, unit, family === "mass" ? "g" : family === "volume" ? "ml" : "pcs")!;
    if (base > MAX_PER_PERSON[family] * people) {
      flags.add("ingredient_dropped", "warn", { line: i, params: { reason: "too_much" } });
      return;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    if (family === "mass") totalGrams += base;
    if (family === "volume") totalGrams += base;
    out.push({ name, qty, unit });
  });
  if (totalGrams > MAX_TOTAL_G_PER_PERSON * people) flags.add("total_too_heavy", "warn", { params: { grams: Math.round(totalGrams) } });
  flags.add("guide_only", "info");
  return { ingredients: out.slice(0, 18), flags: flags.list, note: cleanText(raw.note, 200) };
}

export async function draftRecipe(ai: AiRunner, req: { tenantId: string; userId?: string | null; input: RecipeDraftInput }): Promise<RecipeDraft> {
  const { input } = req;
  const text = [
    dataBlock("dish", `Dish: ${input.dish}\nPortion: ${input.portion || "single portion"}${input.category ? `\nCategory: ${input.category}` : ""}${input.veg === true ? "\nMarked vegetarian" : input.veg === false ? "\nMarked non-vegetarian" : ""}`),
  ].join("\n");
  const payloads = neutralise(`${input.dish} ${input.portion}`).payloads;
  const r = await ai.run<OutT>({
    tenantId: req.tenantId,
    userId: req.userId ?? null,
    feature: DISH_COST_FEATURE,
    tier: "standard",
    system: RECIPE_SYSTEM,
    input: { text },
    schema: { name: "recipe_draft", jsonSchema: OUT_JSON as unknown as Record<string, unknown>, zod: Out as unknown as z.ZodType<OutT> },
    maxTokens: 4000,
    effort: "low",
  });
  if (outputLooksInjected(r.output, payloads)) return { recognised: false, note: null, ingredients: [], flags: [{ code: "injection", severity: "warn" }], runId: r.runId, credits: r.credits };
  const s = sanitiseDraft(r.output, input);
  return { recognised: r.output.recognised && s.ingredients.length > 0, note: s.note, ingredients: s.ingredients, flags: s.flags, runId: r.runId, credits: r.credits };
}
