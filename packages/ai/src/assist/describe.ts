import { AppError, badRequest } from "@rbms/core";
import { z } from "zod";
import type { AiRunner } from "./hsn";
import { DATA_RULES, dataBlock, filterClaims, neutralise, outputLooksInjected, sentences, type ClaimsResult } from "./safety";

export const DESCRIBE_FEATURE = "product-description";

export const DESCRIBE_SYSTEM = [
  "You write short product listings for a small Indian shop's online store, in English and in natural Tamil (Tamil script, the way a shopkeeper would say it, not a word-for-word translation). Keep brand names, sizes and units as given.",
  "Use ONLY the facts you are given (name, category, brand, attributes, options, price, notes, shop policies). Do not invent features, materials, sizes, colours, origin, certifications, health or medical benefits, warranty, delivery, returns, refunds, guarantees or discounts. A promise may be written only if the same fact is in the data (for example a warranty period or a delivery policy the shop stated); then copy its numbers exactly.",
  "Never put phone numbers, e-mail addresses or web links in the text.",
  "description_en and description_ta: 2 to 4 short sentences each, plain text. bullets: 3 to 5 short points taken from the facts. seo_title: at most 60 characters. seo_description: at most 155 characters. title: a clean product title (the name, tidied), no promotional words.",
  "If the facts are thin, write less rather than guess.",
  DATA_RULES,
].join("\n");

const Out = z.object({
  title: z.string(),
  description_en: z.string(),
  description_ta: z.string(),
  seo_title: z.string(),
  seo_description: z.string(),
  bullets_en: z.array(z.string()).max(8),
  bullets_ta: z.array(z.string()).max(8),
});
export type DescribeOutput = z.infer<typeof Out>;

const str = { type: "string" } as const;
const OUT_JSON = {
  type: "object",
  properties: {
    title: str,
    description_en: str,
    description_ta: str,
    seo_title: str,
    seo_description: str,
    bullets_en: { type: "array", items: str },
    bullets_ta: { type: "array", items: str },
  },
  required: ["title", "description_en", "description_ta", "seo_title", "seo_description", "bullets_en", "bullets_ta"],
  additionalProperties: false,
} as const;

export interface ProductFacts {
  name: string;
  category?: string | null;
  brand?: string | null;
  attributes?: Record<string, string> | null;
  options?: { name: string; values: string[] }[] | null;
  /** Paise. */
  price?: number | null;
  unit?: string | null;
  tags?: string[] | null;
  /** What the owner already wrote (it counts as the owner's facts). */
  existingDescription?: string | null;
}

export interface DescribeInput {
  tenantId: string;
  userId?: string | null;
  product: ProductFacts;
  /** The shop's trade, e.g. "Textiles & garments". */
  trade?: string | null;
  /** Free notes from the owner (data, not instructions). */
  notes?: string | null;
  /** The shop's real policies from its storefront settings, e.g. "Delivery: free above Rs 500". Only these may be promised. */
  policies?: string[];
}

export interface DescribeResult {
  draft: DescribeOutput;
  /** Sentences the claims filter removed (shown to the owner). */
  removed: ClaimsResult["removed"];
  runId: string;
  credits: number;
}

const rupees = (paise: number) => `Rs ${(paise / 100).toFixed(paise % 100 ? 2 : 0)}`;

/** The facts as text, one per line: also what the claims filter treats as "stated by the shop". */
export function factsText(i: DescribeInput): string {
  const p = i.product;
  const lines = [`Name: ${neutralise(p.name).text}`];
  if (p.category) lines.push(`Category: ${p.category}`);
  if (p.brand) lines.push(`Brand: ${p.brand}`);
  if (i.trade) lines.push(`Shop trade: ${i.trade}`);
  for (const [k, v] of Object.entries(p.attributes ?? {})) lines.push(`${k}: ${v}`);
  for (const o of p.options ?? []) lines.push(`Options - ${o.name}: ${o.values.join(", ")}`);
  if (typeof p.price === "number" && p.price > 0) lines.push(`Price: ${rupees(p.price)}${p.unit ? ` per ${p.unit}` : ""}`);
  if (p.tags?.length) lines.push(`Tags: ${p.tags.join(", ")}`);
  if (p.existingDescription) lines.push(`Owner's current description: ${neutralise(p.existingDescription).text}`);
  if (i.notes) lines.push(`Owner's notes: ${neutralise(i.notes).text}`);
  return lines.join("\n");
}

const policiesText = (i: DescribeInput) => (i.policies ?? []).map((x) => `Shop policy: ${x}`).join("\n");

const CONTACT = /[\w.+-]+@[\w-]+\.[\w.-]+|https?:\/\/\S+|www\.\S+|(?:\+?\d[\d\s-]{7,}\d)|X{3,}\d{2,}|\w\*{3}@/;
const cut = (s: string, n: number) => (s.length <= n ? s : s.slice(0, n - 1).trimEnd() + "…");
/** Drops any sentence that carries a phone number, e-mail address or web link. */
const scrub = (s: string) => sentences(s).filter((x) => !CONTACT.test(x)).join(" ").replace(/\s{2,}/g, " ").trim();

/** Strips unsupported promises and contact details from a draft. Pure; exported for tests. */
export function cleanDraft(d: DescribeOutput, facts: string): { draft: DescribeOutput; removed: ClaimsResult["removed"] } {
  const removed: ClaimsResult["removed"] = [];
  const f = (s: string) => {
    const r = filterClaims(scrub(s), facts);
    removed.push(...r.removed);
    return r.text;
  };
  const list = (xs: string[]) => xs.map(f).filter(Boolean);
  const draft: DescribeOutput = {
    title: cut(scrub(d.title), 120),
    description_en: f(d.description_en),
    description_ta: f(d.description_ta),
    seo_title: cut(f(d.seo_title), 60),
    seo_description: cut(f(d.seo_description), 155),
    bullets_en: list(d.bullets_en).slice(0, 6),
    bullets_ta: list(d.bullets_ta).slice(0, 6),
  };
  return { draft, removed };
}

/** Writes an English + Tamil listing from the product's facts only (feature `product-description`, standard tier). */
export async function describeProduct(ai: AiRunner, req: DescribeInput): Promise<DescribeResult> {
  if (!req.product.name.trim()) throw badRequest("The product needs a name first");
  const nb = req.notes ? neutralise(req.notes) : null;
  const nameN = neutralise(req.product.name);
  const payloads = [...nameN.payloads, ...(nb?.payloads ?? [])];
  const facts = factsText(req);
  const text = [dataBlock("product facts", facts), policiesText(req) ? dataBlock("shop policies", policiesText(req)) : ""].filter(Boolean).join("\n");
  const r = await ai.run<DescribeOutput>({
    tenantId: req.tenantId,
    userId: req.userId ?? null,
    feature: DESCRIBE_FEATURE,
    tier: "standard",
    effort: "low",
    system: DESCRIBE_SYSTEM,
    input: { text },
    schema: { name: "product_listing", jsonSchema: OUT_JSON as unknown as Record<string, unknown>, zod: Out },
    maxTokens: 3500,
  });
  if (outputLooksInjected(r.output, payloads)) throw new AppError(502, "ai_invalid_output", "The AI gave an answer we could not use. Please try again.", { runId: r.runId });
  const { draft, removed } = cleanDraft(r.output, `${facts}\n${policiesText(req)}`);
  return { draft, removed, runId: r.runId, credits: r.credits };
}

// ------------------------------------------------------------------ Tamil translation of name + description

export const TRANSLATE_SYSTEM = [
  "You translate a product's name and description from English into natural Tamil (Tamil script) for a small Indian shop's online store. Keep brand names, model numbers, sizes and units as they are; translate nothing that is already Tamil.",
  "Translate only what is given. Do not add, remove or improve any claims, promises, numbers or features. If the description is empty, return an empty description.",
  DATA_RULES,
].join("\n");

const TOut = z.object({ name_ta: z.string(), description_ta: z.string() });
export type TranslateOutput = z.infer<typeof TOut>;

export async function translateProduct(
  ai: AiRunner,
  req: { tenantId: string; userId?: string | null; name: string; description?: string | null },
): Promise<{ draft: TranslateOutput; removed: ClaimsResult["removed"]; runId: string; credits: number }> {
  const payloads = [...neutralise(req.name).payloads, ...neutralise(req.description ?? "").payloads];
  const r = await ai.run<TranslateOutput>({
    tenantId: req.tenantId,
    userId: req.userId ?? null,
    feature: DESCRIBE_FEATURE,
    tier: "standard",
    effort: "low",
    system: TRANSLATE_SYSTEM,
    input: { text: [dataBlock("product name", req.name), dataBlock("product description", (req.description ?? "").slice(0, 3000))].join("\n") },
    schema: {
      name: "product_translation",
      jsonSchema: { type: "object", properties: { name_ta: str, description_ta: str }, required: ["name_ta", "description_ta"], additionalProperties: false },
      zod: TOut,
    },
    maxTokens: 3000,
  });
  if (outputLooksInjected(r.output, payloads)) throw new AppError(502, "ai_invalid_output", "The AI gave an answer we could not use. Please try again.", { runId: r.runId });
  // A translation may only carry what the source already said: the source text is the "facts".
  const facts = `${req.name}\n${req.description ?? ""}`;
  const removed: ClaimsResult["removed"] = [];
  const f = (s: string) => {
    const c = filterClaims(scrub(s), facts);
    removed.push(...c.removed);
    return c.text;
  };
  return { draft: { name_ta: f(r.output.name_ta) || r.output.name_ta.trim(), description_ta: f(r.output.description_ta) }, removed, runId: r.runId, credits: r.credits };
}
