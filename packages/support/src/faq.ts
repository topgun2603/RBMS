import { z } from "zod";
import type { FaqArticleRow, FaqCategoryRow, FaqSeo, FaqStatus } from "./schema";

// ------------------------------------------------------------------ markdown + slugs (same rules as @srirealtime/cms)

/** Removes HTML tags and comments: content is markdown, rendered client-side by a safe renderer; no raw HTML is stored. */
export function stripHtml(value: string): string {
  return value.replace(/<!--[\s\S]*?-->/g, "").replace(/<\/?[a-zA-Z][^<>]*>/g, "");
}

export const SLUG_MAX = 80;
/** `[a-z0-9]` words joined by single hyphens. */
export const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** `/public/faq/search` is a route, so no article may take that slug. */
export const RESERVED_FAQ_SLUGS: ReadonlySet<string> = new Set(["search", "categories", "new"]);

export const isValidSlug = (slug: string) => slug.length > 0 && slug.length <= SLUG_MAX && SLUG_RE.test(slug);
export const isReservedFaqSlug = (slug: string) => RESERVED_FAQ_SLUGS.has(slug);

const shortId = () => Math.random().toString(36).slice(2, 8).padEnd(6, "0");

/** "Refunds & Returns!" → "refunds-and-returns"; titles without Latin letters/digits fall back to `<prefix>-<shortid>`. */
export function slugify(title: string, prefix = "faq", id: () => string = shortId): string {
  const ascii = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  const cut = ascii.slice(0, SLUG_MAX).replace(/-+$/, "");
  return cut || `${prefix}-${id()}`;
}

/** `base`, else `base-2`, `base-3`, … — the first that is neither taken nor reserved. */
export function uniqueSlug(base: string, taken: ReadonlySet<string>): string {
  const free = (s: string) => !taken.has(s) && !isReservedFaqSlug(s);
  if (free(base)) return base;
  const stem = base.slice(0, SLUG_MAX - 4).replace(/-+$/, "");
  for (let n = 2; ; n++) {
    const candidate = `${stem}-${n}`;
    if (free(candidate)) return candidate;
  }
}

export type SlugProblem = "invalid" | "reserved" | "taken";

/** Why a chosen slug can't be used, or null when it can. */
export function slugProblem(slug: string, taken: ReadonlySet<string>): SlugProblem | null {
  if (!isValidSlug(slug)) return "invalid";
  if (isReservedFaqSlug(slug)) return "reserved";
  if (taken.has(slug)) return "taken";
  return null;
}

// ------------------------------------------------------------------ input

export const FAQ_LIMITS = { title: 200, name: 80, description: 500, body: 20_000 } as const;

const opt = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), s.nullable().optional());
const slugInput = opt(z.string().trim().toLowerCase().max(SLUG_MAX));
const markdown = (max: number) => z.string().max(max).transform((s) => stripHtml(s).trim());

export const faqSeoSchema = z.object({
  title: z.string().trim().max(70).optional(),
  description: z.string().trim().max(320).optional(),
  noindex: z.boolean().optional(),
});

export const faqCategoryInputSchema = z.object({
  name: z.string().trim().min(1).max(FAQ_LIMITS.name),
  /** Empty = from the name. */
  slug: slugInput,
  description: opt(markdown(FAQ_LIMITS.description)),
  sort: z.number().int().min(0).max(100_000).default(0),
});
export type FaqCategoryInput = z.input<typeof faqCategoryInputSchema>;
export const faqCategoryPatchSchema = faqCategoryInputSchema.partial().extend({ sort: z.number().int().min(0).max(100_000).optional() });
export type FaqCategoryPatch = z.input<typeof faqCategoryPatchSchema>;

export const faqArticleInputSchema = z.object({
  title: z.string().trim().min(3).max(FAQ_LIMITS.title),
  /** Empty = from the title. */
  slug: slugInput,
  body: markdown(FAQ_LIMITS.body).default(""),
  categoryId: z.string().uuid().nullable().optional(),
  sort: z.number().int().min(0).max(100_000).default(0),
  seo: faqSeoSchema.nullable().optional(),
  /** Publish straight away. */
  status: z.enum(["draft", "published"]).default("draft"),
});
export type FaqArticleInput = z.input<typeof faqArticleInputSchema>;
export const faqArticlePatchSchema = faqArticleInputSchema
  .partial()
  .extend({ sort: z.number().int().min(0).max(100_000).optional(), body: markdown(FAQ_LIMITS.body).optional(), status: z.enum(["draft", "published"]).optional() });
export type FaqArticlePatch = z.input<typeof faqArticlePatchSchema>;

export const faqArticleQuerySchema = z.object({
  status: z.enum(["draft", "published"]).optional(),
  categoryId: z.string().uuid().optional(),
  q: z.string().trim().max(100).optional(),
});
export type FaqArticleQuery = z.input<typeof faqArticleQuerySchema>;

export const faqSearchQuerySchema = z.object({
  q: z.string().trim().max(100).default(""),
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export const helpfulInputSchema = z.object({ helpful: z.boolean() });

// ------------------------------------------------------------------ output

export interface FaqCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  sort: number;
}

export interface FaqArticle {
  id: string;
  categoryId: string | null;
  slug: string;
  title: string;
  body: string;
  status: FaqStatus;
  helpfulYes: number;
  helpfulNo: number;
  sort: number;
  seo: FaqSeo | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Public list entry (no body). */
export interface FaqArticleSummary {
  id: string;
  categoryId: string | null;
  slug: string;
  title: string;
  excerpt: string;
}

export const toFaqCategory = (r: FaqCategoryRow): FaqCategory => ({ id: r.id, name: r.name, slug: r.slug, description: r.description, sort: r.sort });

export const toFaqArticle = (r: FaqArticleRow): FaqArticle => ({
  id: r.id,
  categoryId: r.categoryId,
  slug: r.slug,
  title: r.title,
  body: r.body,
  status: r.status,
  helpfulYes: r.helpfulYes,
  helpfulNo: r.helpfulNo,
  sort: r.sort,
  seo: r.seo ?? null,
  publishedAt: r.publishedAt,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

/** Markdown → a one-line plain-text excerpt. */
export function excerptOf(markdownBody: string, max = 160): string {
  const plain = markdownBody
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*(?:#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_`~]+/g, "")
    .replace(/\|/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}…` : plain;
}

export const toSummary = (a: Pick<FaqArticle, "id" | "categoryId" | "slug" | "title" | "body">): FaqArticleSummary => ({
  id: a.id,
  categoryId: a.categoryId,
  slug: a.slug,
  title: a.title,
  excerpt: excerptOf(a.body),
});

/** Categories (by sort, then name) with their published articles; uncategorised articles go in a trailing `null` group. */
export function groupFaq(categories: readonly FaqCategory[], articles: readonly FaqArticle[]) {
  const byCat = new Map<string | null, FaqArticleSummary[]>();
  const ordered = [...articles].sort((a, b) => a.sort - b.sort || a.title.localeCompare(b.title));
  for (const a of ordered) {
    const key = a.categoryId && categories.some((c) => c.id === a.categoryId) ? a.categoryId : null;
    byCat.set(key, [...(byCat.get(key) ?? []), toSummary(a)]);
  }
  const cats = [...categories].sort((a, b) => a.sort - b.sort || a.name.localeCompare(b.name));
  const groups: { category: FaqCategory | null; articles: FaqArticleSummary[] }[] = cats
    .map((c) => ({ category: c as FaqCategory | null, articles: byCat.get(c.id) ?? [] }))
    .filter((g) => g.articles.length > 0);
  const loose = byCat.get(null);
  if (loose?.length) groups.push({ category: null, articles: loose });
  return groups;
}

// ------------------------------------------------------------------ search

const STOPWORDS = new Set([
  "a", "an", "and", "are", "as", "at", "be", "by", "can", "do", "does", "for", "from", "how", "i", "in", "is", "it",
  "my", "of", "on", "or", "the", "to", "what", "when", "where", "which", "who", "why", "will", "with", "you", "your",
]);

/** Lower-case word tokens (any script, so Tamil works), stop words removed. Markdown punctuation is ignored. */
export function tokenize(text: string): string[] {
  return text
    .normalize("NFKC")
    .toLowerCase()
    .split(/[^\p{L}\p{N}\p{M}]+/u)
    .filter((t) => t.length > 0 && !STOPWORDS.has(t));
}

/** Weights of the simple FAQ ranking (exported for tests and tuning). */
export const SEARCH_WEIGHTS = { titleExact: 10, titlePartial: 6, bodyExact: 2, bodyRepeat: 0.5, bodyPartial: 1, allTerms: 5, titlePhrase: 8 } as const;

/** `a` and `b` share a stem: one is a prefix of the other and the shorter has at least 4 characters ("refund" ~ "refunds"). */
const partial = (a: string, b: string) => {
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  return s.length >= 4 && l.startsWith(s);
};

/**
 * Relevance of an article for a query: per query term, an exact title word scores most, a shared stem in the title
 * next, then body words (repeats add a little, capped). Matching every term and the whole query appearing in the title
 * add bonuses. 0 = no match.
 */
export function scoreArticle(query: string, article: { title: string; body: string }): number {
  const terms = [...new Set(tokenize(query))];
  if (terms.length === 0) return 0;
  const title = tokenize(article.title);
  const body = tokenize(article.body);
  const bodyCounts = new Map<string, number>();
  for (const t of body) bodyCounts.set(t, (bodyCounts.get(t) ?? 0) + 1);
  const w = SEARCH_WEIGHTS;
  let score = 0;
  let matched = 0;
  for (const q of terms) {
    let s = 0;
    if (title.includes(q)) s += w.titleExact;
    else if (title.some((t) => partial(t, q))) s += w.titlePartial;
    const n = bodyCounts.get(q) ?? 0;
    if (n > 0) s += w.bodyExact + Math.min(n - 1, 3) * w.bodyRepeat;
    else if (body.some((t) => partial(t, q))) s += w.bodyPartial;
    if (s > 0) matched++;
    score += s;
  }
  if (score === 0) return 0;
  if (terms.length > 1 && matched === terms.length) score += w.allTerms;
  if (terms.length > 1 && ` ${title.join(" ")} `.includes(` ${terms.join(" ")} `)) score += w.titlePhrase;
  return score;
}

/** Articles matching `query`, best first (ties: more helpful votes, then `sort`, then title). */
export function rankArticles<T extends { title: string; body: string; helpfulYes?: number; helpfulNo?: number; sort?: number }>(
  query: string,
  articles: readonly T[],
  limit = 10,
): { article: T; score: number }[] {
  const net = (a: T) => (a.helpfulYes ?? 0) - (a.helpfulNo ?? 0);
  return articles
    .map((article) => ({ article, score: scoreArticle(query, article) }))
    .filter((r) => r.score > 0)
    .sort(
      (a, b) =>
        b.score - a.score ||
        net(b.article) - net(a.article) ||
        (a.article.sort ?? 0) - (b.article.sort ?? 0) ||
        a.article.title.localeCompare(b.article.title),
    )
    .slice(0, limit);
}
