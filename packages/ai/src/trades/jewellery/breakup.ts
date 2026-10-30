import { z } from "zod";
import { AppError } from "@rbms/core";
import type { AiRunner } from "../../assist/hsn";
import { dataBlock, DATA_RULES, filterClaims, neutralise } from "../../assist/safety";
import { allowedNumbers, checkNumbers, rupees } from "../../insights/numbers";
import type { AiSchema } from "../../types";

export const JEWELLERY_BREAKUP_FEATURE = "jewellery-breakup";
export const BREAKUP_CREDITS_HINT = 2;

/**
 * Everything the breakup needs, copied from the jewellery module's own price (`JewelleryService.piecePrice`): the day's rate
 * and `priceBreakdown(...)`. This file does NO price arithmetic of its own beyond checking that the module's lines add up.
 * Money is paise, weights are grams.
 */
export interface BreakupFacts {
  name: string;
  metal: string;
  purity: string;
  grossWeight: number;
  stoneWeight: number;
  netWeight: number;
  wastagePct: number;
  makingType: "per_gram" | "percent" | "flat";
  /** per_gram: paise per gram; percent: basis points; flat: paise (as stored on the piece). */
  makingValue: number;
  huid: string | null;
  rate: { ratePerGram: number; date: string | null };
  breakdown: {
    metalValue: number;
    wastage: number;
    making: number;
    stones: number;
    subtotal: number;
    rounding: number;
    total: number;
    gstRate: number;
    gst: number;
    totalWithGst: number;
  };
}

export interface BreakupLine {
  key: "metal" | "wastage" | "making" | "stones" | "rounding" | "gst";
  /** Paise (rounding may be negative). */
  amount: number;
  /** Plain figures behind the amount, ready to show ("5.25 g x ₹7,250 per g"). */
  detail: string;
}

export interface Breakup {
  /** The piece name with instruction-looking sentences removed (it is the shop's own text, but it goes to a model and to customers). */
  name: string;
  lines: BreakupLine[];
  /** GST-exclusive price. */
  total: number;
  gstRate: number;
  gst: number;
  /** What the customer pays. */
  totalWithGst: number;
  /** The facts sheet the explanation is checked against. */
  sheet: string;
}

const g = (n: number) => `${Math.round(n * 1000) / 1000} g`;

/** The lines of the breakup, from the module's price. Throws when the module's own lines do not add up (a bug, never shown to a customer). */
export function buildBreakup(f: BreakupFacts): Breakup {
  const b = f.breakdown;
  const name = neutralise(f.name).text.slice(0, 80).trim() || "Jewellery piece";
  const parts = b.metalValue + b.wastage + b.making + b.stones + b.rounding;
  if (parts !== b.total || b.total + b.gst !== b.totalWithGst) throw new AppError(500, "breakup_mismatch", "The price lines do not add up. Reprice the piece and try again.");
  const lines: BreakupLine[] = [{ key: "metal", amount: b.metalValue, detail: `${g(f.netWeight)} x ${rupees(f.rate.ratePerGram)} per g (${f.purity} ${f.metal})` }];
  if (b.wastage) lines.push({ key: "wastage", amount: b.wastage, detail: `${f.wastagePct}% of the metal value` });
  if (b.making) {
    const detail = f.makingType === "per_gram" ? `${rupees(f.makingValue)} per g x ${g(f.netWeight)}` : f.makingType === "percent" ? `${f.makingValue / 100}% of the metal value` : "fixed making charge";
    lines.push({ key: "making", amount: b.making, detail });
  }
  if (b.stones) lines.push({ key: "stones", amount: b.stones, detail: f.stoneWeight ? `stones ${g(f.stoneWeight)}` : "stones" });
  if (b.rounding) lines.push({ key: "rounding", amount: b.rounding, detail: "rounded to the nearest rupee" });
  lines.push({ key: "gst", amount: b.gst, detail: `GST ${b.gstRate}% on ${rupees(b.total)}` });
  const sheet = [
    `Piece: ${name}`,
    `${f.purity} ${f.metal}, gross weight ${g(f.grossWeight)}, stone weight ${g(f.stoneWeight)}, net weight ${g(f.netWeight)}`,
    `Today's rate: ${rupees(f.rate.ratePerGram)} per g${f.rate.date ? ` (${f.rate.date})` : ""}`,
    ...lines.map((l) => `${l.key}: ${rupees(l.amount)} (${l.detail})`),
    `Price before GST: ${rupees(b.total)}`,
    `GST rate: ${b.gstRate}%`,
    `Total to pay: ${rupees(b.totalWithGst)}`,
    f.huid ? `HUID: ${f.huid}` : "",
  ]
    .filter(Boolean)
    .join("\n");
  return { name, lines, total: b.total, gstRate: b.gstRate, gst: b.gst, totalWithGst: b.totalWithGst, sheet };
}

// ------------------------------------------------------------------ words

export const BREAKUP_SYSTEM = [
  "You write a short, friendly explanation of a jewellery price for the customer, on behalf of the jeweller. You are given the price sheet; the figures are final and already worked out.",
  "Write 2 to 4 short sentences in English (en) and the same in simple spoken Tamil (ta). Say how the price is made up: the gold or silver value at today's rate for the weight, any wastage, the making charge, any stones, then GST, and the total.",
  "Use ONLY numbers that are on the price sheet, written exactly as there (for example ₹12,450 and 5.25 g). Do not add, round, convert or work out any other number. Do not predict rates or say whether it is a good time to buy. Do not promise discounts, buy-back, exchange value, certification, purity guarantees or that anything is BIS verified. Do not mention the jeweller's cost or profit.",
  DATA_RULES,
].join("\n");

const OutSchema = z.object({ en: z.string().max(900), ta: z.string().max(1500) });
type Out = z.infer<typeof OutSchema>;
const OUT_JSON = { type: "object", properties: { en: { type: "string" }, ta: { type: "string" } }, required: ["en", "ta"], additionalProperties: false } as const;
const SCHEMA: AiSchema<Out> = { name: "price_explanation", jsonSchema: OUT_JSON as unknown as Record<string, unknown>, zod: OutSchema };

/** Sentences about the future price of metal, investment or timing: never allowed. */
const PREDICTION = [
  /\b(?:will|may|might|could|is likely to|expected to|going to)\s+(?:go\s+up|rise|increase|fall|drop|decrease|decline|climb|surge|jump)\b/i,
  /\b(?:forecast|prediction|predict|projected|outlook|invest(?:ment)?|good time to buy|best time to buy|buy now|before (?:the )?(?:rate|price)s?\b)/i,
  /(?:உயரும்|குறையும்|அதிகரிக்கும்|வீழ்ச்சி|முதலீடு|வாங்க சரியான நேரம்|விலை ஏறும்|விலை குறையும்)/,
];

const SENTENCES = (t: string) => t.split(/(?<=[.!?।])\s+/).map((s) => s.trim()).filter(Boolean);

/** Removes prediction sentences and unsupported promises; the facts sheet is what the shop actually said. */
export function cleanExplanation(text: string, sheet: string): { text: string; removed: number } {
  let removed = 0;
  const kept = SENTENCES(text).filter((s) => {
    if (PREDICTION.some((re) => re.test(s))) {
      removed++;
      return false;
    }
    return true;
  });
  const f = filterClaims(kept.join(" "), sheet);
  removed += f.removed.length;
  return { text: f.text.trim(), removed };
}

/** The words without AI: always available, used when AI is off, fails, or its numbers do not check out. */
export function templateExplanation(f: BreakupFacts, b: Breakup): { en: string; ta: string } {
  const parts = b.lines.filter((l) => l.key !== "gst" && l.key !== "rounding");
  const name = (k: string, ta: boolean) =>
    ({ metal: ta ? "தங்கம்/உலோக மதிப்பு" : `${f.metal} value`, wastage: ta ? "வீணாக்கு (wastage)" : "wastage", making: ta ? "செய்கூலி" : "making charge", stones: ta ? "கற்கள்" : "stones" })[k] ?? k;
  const en =
    `This ${f.purity} ${f.metal} piece has a net weight of ${g(f.netWeight)} at today's rate of ${rupees(f.rate.ratePerGram)} per g. ` +
    `${parts.map((l) => `${name(l.key, false)} ${rupees(l.amount)}`).join(", ")}. ` +
    `That is ${rupees(b.total)} before GST; GST at ${b.gstRate}% is ${rupees(b.gst)}, so the total is ${rupees(b.totalWithGst)}.`;
  const ta =
    `இந்த ${f.purity} ${f.metal} நகையின் நிகர எடை ${g(f.netWeight)}; இன்றைய விலை ${rupees(f.rate.ratePerGram)} / கிராம். ` +
    `${parts.map((l) => `${name(l.key, true)} ${rupees(l.amount)}`).join(", ")}. ` +
    `GST-க்கு முன் ${rupees(b.total)}; ${b.gstRate}% GST ${rupees(b.gst)}; மொத்தம் ${rupees(b.totalWithGst)}.`;
  return { en, ta };
}

export interface BreakupResult {
  breakup: Breakup;
  text: { en: string; ta: string };
  /** "ai" when the words came from the model and passed every check, else "template". */
  source: "ai" | "template";
  /** Why the template was used. */
  fallback: string | null;
  runId: string | null;
  credits: number;
}

/**
 * The customer's price breakup. Numbers come from the jewellery module; the light tier writes friendly en + ta words that
 * are number-checked against the price sheet and stripped of predictions and promises. A draft the jeweller can edit, print or share.
 */
export async function explainBreakup(ai: AiRunner, req: { tenantId: string; userId?: string | null; facts: BreakupFacts; words?: boolean }): Promise<BreakupResult> {
  const breakup = buildBreakup(req.facts);
  const template = templateExplanation(req.facts, breakup);
  const base = { breakup, text: template, source: "template" as const, runId: null, credits: 0 };
  if (req.words === false) return { ...base, fallback: "not_asked" };
  try {
    const r = await ai.run<Out>({
      tenantId: req.tenantId,
      userId: req.userId ?? null,
      feature: JEWELLERY_BREAKUP_FEATURE,
      tier: "light",
      system: BREAKUP_SYSTEM,
      input: { text: [dataBlock("price sheet", breakup.sheet), "Write the explanation. Return the JSON structure only."].join("\n") },
      schema: SCHEMA,
      maxTokens: 1200,
    });
    const allowed = allowedNumbers(breakup.sheet);
    const en = cleanExplanation(r.output.en, breakup.sheet);
    const ta = cleanExplanation(r.output.ta, breakup.sheet);
    const bad = !en.text || !ta.text || !checkNumbers(en.text, allowed).ok || !checkNumbers(ta.text, allowed).ok;
    if (bad) return { ...base, runId: r.runId, credits: r.credits, fallback: !en.text || !ta.text ? "empty" : "numbers" };
    return { breakup, text: { en: en.text, ta: ta.text }, source: "ai", fallback: null, runId: r.runId, credits: r.credits };
  } catch (e) {
    // AI off / no credits / failure: the numbers are still right, the words come from the template. Switch and credit errors are told to the person.
    if (e instanceof AppError && ["ai_off", "ai_feature_off", "ai_credits_exhausted", "ai_disabled", "ai_not_available"].includes(e.code)) throw e;
    return { ...base, fallback: e instanceof AppError ? e.code : "ai_failed" };
  }
}

/** Plain text for WhatsApp / copy: the lines, the total, and the shop's name. */
export function shareText(b: Breakup, f: BreakupFacts, opts: { shop?: string | null; lang: "en" | "ta"; words?: string }): string {
  const L = (en: string, ta: string) => (opts.lang === "ta" ? ta : en);
  const label = (k: BreakupLine["key"]) =>
    ({
      metal: L(`${f.purity} ${f.metal} (${g(f.netWeight)} x ${rupees(f.rate.ratePerGram)}/g)`, `${f.purity} ${f.metal} (${g(f.netWeight)} x ${rupees(f.rate.ratePerGram)}/கிராம்)`),
      wastage: L("Wastage", "வீணாக்கு"),
      making: L("Making charge", "செய்கூலி"),
      stones: L("Stones", "கற்கள்"),
      rounding: L("Rounding", "ரவுண்டிங்"),
      gst: `GST ${b.gstRate}%`,
    })[k];
  return [
    opts.shop ? `*${opts.shop}*` : "",
    `${b.name}${f.huid ? ` (HUID ${f.huid})` : ""}`,
    ...b.lines.map((l) => `${label(l.key)}: ${rupees(l.amount)}`),
    `*${L("Total", "மொத்தம்")}: ${rupees(b.totalWithGst)}*`,
    f.rate.date ? L(`Rate of ${f.rate.date}`, `${f.rate.date} அன்றைய விலை`) : "",
    opts.words ? `\n${opts.words}` : "",
  ]
    .filter((x) => x !== "")
    .join("\n");
}
