import { z } from "zod";
import type { AiRunner } from "../../assist/hsn";
import { DATA_RULES, dataBlock, neutralise, outputLooksInjected, sentences } from "../../assist/safety";
import type { AiSchema } from "../../types";

/**
 * Phase 3 part C, repair shops: a draft fault note for a new device job card from the customer's complaint (typed or spoken;
 * Tamil, English or Tanglish). The model writes words and names what it would look for; the parts and labour it names are
 * matched to the shop's OWN catalogue in code and the estimate range comes from those items' rates. A price in the model's
 * text is removed. The technician edits everything; nothing is quoted to the customer.
 */
export const FAULT_NOTE_FEATURE = "fault-note";

export const FAULT_SYSTEM = [
  "You help a technician at an Indian repair or electronics shop (mobile phones, laptops, TVs, ACs, appliances) write the intake note for a new job card from the customer's complaint. The complaint may be in Tamil, Tanglish (Tamil in Roman letters) or English, possibly typed from speech.",
  "Return: summary = the complaint restated clearly in 1 or 2 short sentences in the requested language, using only what the customer said; causes = at most 3 POSSIBLE causes, each phrased as a possibility (\"may be\", \"possible\", or the Tamil equivalent), most likely first; checks = at most 5 short things the technician should check or test first; needs = up to 5 items the repair is likely to need, each {kind: part or labour, keyword: 1 to 3 English words that would appear in a parts or labour list, such as \"display\", \"battery\", \"charging port\", \"screen replacement\"}.",
  "Never state a price, cost, rupee amount, time to repair or a promise (no \"will be fixed\", \"free\", \"warranty\"). Never claim a diagnosis is certain. Do not ask for the phone's passcode or PIN. If the complaint is unclear, say so in the summary and keep causes empty.",
  "The requested language is given as en or ta; checks and causes follow it. Keep keywords in English always.",
  DATA_RULES,
].join("\n");

const NEED_KINDS = ["part", "labour"] as const;
export const FaultRawSchema = z.object({
  summary: z.string().catch(""),
  causes: z.array(z.string()).max(6).catch([]),
  checks: z.array(z.string()).max(8).catch([]),
  needs: z.array(z.object({ kind: z.enum(NEED_KINDS).catch("part"), keyword: z.string() })).max(8).catch([]),
});
export type FaultRaw = z.infer<typeof FaultRawSchema>;

export const FAULT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "causes", "checks", "needs"],
  properties: {
    summary: { type: "string" },
    causes: { type: "array", items: { type: "string" } },
    checks: { type: "array", items: { type: "string" } },
    needs: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["kind", "keyword"], properties: { kind: { type: "string", enum: [...NEED_KINDS] }, keyword: { type: "string" } } },
    },
  },
} as const;
export const FAULT_SCHEMA: AiSchema<FaultRaw> = { name: "fault_note", jsonSchema: FAULT_JSON_SCHEMA as unknown as Record<string, unknown>, zod: FaultRawSchema as unknown as z.ZodType<FaultRaw> };

/** A catalogue item the shop sells or uses (rate in paise, before GST). */
export interface CatalogueHit {
  id: string;
  name: string;
  rate: number;
  gstRate: number;
  unit?: string | null;
  stockQty?: number | null;
}
export interface FaultPorts {
  /** The shop's own catalogue search (read-only). */
  search(q: string): Promise<CatalogueHit[]>;
}

export interface FaultNeed {
  kind: "part" | "labour";
  keyword: string;
  /** Items found in the shop's catalogue for this need (best first, at most 3). */
  matches: CatalogueHit[];
}
export interface FaultEstimate {
  /** Paise before GST: the cheapest and dearest matched item of each need, added up. */
  low: number;
  high: number;
  /** Paise including GST at each item's rate. */
  lowWithGst: number;
  highWithGst: number;
  /** Needs with no price (nothing in the catalogue), so the range is partial. */
  unpriced: string[];
}
export interface FaultDraft {
  summary: string;
  causes: string[];
  checks: string[];
  needs: FaultNeed[];
  estimate: FaultEstimate | null;
  suspicious: boolean;
  /** True when the model's text was unusable and only the customer's own words are shown. */
  fallback: boolean;
}

// A rupee amount or a promise in the model's text is not allowed: the estimate comes from the catalogue.
const PRICE = /(₹|\brs\.?\s*\d|\brupees?\b|\binr\b|ரூ|\d[\d,]*\s*(?:rs|rupees|ரூபாய்))/i;
const PROMISE = /\b(free of charge|guarantee[ds]?|warranty|will be fixed|100%|no charge)\b|உத்தரவாத|இலவச/i;
export const hasPriceOrPromise = (s: string) => PRICE.test(s) || PROMISE.test(s);

/** Removes the sentences that carry a price or a promise; keeps the rest. */
export const withoutPriceSentences = (s: string) => sentences(s).filter((x) => !hasPriceOrPromise(x)).join(" ");
const tidy = (s: string, max: number) => s.replace(/\s+/g, " ").trim().slice(0, max);
const wordsOf = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 2);

/** Items whose name shares a word with the keyword, best overlap first, at most 3. */
export function rankHits(keyword: string, hits: CatalogueHit[]): CatalogueHit[] {
  const kw = wordsOf(keyword);
  if (kw.length === 0) return [];
  return hits
    .map((h) => ({ h, score: kw.filter((w) => wordsOf(h.name).some((n) => n === w || n.startsWith(w) || w.startsWith(n))).length }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.h.rate - b.h.rate)
    .slice(0, 3)
    .map((x) => x.h);
}

/** Estimate from matched items only. Null when nothing priced. Pure. */
export function estimateRange(needs: FaultNeed[]): FaultEstimate | null {
  let low = 0;
  let high = 0;
  let lowG = 0;
  let highG = 0;
  const unpriced: string[] = [];
  let priced = 0;
  for (const n of needs) {
    if (n.matches.length === 0) {
      unpriced.push(n.keyword);
      continue;
    }
    priced++;
    const sorted = [...n.matches].sort((a, b) => a.rate - b.rate);
    const lo = sorted[0]!;
    const hi = sorted[sorted.length - 1]!;
    low += lo.rate;
    high += hi.rate;
    lowG += Math.round(lo.rate * (1 + lo.gstRate / 100));
    highG += Math.round(hi.rate * (1 + hi.gstRate / 100));
  }
  return priced === 0 ? null : { low, high, lowWithGst: lowG, highWithGst: highG, unpriced };
}

export async function draftFaultNote(
  ai: AiRunner,
  ports: FaultPorts,
  req: { tenantId: string; userId?: string | null; complaint: string; brand?: string | null; model?: string | null; language: "en" | "ta" },
): Promise<{ draft: FaultDraft; runId: string; credits: number; provider: "claude" | "mock" }> {
  const n = neutralise(req.complaint);
  const device = neutralise([req.brand, req.model].filter(Boolean).join(" ")).text;
  const text = [dataBlock("customer complaint", n.text || req.complaint.slice(0, 400)), device ? dataBlock("device", device) : "", `Requested language: ${req.language}`].filter(Boolean).join("\n");
  const r = await ai.run({
    tenantId: req.tenantId,
    userId: req.userId ?? null,
    feature: FAULT_NOTE_FEATURE,
    tier: "light",
    system: FAULT_SYSTEM,
    input: { text },
    schema: FAULT_SCHEMA,
    maxTokens: 3000,
    effort: "low",
  });
  const out = r.output;
  const injected = outputLooksInjected(out, n.payloads);
  const clean = (list: string[], max: number, cap: number) => list.map((s) => tidy(s, cap)).filter((s) => s && !hasPriceOrPromise(s) && !neutralise(s).suspicious).slice(0, max);
  const summary = injected ? "" : tidy(withoutPriceSentences(out.summary), 400);
  const fallback = injected || !summary;
  const causes = injected ? [] : clean(out.causes, 3, 200);
  const checks = injected ? [] : clean(out.checks, 5, 200);

  const needs: FaultNeed[] = [];
  const seen = new Set<string>();
  for (const need of injected ? [] : out.needs) {
    const keyword = tidy(need.keyword, 40);
    const key = `${need.kind}:${keyword.toLowerCase()}`;
    if (!keyword || seen.has(key) || neutralise(keyword).suspicious || /[<>{}]/.test(keyword)) continue;
    seen.add(key);
    const found = await ports.search(`${req.brand ?? ""} ${keyword}`.trim()).catch(() => []);
    const widened = found.length ? found : await ports.search(keyword).catch(() => []);
    needs.push({ kind: need.kind, keyword, matches: rankHits(`${keyword}`, widened) });
    if (needs.length >= 5) break;
  }
  return {
    draft: { summary: summary || tidy(n.text || req.complaint, 300), causes, checks, needs, estimate: estimateRange(needs), suspicious: n.suspicious || injected, fallback },
    runId: r.runId,
    credits: r.credits,
    provider: r.provider,
  };
}
