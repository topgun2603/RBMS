import { effectiveGstRate, GST_RATES, priceBandRuleForHsn, type GstPriceBandRule } from "@srirealtime/gst";
import { badRequest } from "@srirealtime/core";
import { z } from "zod";
import type { AiService } from "../service";
import { digitsOf, lookupHsn, sacHeadings, searchHeadings, sharesWord, validateHsn, type HsnEntry } from "./hsn-ref";
import { DATA_RULES, dataBlock, neutralise, outputLooksInjected } from "./safety";
import type { AiRunResult } from "../types";

export type AiRunner = Pick<AiService, "run">;

export const HSN_FEATURE = "hsn-suggest";

const RATES = GST_RATES.join(", ");

/** Stable system prompt (cached). No dates or ids in it. */
export const HSN_SYSTEM = [
  "You suggest the HSN code (goods) or SAC code (services) and the usual GST rate for an item a small Indian shop sells. The item name may be in Tamil, Tanglish (Tamil in Roman letters) or English.",
  "Give up to 3 candidates, best first. Give the most specific code you are sure of: a 4-digit heading, or a 6-digit subheading only when you are certain of it. Never invent a code. Services use SAC codes that start with 99.",
  "kind is goods or service. official_title is the official title of that code as you know it (a few words). gstRate must be one of: " + RATES + " (percent), the usual rate for that code. confidence is low when the name is vague or you are unsure. reason is one short English sentence.",
  "If a list of candidate headings is given, choose only from that list.",
  DATA_RULES,
].join("\n");

const CONFIDENCE = ["low", "medium", "high"] as const;
type Confidence = (typeof CONFIDENCE)[number];

const RawSchema = z.object({
  suggestions: z
    .array(z.object({ hsn: z.string(), kind: z.enum(["goods", "service"]), official_title: z.string(), gstRate: z.number(), confidence: z.enum(CONFIDENCE), reason: z.string() }))
    .max(5),
});
type Raw = z.infer<typeof RawSchema>;

const RAW_JSON_SCHEMA = {
  type: "object",
  properties: {
    suggestions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          hsn: { type: "string" },
          kind: { type: "string", enum: ["goods", "service"] },
          official_title: { type: "string" },
          gstRate: { type: "number", enum: [...GST_RATES] },
          confidence: { type: "string", enum: [...CONFIDENCE] },
          reason: { type: "string" },
        },
        required: ["hsn", "kind", "official_title", "gstRate", "confidence", "reason"],
        additionalProperties: false,
      },
    },
  },
  required: ["suggestions"],
  additionalProperties: false,
} as const;

export interface HsnSuggestion {
  /** 4 or 6 digits, checked against the reference. */
  hsn: string;
  kind: "goods" | "service";
  /** Official description from the GST portal master. */
  description: string;
  /** The usual rate: show it as "usual rate, verify". */
  gstRate: number;
  /** Apparel / footwear: the price-band rule that applies (5% up to the threshold, 18% above). */
  gstRule: GstPriceBandRule | null;
  confidence: Confidence;
  reason: string;
}

export interface HsnResult {
  suggestions: HsnSuggestion[];
  /** No checked code: show "not sure, please check". */
  notSure: boolean;
  runId: string | null;
  credits: number;
  /** Asked again with candidate headings because a code failed the check. */
  retried: boolean;
  /** Asked the standard tier because confidence was low. */
  escalated: boolean;
}

export interface HsnInput {
  tenantId: string;
  userId?: string | null;
  name: string;
  /** Category name, trade or brand: helps with vague names. */
  hint?: string;
  /** Price in paise, to pick the band for apparel / footwear. */
  price?: number | null;
}

const rank = (c: Confidence) => CONFIDENCE.indexOf(c);

function buildInput(name: string, hint: string | undefined, candidates?: HsnEntry[]): string {
  const parts = [dataBlock("item name", name)];
  if (hint) parts.push(dataBlock("category", hint));
  if (candidates?.length) {
    parts.push("Candidate headings (choose only from these):\n" + candidates.map((c) => `${c.code} ${c.description}`).join("\n"));
  }
  return parts.join("\n");
}

/** Turns the model's raw rows into checked suggestions: real code, official description, allowed rate, price-band rule. */
export function checkSuggestions(raw: Raw, price: number | null | undefined, payloads: string[], opts: { checkTitle?: boolean } = {}): HsnSuggestion[] {
  const seen = new Set<string>();
  const out: HsnSuggestion[] = [];
  for (const s of raw.suggestions) {
    if (outputLooksInjected(s, payloads)) continue;
    const v = validateHsn(s.hsn);
    if (!v || seen.has(v.code)) continue;
    // A real code with the wrong meaning (a hallucinated "9972 beauty services" is real estate): the title the model gives must
    // share a word with the official one. Skipped on the re-ask, where the model chose from official descriptions.
    if (opts.checkTitle !== false && s.official_title.trim() && !sharesWord(s.official_title, v.description) && !sharesWord(s.official_title, lookupHsn(v.code.slice(0, 4))?.description ?? "")) continue;
    seen.add(v.code);
    const rule = priceBandRuleForHsn(v.code);
    const allowed = (GST_RATES as readonly number[]).includes(s.gstRate);
    const rate = rule ? (typeof price === "number" && price > 0 ? effectiveGstRate(rule, price) : rule.below) : allowed ? s.gstRate : 0;
    // A code cut back to its heading (or a rate the model made up) is less certain than the model says.
    let confidence = s.confidence;
    if (digitsOf(s.hsn).length > v.code.length && confidence === "high") confidence = "medium";
    if (!rule && !allowed) confidence = rank(confidence) > 1 ? "medium" : confidence;
    out.push({
      hsn: v.code,
      kind: v.kind,
      description: v.description,
      gstRate: rate,
      gstRule: rule,
      confidence,
      reason: s.reason.slice(0, 240),
    });
    if (out.length === 3) break;
  }
  return out.sort((a, b) => rank(b.confidence) - rank(a.confidence));
}

/**
 * HSN / SAC + GST rate suggestions (feature `hsn-suggest`). Light tier first. Every code is checked against the official
 * reference: if none passes, ask once more with candidate headings found by keyword search of the reference, and if that
 * fails too the answer is "not sure". Low confidence escalates once to the standard tier. Nothing is saved: the owner accepts
 * a suggestion into the form.
 */
export async function suggestHsn(ai: AiRunner, req: HsnInput): Promise<HsnResult> {
  const clean = neutralise(req.name);
  const name = clean.text.slice(0, 200);
  if (!name) throw badRequest("Give the item a name first");
  const hint = req.hint ? neutralise(req.hint).text.slice(0, 80) : undefined;
  const base = { tenantId: req.tenantId, userId: req.userId ?? null, feature: HSN_FEATURE, system: HSN_SYSTEM, maxTokens: 1500 };
  const schema = { name: "hsn_suggestions", jsonSchema: RAW_JSON_SCHEMA as unknown as Record<string, unknown>, zod: RawSchema };

  let credits = 0;
  let runId: string | null = null;
  const ask = async (tier: "light" | "standard", candidates?: HsnEntry[]): Promise<{ r: AiRunResult<Raw>; list: HsnSuggestion[] }> => {
    const r = await ai.run<Raw>({ ...base, tier, input: { text: buildInput(name, hint, candidates) }, schema });
    credits += r.credits;
    runId = r.runId;
    return { r, list: checkSuggestions(r.output, req.price, clean.payloads, { checkTitle: !candidates }) };
  };

  let retried = false;
  let escalated = false;
  let first = await ask("light");
  if (first.list.length === 0) {
    retried = true;
    const words = [name, ...first.r.output.suggestions.map((s) => s.reason)].join(" ");
    const candidates = [...searchHeadings(words, 14), ...(first.r.output.suggestions.some((s) => s.kind === "service") ? sacHeadings() : [])];
    if (candidates.length) first = await ask("light", candidates);
  }
  let list = first.list;
  if (list.length > 0 && rank(list[0]!.confidence) === 0) {
    escalated = true;
    const second = await ask("standard", retried ? searchHeadings(name, 10) : undefined);
    if (second.list.length > 0) list = second.list;
  }
  return { suggestions: list, notSure: list.length === 0, runId, credits, retried, escalated };
}
