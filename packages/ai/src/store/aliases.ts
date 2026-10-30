import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@rbms/db";
import type { AiRunner } from "../assist/hsn";
import { DATA_RULES, dataBlock, neutralise, outputLooksInjected } from "../assist/safety";
import { aiProductAliases, type AiProductAliasRow, type AliasSource } from "../schema";
import { editDistance, hasTamil, normWords } from "./common";

/**
 * Search words for products (feature `search-aliases`, light tier). Made ONCE when a product is saved (or by the bulk backfill),
 * stored in `ai_product_aliases` and read by the catalogue search with a lower weight than the real name, so a shopper's query
 * costs nothing: Tamil-script names, Tanglish spellings ("thakkali" for tomato), common synonyms and frequent misspellings.
 */
export const ALIASES_FEATURE = "search-aliases";
export const MAX_ALIASES = 30;
export const MAX_ALIAS_LEN = 40;
/** Measured on Haiku 5.5 (see docs/ai.md): about 1 credit a product. Used for the backfill estimate. */
export const ALIAS_CREDITS_ESTIMATE = 2;

export const ALIAS_SYSTEM = [
  "You build SEARCH WORDS for products in a small Indian shop's online store, so shoppers find a product however they type it: in Tamil script, in Tamil written with English letters (Tanglish), in English, or with a spelling mistake.",
  "For the product you are given, return four lists:",
  "- tamil: the product's name as a Tamil-script shopper would write it (everyday spoken names, e.g. தக்காளி for tomato; also the common Tamil name when the product is known by another name). Tamil script only.",
  '- tanglish: the same words written in English letters the way Tamil speakers type them, with the usual spelling variants (e.g. "thakkali", "takkali" for tomato; "arisi", "ari" for rice). Latin letters only.',
  '- synonyms: other English names and close equivalents shoppers search for (e.g. "kurta" for kurti is NOT a synonym unless it is the same product; "tomatoes" for tomato; "ladies finger" for okra). Latin letters only.',
  '- misspellings: frequent spelling mistakes of the product\'s own name words (e.g. "tomatto", "samsung galaxi"). Latin letters only, each close to a real name word.',
  "STRICT RULES",
  "- Every alias must mean THE SAME THING as the product. Never add a related but different product (no \"onion\" for tomato, no \"kurta\" for a saree, no brand the product does not carry). If you are unsure of a Tamil or Tanglish word, leave it out: fewer, correct words beat many.",
  "- Short: 1 to 3 words each, no sentences, no numbers unless they are part of the product name, no punctuation, no marketing words (best, cheap, offer, free, discount, sale, original, genuine).",
  "- At most 6 per list. Do not repeat the product name itself.",
  "- Keep brand names and sizes out of the lists unless the shopper would type them as part of the name.",
  DATA_RULES,
].join("\n");

const ListZ = z.array(z.string());
const OutZ = z.object({ tamil: ListZ, tanglish: ListZ, synonyms: ListZ, misspellings: ListZ });
export type AliasOutput = z.infer<typeof OutZ>;

const strArr = { type: "array", items: { type: "string" } } as const;
export const ALIAS_JSON = {
  type: "object",
  properties: { tamil: strArr, tanglish: strArr, synonyms: strArr, misspellings: strArr },
  required: ["tamil", "tanglish", "synonyms", "misspellings"],
  additionalProperties: false,
} as const;

export interface AliasProduct {
  id: string;
  name: string;
  category?: string | null;
  brand?: string | null;
  tags?: string[] | null;
  attributes?: Record<string, string> | null;
  description?: string | null;
}

/** The product facts the light tier reads: the name and a few descriptors, not the whole record. */
export function aliasFacts(p: AliasProduct): { text: string; payloads: string[] } {
  const name = neutralise(p.name);
  const desc = p.description ? neutralise(p.description.replace(/\s+/g, " ").slice(0, 240)) : null;
  const lines = [
    `Name: ${name.text}`,
    p.category ? `Category: ${neutralise(p.category).text}` : "",
    p.brand ? `Brand: ${neutralise(p.brand).text}` : "",
    p.tags?.length ? `Tags: ${p.tags.slice(0, 8).map((t) => neutralise(t).text).join(", ")}` : "",
    desc?.text ? `Description (first words): ${desc.text}` : "",
  ].filter(Boolean);
  return { text: lines.join("\n"), payloads: [...name.payloads, ...(desc?.payloads ?? [])] };
}

const MARKETING = /\b(best|cheap|cheapest|offer|offers|free|discount|sale|original|genuine|guarantee|warranty|buy|order|price|rs|inr)\b/i;
const CONTACT = /@|https?:|www\.|\.com|\d{6,}/i;
const LATIN = /^[a-z0-9' -]+$/;

/** A single alias cleaned for storage and matching: lowercase NFC, single spaces, no punctuation, 2 to 40 characters, at most 3 words. */
export function cleanAlias(raw: string): string {
  const t = raw
    .normalize("NFC")
    .toLowerCase()
    .replace(/[​-‍﻿]/g, "")
    .replace(/[^\p{L}\p{M}\p{N}' -]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t;
}

export interface CleanedAliases {
  aliases: string[];
  /** What was dropped and why (for the tests and the review screen). */
  dropped: { alias: string; reason: string }[];
}

/**
 * Checks the model's lists in code. Tamil items must be Tamil script, the others Latin; a misspelling must be close to a word of
 * the product's name (edit distance), so a different product cannot slip in as a "misspelling"; instruction-like, promotional or
 * contact-like text, the product's own name and duplicates are dropped. Pure.
 */
export function cleanAliases(out: AliasOutput, productName: string): CleanedAliases {
  const dropped: CleanedAliases["dropped"] = [];
  const keep: string[] = [];
  const own = normWords(productName);
  const ownText = own.join(" ");
  const take = (list: string[], kind: keyof AliasOutput) => {
    for (const raw of list.slice(0, 12)) {
      const a = cleanAlias(String(raw ?? ""));
      const no = (reason: string) => void dropped.push({ alias: a || String(raw ?? "").slice(0, 40), reason });
      if (a.length < 2 || a.length > MAX_ALIAS_LEN) no("length");
      else if (a.split(" ").length > 3) no("too_many_words");
      else if (neutralise(a).suspicious || CONTACT.test(a) || MARKETING.test(a)) no("not_a_search_word");
      else if (kind === "tamil" && !hasTamil(a)) no("not_tamil");
      else if (kind !== "tamil" && hasTamil(a)) no("not_latin");
      else if (kind !== "tamil" && !LATIN.test(a)) no("not_latin");
      else if (a === ownText || own.includes(a)) no("same_as_name");
      else if (kind === "misspellings" && !closeToName(a, own)) no("not_close_to_name");
      else if (keep.includes(a)) no("duplicate");
      else keep.push(a);
    }
  };
  take(out.tamil, "tamil");
  take(out.tanglish, "tanglish");
  take(out.synonyms, "synonyms");
  take(out.misspellings, "misspellings");
  return { aliases: keep.slice(0, MAX_ALIASES), dropped };
}

/** True when every word of the alias is within a couple of edits of some word of the name (or the name has Tamil only). */
function closeToName(alias: string, nameWords: string[]): boolean {
  const words = alias.split(" ");
  const pool = nameWords.filter((w) => !hasTamil(w));
  if (!pool.length) return false;
  return words.every((w) => w.length >= 3 && pool.some((n) => editDistance(w, n) <= Math.max(1, Math.min(3, Math.floor(n.length / 3))) || n.startsWith(w) || w.startsWith(n)));
}

export interface AliasResult {
  aliases: string[];
  dropped: CleanedAliases["dropped"];
  runId: string;
  credits: number;
}

/** One light-tier call: aliases for one product, checked in code. Throws the usual `ai_*` AppErrors (switch off, no credits...). */
export async function generateAliases(ai: AiRunner, p: { tenantId: string; userId?: string | null; product: AliasProduct }): Promise<AliasResult> {
  const f = aliasFacts(p.product);
  const r = await ai.run<AliasOutput>({
    tenantId: p.tenantId,
    userId: p.userId ?? null,
    feature: ALIASES_FEATURE,
    tier: "light",
    effort: "low",
    system: ALIAS_SYSTEM,
    input: { text: dataBlock("product", f.text) },
    schema: { name: "product_search_words", jsonSchema: ALIAS_JSON as unknown as Record<string, unknown>, zod: OutZ },
    maxTokens: 2500,
  });
  if (outputLooksInjected(r.output, f.payloads)) return { aliases: [], dropped: [{ alias: "", reason: "injected" }], runId: r.runId, credits: r.credits };
  const c = cleanAliases(r.output, p.product.name);
  return { aliases: c.aliases, dropped: c.dropped, runId: r.runId, credits: r.credits };
}

// ------------------------------------------------------------------ storage

export interface AliasPorts {
  /** Facts for these products of this shop (ids of other shops are silently skipped). */
  products(tenantId: string, ids: string[]): Promise<AliasProduct[]>;
  /** Active store products without a row in `ai_product_aliases` yet, newest first. */
  withoutAliases(tenantId: string, limit: number): Promise<string[]>;
}

export interface AliasDto {
  productId: string;
  aliases: string[];
  source: AliasSource;
  stale: boolean;
  updatedAt: string;
}

const norm = (s: string) => s.normalize("NFC").trim().toLowerCase();

export interface AliasDeps {
  db: Db;
  ai: AiRunner;
  ports: AliasPorts;
  log?: { warn(o: object, m?: string): void };
}

export const ALIAS_BACKFILL_JOB = "ai.alias-backfill";
export const ALIAS_ONE_JOB = "ai.alias-one";
export interface AliasJobPayload {
  tenantId: string;
  userId?: string | null;
  productIds: string[];
}

export class AliasService {
  constructor(private readonly d: AliasDeps) {}

  private view(r: AiProductAliasRow, currentName?: string): AliasDto {
    return { productId: r.productId, aliases: r.aliases, source: r.source, stale: currentName !== undefined && norm(currentName) !== norm(r.sourceName), updatedAt: r.updatedAt.toISOString() };
  }

  async get(tenantId: string, productId: string): Promise<AliasDto | null> {
    const [r] = await this.d.db.select().from(aiProductAliases).where(and(eq(aiProductAliases.tenantId, tenantId), eq(aiProductAliases.productId, productId))).limit(1);
    if (!r) return null;
    const [p] = await this.d.ports.products(tenantId, [productId]);
    return this.view(r, p?.name);
  }

  /** The owner's own list (typed or edited). Cleaned like the AI's, kept as `owner` so a re-run never overwrites it. */
  async setByOwner(tenantId: string, productId: string, list: string[]): Promise<AliasDto> {
    const [p] = await this.d.ports.products(tenantId, [productId]);
    if (!p) throw Object.assign(new Error("Product not found"), { status: 404 });
    const kept: string[] = [];
    for (const raw of list.slice(0, 60)) {
      const a = cleanAlias(String(raw));
      if (a.length >= 2 && a.length <= MAX_ALIAS_LEN && a.split(" ").length <= 4 && !CONTACT.test(a) && !neutralise(a).suspicious && !kept.includes(a)) kept.push(a);
    }
    const aliases = kept.slice(0, MAX_ALIASES);
    const row = await this.upsert(tenantId, productId, { aliases, source: "owner", sourceName: p.name, runId: null, credits: 0 });
    return this.view(row, p.name);
  }

  private async upsert(tenantId: string, productId: string, v: { aliases: string[]; source: AliasSource; sourceName: string; runId: string | null; credits: number }): Promise<AiProductAliasRow> {
    const aliasText = v.aliases.join(" ");
    const [row] = await this.d.db
      .insert(aiProductAliases)
      .values({ tenantId, productId, aliases: v.aliases, aliasText, source: v.source, sourceName: v.sourceName, runId: v.runId, credits: v.credits, error: null })
      .onConflictDoUpdate({
        target: [aiProductAliases.tenantId, aiProductAliases.productId],
        set: { aliases: v.aliases, aliasText, source: v.source, sourceName: v.sourceName, runId: v.runId, credits: sql`${aiProductAliases.credits} + ${v.credits}`, error: null, updatedAt: sql`now()` },
      })
      .returning();
    return row!;
  }

  /**
   * Generates and stores the aliases of one product. An owner-edited row is left alone unless `force`. Returns null when skipped
   * (not this shop's product, owner-edited, fresh already). AI errors (`ai_off`, `ai_credits_exhausted`...) are thrown.
   */
  async generate(tenantId: string, productId: string, o: { userId?: string | null; force?: boolean } = {}): Promise<(AliasDto & { credits: number; dropped: number }) | null> {
    const [p] = await this.d.ports.products(tenantId, [productId]);
    if (!p) return null;
    const [existing] = await this.d.db.select().from(aiProductAliases).where(and(eq(aiProductAliases.tenantId, tenantId), eq(aiProductAliases.productId, productId))).limit(1);
    if (existing && !o.force && (existing.source === "owner" || (norm(existing.sourceName) === norm(p.name) && existing.aliases.length > 0))) return null;
    const r = await generateAliases(this.d.ai, { tenantId, userId: o.userId, product: p });
    const row = await this.upsert(tenantId, productId, { aliases: r.aliases, source: "ai", sourceName: p.name, runId: r.runId, credits: r.credits });
    return { ...this.view(row, p.name), credits: r.credits, dropped: r.dropped.length };
  }

  /** The next batch for the backfill and the credits it needs. */
  async estimate(tenantId: string, limit: number): Promise<{ count: number; credits: number; productIds: string[] }> {
    const productIds = await this.d.ports.withoutAliases(tenantId, Math.min(Math.max(limit, 1), 500));
    return { count: productIds.length, credits: productIds.length * ALIAS_CREDITS_ESTIMATE, productIds };
  }

  /** The body of the backfill job: one product at a time, stops on a switched-off helper or empty credits. */
  async process(job: AliasJobPayload): Promise<{ done: number; skipped: number; failed: number; credits: number; stopped: string | null }> {
    let done = 0;
    let skipped = 0;
    let failed = 0;
    let credits = 0;
    let stopped: string | null = null;
    for (const id of job.productIds) {
      try {
        const r = await this.generate(job.tenantId, id, { userId: job.userId });
        if (r) {
          done++;
          credits += r.credits;
        } else skipped++;
      } catch (e) {
        const code = (e as { code?: string }).code ?? "";
        if (["ai_off", "ai_feature_off", "ai_credits_exhausted", "ai_not_available", "ai_disabled", "ai_unavailable"].includes(code)) {
          stopped = code;
          break;
        }
        failed++;
        this.d.log?.warn({ err: e instanceof Error ? e.message : String(e), tenantId: job.tenantId, productId: id }, "ai: aliases failed");
      }
    }
    return { done, skipped, failed, credits, stopped };
  }

  /** Products and how many search words each has (the owner's overview). */
  async counts(tenantId: string, ids: string[]): Promise<Record<string, number>> {
    if (!ids.length) return {};
    const rows = await this.d.db
      .select({ productId: aiProductAliases.productId, aliases: aiProductAliases.aliases })
      .from(aiProductAliases)
      .where(and(eq(aiProductAliases.tenantId, tenantId), inArray(aiProductAliases.productId, ids)));
    return Object.fromEntries(rows.map((r) => [r.productId, r.aliases.length]));
  }
}
