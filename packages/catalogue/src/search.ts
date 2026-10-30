import { sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { catalogProducts, catalogVariants } from "./schema";

/**
 * Product search (docs/commerce-batch2.md §3): query parsing, the `search_text` document, SQL for matching and
 * ranking, and the pure parts of facets and rating sort. Everything here is side-effect free; the service runs it.
 */

// ------------------------------------------------------------------ text normalisation

const ZERO_WIDTH_SPACE = /[​﻿]/g;
const CONTROL = /[\u0000-\u001F\u007F]/g;

/**
 * Lowercase (Latin), NFC, zero-width spaces and control characters removed, whitespace collapsed, trimmed. Tamil (and
 * other scripts without case) is kept as typed — "Kanchipuram பட்டு Saree" → "kanchipuram பட்டு saree".
 */
export function normalizeText(s: string | null | undefined): string {
  if (!s) return "";
  return s.normalize("NFC").replace(ZERO_WIDTH_SPACE, "").replace(CONTROL, " ").toLowerCase().replace(/\s+/g, " ").trim();
}

export const MAX_QUERY_LENGTH = 100;
export const MAX_QUERY_WORDS = 8;
/** Characters that only separate words in a query. */
const WORD_SEPARATORS = /[\s,;/|+]+/;
/** Punctuation trimmed from either end of a word ("saree," → "saree"; "men's" stays). */
const EDGE_PUNCTUATION = /^[\p{P}\p{S}]+|[\p{P}\p{S}]+$/gu;

export interface ParsedQuery {
  /** The normalised query ("kanchipuram பட்டு saree"); "" when nothing searchable is left. */
  text: string;
  /** Distinct words, in order (at most 8). */
  words: string[];
  /** A `to_tsquery('simple', …)` prefix query (`'a':* & 'b':*`), null without words. */
  tsquery: string | null;
}

/** Quotes one lexeme for to_tsquery so no input can be read as an operator. */
const tsLexeme = (w: string) => `'${w.replace(/\\/g, "\\\\").replace(/'/g, "''")}':*`;

/**
 * Joining words a shopper types in a sentence ("red silk saree for wedding"). Dropped from a multi-word query so they do not
 * have to appear in the product; a query made only of them is kept as typed.
 */
const QUERY_FILLER = new Set(["for", "and", "with", "in", "the", "of", "to", "from"]);
export function parseQuery(raw: string | null | undefined): ParsedQuery {
  const text = normalizeText(raw).slice(0, MAX_QUERY_LENGTH).trim();
  const words: string[] = [];
  for (const part of text.split(WORD_SEPARATORS)) {
    const w = part.replace(EDGE_PUNCTUATION, "");
    if (w && !words.includes(w)) words.push(w);
    if (words.length >= MAX_QUERY_WORDS) break;
  }
  // "pink silk saree for wedding": the joining word is not a product word.
  if (words.length > 1) {
    const kept = words.filter((w) => !QUERY_FILLER.has(w));
    if (kept.length > 0) words.splice(0, words.length, ...kept);
  }
  if (words.length === 0) return { text: "", words: [], tsquery: null };
  return { text, words, tsquery: words.map(tsLexeme).join(" & ") };
}

export const MAX_SEARCH_TEXT = 4000;

export interface SearchDocumentInput {
  name: string;
  brand?: string | null;
  tags?: readonly string[] | null;
  attributes?: Record<string, string> | null;
  /** The product's category first, then its ancestors. */
  categoryNames?: readonly string[];
  /** Option values used by the product's live variants ("M", "Red"). */
  optionValues?: readonly string[];
}

/** `catalog_products.search_text`: normalised pieces, duplicates dropped, name first, capped at 4000 characters. */
export function buildSearchText(p: SearchDocumentInput): string {
  const pieces = [
    p.name,
    p.brand,
    ...(p.tags ?? []),
    ...Object.values(p.attributes ?? {}),
    ...(p.categoryNames ?? []),
    ...(p.optionValues ?? []),
  ];
  const out: string[] = [];
  for (const piece of pieces) {
    const n = normalizeText(piece);
    if (n && !out.includes(n)) out.push(n);
  }
  return out.join(" ").slice(0, MAX_SEARCH_TEXT).trim();
}

/** The category and its ancestors' names (nearest first); stops on cycles or missing parents. */
export function categoryPath(categories: readonly { id: string; parentId: string | null; name: string }[], id: string | null): string[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const out: string[] = [];
  const seen = new Set<string>();
  for (let cur = id ? byId.get(id) : undefined; cur && !seen.has(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
    seen.add(cur.id);
    out.push(cur.name);
  }
  return out;
}

// ------------------------------------------------------------------ SQL: matching and ranking

const likeEscape = (s: string) => s.replace(/[\\%_]/g, "\\$&");

/**
 * Rows matching a parsed query: every word is a substring of `search_text` (works for any script; GIN trigram index),
 * or the whole query is trigram-similar to some part of it (`<%`, typo tolerant), or the `simple` tsvector matches all
 * words as prefixes. Null for an empty query (no condition).
 */
export function searchMatchSql(q: ParsedQuery): SQL | null {
  if (!q.text) return null;
  const st = catalogProducts.searchText;
  const allWords = sql.join(
    q.words.map((w) => sql`${st} like ${`%${likeEscape(w)}%`}`),
    sql` and `,
  );
  const parts: SQL[] = [sql`(${allWords})`, sql`${q.text} <% ${st}`];
  if (q.tsquery) parts.push(sql`${catalogProducts.searchVector} @@ to_tsquery('simple', ${q.tsquery})`);
  const translated = translatedTextMatchSql(q);
  if (translated) parts.push(translated);
  const alias = aliasMatchSql(q);
  if (alias) parts.push(alias);
  return sql`(${sql.join(parts, sql` or `)})`;
}

/**
 * The shop's AI-made search words for a product (`ai_product_aliases`: Tamil-script names, Tanglish spellings, synonyms,
 * common misspellings; docs/ai.md "Phase 4 part B"). Every word of the query is inside the alias text, or the whole query is
 * trigram-similar to it (typos). Matching here only widens what is found; ranking keeps real-name matches first
 * (`aliasOnlySql`). Null for an empty query.
 */
export function aliasMatchSql(q: ParsedQuery): SQL | null {
  if (!q.text) return null;
  const words = sql.join(
    q.words.map((w) => sql`al.alias_text like ${`%${likeEscape(w)}%`}`),
    sql` and `,
  );
  return sql`exists (select 1 from ai_product_aliases al where al.product_id = ${catalogProducts.id} and al.alias_text <> '' and ((${words}) or ${q.text} <% al.alias_text))`;
}

/** 1 when the product matched only through its search words (not its name, tags, brand...), 0 otherwise: sorts alias-only hits after real matches. */
export function aliasOnlySql(q: ParsedQuery): SQL {
  const st = catalogProducts.searchText;
  const direct = sql.join(
    q.words.map((w) => sql`${st} like ${`%${likeEscape(w)}%`}`),
    sql` and `,
  );
  const alias = aliasMatchSql(q);
  if (!alias) return sql`0`;
  return sql`(case when (${direct}) or ${q.text} <% ${st} then 0 when ${alias} then 1 else 0 end)`;
}

/**
 * Non-English queries also match the shop's approved translations of a product (`ai_product_translations`, e.g. Tamil
 * names): every word is a substring of the translated name / description. Null for an English-only query, which keeps
 * the common search path free of the extra lookup.
 */
export function translatedTextMatchSql(q: ParsedQuery): SQL | null {
  if (!q.text || !/[\u0080-\uffff]/.test(q.text)) return null;
  const words = sql.join(
    q.words.map((w) => sql`lower(coalesce(tr.name, '') || ' ' || coalesce(tr.description, '')) like ${`%${likeEscape(w)}%`}`),
    sql` and `,
  );
  return sql`exists (select 1 from ai_product_translations tr where tr.product_id = ${catalogProducts.id} and tr.status = 'approved' and ${words})`;
}

/**
 * Ranking tier from the product name: 3 = exact name, 2 = name starts with the query, 1 = a word of the name starts with
 * it, 0 = matched elsewhere (brand, tags, attributes, category, typo).
 */
export function nameTierSql(q: ParsedQuery): SQL {
  const name = sql`lower(${catalogProducts.name})`;
  const prefix = `${likeEscape(q.text)}%`;
  return sql`(case when ${name} = ${q.text} then 3 when ${name} like ${prefix} then 2 when ${name} like ${`% ${prefix}`} then 1 else 0 end)`;
}

/** Relevance order: exact name > name prefix > real matches before search-word-only matches > trigram word similarity > tsvector rank, then newest. */
export function relevanceOrderSql(q: ParsedQuery): SQL[] {
  const order: SQL[] = [sql`${nameTierSql(q)} desc`, sql`${aliasOnlySql(q)} asc`, sql`word_similarity(${q.text}, ${catalogProducts.searchText}) desc`];
  if (q.tsquery) order.push(sql`ts_rank(${catalogProducts.searchVector}, to_tsquery('simple', ${q.tsquery})) desc`);
  order.push(sql`${catalogProducts.createdAt} desc`, sql`${catalogProducts.id} asc`);
  return order;
}

/** Cheapest live variant price of the current product row (ORDER BY / WHERE only: drizzle unqualifies columns in single-table select lists). */
export const minPriceSql = sql`(select min(cv.price) from ${catalogVariants} cv where cv.product_id = ${catalogProducts.id} and cv.deleted_at is null)`;

export const SEARCH_SORTS = ["relevance", "new", "price-asc", "price-desc", "rating", "name"] as const;
export type SearchSort = (typeof SEARCH_SORTS)[number];

/** ORDER BY for a non-rating sort (`relevance` without a query falls back to `new`). */
export function sortOrderSql(sort: SearchSort, q: ParsedQuery): SQL[] {
  const tie = sql`${catalogProducts.id} asc`;
  switch (sort) {
    case "price-asc":
      return [sql`${minPriceSql} asc nulls last`, tie];
    case "price-desc":
      return [sql`${minPriceSql} desc nulls last`, tie];
    case "name":
      return [sql`${catalogProducts.name} asc`, tie];
    case "new":
      return [sql`${catalogProducts.createdAt} desc`, tie];
    default:
      return q.text ? relevanceOrderSql(q) : [sql`${catalogProducts.createdAt} desc`, tie];
  }
}

export interface VariantConditions {
  priceMin?: number;
  priceMax?: number;
  /** Option name → accepted values (any of). */
  options?: Record<string, string[]>;
  /** Only these variant ids (in stock). */
  variantIds?: string[] | null;
  /**
   * An option filter also matches a product attribute of the same name (the storefront shows an option and an
   * attribute both called "Cut" as one filter, so `opt.Cut=Whole` finds either).
   */
  optionsMatchAttributes?: boolean;
}

/**
 * `exists` a live variant of the current product satisfying every condition at once (so "Size M under ₹500" needs one
 * variant that is both). Null when there is no condition.
 */
export function variantExistsSql(c: VariantConditions): SQL | null {
  const conds: SQL[] = [];
  if (c.priceMin !== undefined) conds.push(sql`cv.price >= ${c.priceMin}`);
  if (c.priceMax !== undefined) conds.push(sql`cv.price <= ${c.priceMax}`);
  for (const [name, values] of Object.entries(c.options ?? {})) {
    if (values.length === 0) continue;
    const list = sql.join(values.map((v) => sql`${v}`), sql`, `);
    conds.push(
      c.optionsMatchAttributes
        ? sql`((cv.option_values ->> ${name}::text) in (${list}) or (${catalogProducts.attributes} ->> ${name}::text) in (${list}))`
        : sql`(cv.option_values ->> ${name}::text) in (${list})`,
    );
  }
  if (c.variantIds) {
    conds.push(
      c.variantIds.length === 0 ? sql`false` : sql`cv.id in (${sql.join(c.variantIds.map((id) => sql`${id}::uuid`), sql`, `)})`,
    );
  }
  if (conds.length === 0) return null;
  return sql`exists (select 1 from ${catalogVariants} cv where cv.product_id = ${catalogProducts.id} and cv.deleted_at is null and ${sql.join(conds, sql` and `)})`;
}

/** `attributes ->> name` is one of the values, for each attribute filter. */
export function attributeSql(attrs: Record<string, string[]>): SQL[] {
  return Object.entries(attrs)
    .filter(([, values]) => values.length > 0)
    .map(([name, values]) => sql`(${catalogProducts.attributes} ->> ${name}::text) in (${sql.join(values.map((v) => sql`${v}`), sql`, `)})`);
}

// ------------------------------------------------------------------ query string

const MAX_FILTER_KEYS = 10;
const MAX_TAGS = 5;
const MAX_FILTER_VALUES = 20;
const paise = z.coerce.number().int().min(0).max(2_000_000_000);
const bool = z
  .union([z.boolean(), z.string()])
  .transform((v) => v === true || v === "1" || v === "true" || v === "yes")
  .optional();

const baseSearchSchema = z.object({
  q: z.string().max(200).optional(),
  categoryId: z.string().uuid().optional(),
  /**
   * Product tags ("class-1-5", "acne"), all of which a product must have (AND): `tag=a`, repeated `tag=a&tag=b` or
   * `tag=a,b`. The home finder sends one per answered question; tag links send one.
   */
  tag: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .transform((v) => [...new Set((Array.isArray(v) ? v : v === undefined ? [] : [v]).flatMap((x) => x.split(",")).map((x) => x.trim().toLowerCase()).filter(Boolean))])
    .pipe(z.array(z.string().max(40)).max(MAX_TAGS)),
  priceMin: paise.optional(),
  priceMax: paise.optional(),
  inStock: bool,
  sort: z.enum(SEARCH_SORTS).default("relevance"),
  limit: z.coerce.number().int().min(1).max(100).default(24),
  offset: z.coerce.number().int().min(0).max(10_000).default(0),
});

export interface SearchQuery extends Omit<z.output<typeof baseSearchSchema>, "tag"> {
  /** Every tag the product must have (AND); empty = no tag filter. */
  tags: string[];
  /** The first of `tags` (older callers). */
  tag?: string;
  parsed: ParsedQuery;
  /** `attr.<Name>=<value>` (repeat the parameter for several values; any of them matches). */
  attributes: Record<string, string[]>;
  /** `opt.<Name>=<value>` on variant option values. */
  options: Record<string, string[]>;
}

/** Raw query string (`attr.Fabric=Cotton&opt.Size=M&opt.Size=L`) as Fastify parses it. */
export type RawSearchQuery = Record<string, unknown>;

function prefixed(raw: RawSearchQuery, prefix: string): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [key, value] of Object.entries(raw)) {
    if (!key.startsWith(prefix)) continue;
    const name = key.slice(prefix.length).trim();
    if (!name || name.length > 60) continue;
    const values = (Array.isArray(value) ? value : [value])
      .filter((v): v is string => typeof v === "string")
      .map((v) => v.trim())
      .filter((v) => v.length > 0 && v.length <= 200);
    if (values.length === 0) continue;
    if (Object.keys(out).length >= MAX_FILTER_KEYS && !out[name]) continue;
    out[name] = [...new Set([...(out[name] ?? []), ...values])].slice(0, MAX_FILTER_VALUES);
  }
  return out;
}

/** Validates `GET /public/search`; a price range given the wrong way round is swapped. */
export function parseSearchQuery(raw: RawSearchQuery = {}): SearchQuery {
  const { tag: tags, ...b } = baseSearchSchema.parse(raw);
  if (b.priceMin !== undefined && b.priceMax !== undefined && b.priceMin > b.priceMax) [b.priceMin, b.priceMax] = [b.priceMax, b.priceMin];
  return { ...b, tags, tag: tags[0], parsed: parseQuery(b.q), attributes: prefixed(raw, "attr."), options: prefixed(raw, "opt.") };
}

// ------------------------------------------------------------------ facets (pure parts)

export interface FacetValue {
  value: string;
  count: number;
}

export interface SearchFacets {
  categories: { id: string; name: string; count: number }[];
  price: { min: number; max: number };
  attributes: Record<string, FacetValue[]>;
  options: Record<string, FacetValue[]>;
}

/** Filter dimensions a facet ignores. Categories drill down (the category filter is ignored); the price range ignores the price filter. */
export type FacetDimension = "category" | "price";
export const FACET_SCOPE: Record<keyof SearchFacets, FacetDimension[]> = {
  categories: ["category"],
  price: ["price"],
  attributes: [],
  options: [],
};

export const MAX_FACET_VALUES = 30;
export const MAX_FACET_KEYS = 20;

/**
 * Rows `{ key, value, count, rank? }` → `{ [key]: [{ value, count }] }`; empty values dropped. Values with a `rank`
 * (option facets: the value's position in the products' own option lists, so sizes read S, M, L, XL and not
 * alphabetically) come in rank order; otherwise by count desc then value.
 */
export function groupFacetRows(rows: readonly { key: string; value: string; count: number | string; rank?: number | string | null }[]): Record<string, FacetValue[]> {
  const byKey = new Map<string, (FacetValue & { rank?: number })[]>();
  for (const r of rows) {
    const value = (r.value ?? "").trim();
    const count = Number(r.count);
    if (!value || !(count > 0)) continue;
    const rank = r.rank === null || r.rank === undefined || r.rank === "" || !Number.isFinite(Number(r.rank)) ? undefined : Number(r.rank);
    const list = byKey.get(r.key) ?? [];
    const existing = list.find((x) => x.value === value);
    if (existing) {
      existing.count += count;
      if (rank !== undefined) existing.rank = existing.rank === undefined ? rank : Math.min(existing.rank, rank);
    } else list.push(rank === undefined ? { value, count } : { value, count, rank });
    byKey.set(r.key, list);
  }
  const keys = [...byKey.entries()]
    .map(([key, values]) => ({ key, values, total: values.reduce((s, v) => s + v.count, 0) }))
    .sort((a, b) => b.total - a.total || a.key.localeCompare(b.key))
    .slice(0, MAX_FACET_KEYS);
  const out: Record<string, FacetValue[]> = {};
  for (const k of keys.sort((a, b) => a.key.localeCompare(b.key))) {
    const ranked = k.values.some((v) => v.rank !== undefined);
    out[k.key] = k.values
      .sort((a, b) => (ranked ? optionOrder(a, b) : 0) || b.count - a.count || a.value.localeCompare(b.value))
      .slice(0, MAX_FACET_VALUES)
      .map(({ value, count }) => ({ value, count }));
  }
  return out;
}

const LETTER_SIZES = ["xxs", "xs", "s", "m", "l", "xl", "xxl", "2xl", "xxxl", "3xl", "4xl", "5xl"];
const letterSize = (v: string) => LETTER_SIZES.indexOf(v.trim().toLowerCase());
const leadingNumber = (v: string) => {
  const m = /^\s*(?:uk|us|eu|size)?\s*(\d+(?:\.\d+)?)/i.exec(v);
  return m ? Number(m[1]) : null;
};

/**
 * Option values in a sensible order: letter sizes on the S–M–L–XL ladder, then sizes that start with a number in
 * numeric order (28, 30, 32 · UK 6, UK 7), then the rest in the products' own option order (`rank`).
 */
function optionOrder(a: { value: string; rank?: number }, b: { value: string; rank?: number }): number {
  const kind = (v: string) => (letterSize(v) >= 0 ? 0 : leadingNumber(v) !== null ? 1 : 2);
  const ka = kind(a.value);
  const kb = kind(b.value);
  if (ka !== kb) return ka - kb;
  if (ka === 0) return letterSize(a.value) - letterSize(b.value);
  if (ka === 1) return leadingNumber(a.value)! - leadingNumber(b.value)! || a.value.localeCompare(b.value, "en", { numeric: true });
  return (a.rank ?? Infinity) - (b.rank ?? Infinity);
}

/**
 * An option and an attribute with the same name ("Cut") are one filter to a shopper: fold the attribute's values into
 * the option facet (values unioned, counts added; a product rarely has both) and drop the attribute facet. The search
 * matches `opt.<Name>` on either (`optionsMatchAttributes`).
 */
export function mergeSameNameFacets(
  attributes: Record<string, FacetValue[]>,
  options: Record<string, FacetValue[]>,
): { attributes: Record<string, FacetValue[]>; options: Record<string, FacetValue[]> } {
  const attrsOut: Record<string, FacetValue[]> = {};
  const optsOut: Record<string, FacetValue[]> = { ...options };
  for (const [name, values] of Object.entries(attributes)) {
    const opt = options[name];
    if (!opt) {
      attrsOut[name] = values;
      continue;
    }
    // The option's own order stays (sizes S, M, L); values only the attribute has follow, by count.
    const merged = opt.map((v) => ({ ...v }));
    const extra: FacetValue[] = [];
    for (const v of values) {
      const hit = merged.find((m) => m.value === v.value);
      if (hit) hit.count += v.count;
      else extra.push({ ...v });
    }
    optsOut[name] = [...merged, ...extra.sort((a, b) => b.count - a.count || a.value.localeCompare(b.value))].slice(0, MAX_FACET_VALUES);
  }
  return { attributes: attrsOut, options: optsOut };
}

/**
 * Category facet: direct product counts rolled up to every ancestor (a silk saree counts for "Silk" and "Sarees"), only
 * categories in `categories` (active ones) with a count, by count desc then name.
 */
export function rollupCategoryCounts(
  categories: readonly { id: string; parentId: string | null; name: string }[],
  direct: readonly { categoryId: string | null; count: number | string }[],
): { id: string; name: string; count: number }[] {
  const byId = new Map(categories.map((c) => [c.id, c]));
  const totals = new Map<string, number>();
  for (const d of direct) {
    const n = Number(d.count);
    if (!d.categoryId || !(n > 0)) continue;
    const seen = new Set<string>();
    for (let cur = byId.get(d.categoryId); cur && !seen.has(cur.id); cur = cur.parentId ? byId.get(cur.parentId) : undefined) {
      seen.add(cur.id);
      totals.set(cur.id, (totals.get(cur.id) ?? 0) + n);
    }
  }
  return [...totals.entries()]
    .map(([id, count]) => ({ id, name: byId.get(id)!.name, count }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

/** `{ min, max }` of the price facet; zeros for an empty set. */
export const priceFacet = (row: { min: number | string | null; max: number | string | null } | undefined) => ({
  min: row?.min === null || row?.min === undefined ? 0 : Number(row.min),
  max: row?.max === null || row?.max === undefined ? 0 : Number(row.max),
});

// ------------------------------------------------------------------ rating sort

export interface ProductRating {
  productId: string;
  average: number;
  count: number;
}

/** Implemented by @rbms/reviews (`ratings`). Unknown products may be missing or have count 0. */
export interface RatingsPort {
  ratings(tenantId: string, productIds: string[]): Promise<ProductRating[]>;
}

/** Implemented by inventory: which of these variants can be sold now (untracked items count as in stock). */
export interface AvailabilityPort {
  inStock(tenantId: string, variantIds: string[]): Promise<string[]>;
}

/**
 * Best rated first: average desc, then review count desc; unrated products last. Ties keep the incoming order (the
 * relevance/new order the candidates were fetched in).
 */
export function sortByRating(ids: readonly string[], ratings: readonly ProductRating[]): string[] {
  const r = new Map(ratings.map((x) => [x.productId, x]));
  return ids
    .map((id, i) => ({ id, i, avg: r.get(id)?.count ? r.get(id)!.average : -1, n: r.get(id)?.count ?? 0 }))
    .sort((a, b) => b.avg - a.avg || b.n - a.n || a.i - b.i)
    .map((x) => x.id);
}

/** Most products considered when sorting by rating or filtering by stock in memory. */
export const MAX_CANDIDATES = 2000;
