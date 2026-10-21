import { listFilter, listQuerySchema } from "@srirealtime/core";
import { z } from "zod";
import { REVIEW_SOURCES, REVIEW_STATUSES, type ReviewPlatform, type ReviewRow, type ReviewSource, type ReviewStatus } from "./schema";

// ------------------------------------------------------------------ settings

export const AUTO_APPROVE = ["none", "verified", "all"] as const;
export type AutoApprove = (typeof AUTO_APPROVE)[number];

/** For apps/api: `settings.define("reviews", REVIEW_SETTINGS_SCHEMA, REVIEW_SETTINGS_DEFAULTS)`. */
export const REVIEW_SETTINGS_SCHEMA = z.object({ autoApprove: z.enum(AUTO_APPROVE) });
export const REVIEW_SETTINGS_DEFAULTS: z.infer<typeof REVIEW_SETTINGS_SCHEMA> = { autoApprove: "verified" };

/** A stored settings value (possibly partial or stale) with defaults filled in. */
export function resolveSettings(raw: Partial<{ autoApprove: unknown }> | null | undefined): { autoApprove: AutoApprove } {
  const v = raw?.autoApprove;
  return { autoApprove: (AUTO_APPROVE as readonly unknown[]).includes(v) ? (v as AutoApprove) : REVIEW_SETTINGS_DEFAULTS.autoApprove };
}

/** Status of a new or edited review: "all" publishes everything, "verified" only verified buyers', "none" nothing. */
export function initialStatus(autoApprove: AutoApprove, verified: boolean): ReviewStatus {
  if (autoApprove === "all") return "approved";
  if (autoApprove === "verified" && verified) return "approved";
  return "pending";
}

// ------------------------------------------------------------------ input

export const MAX_PHOTOS = 5;

const opt = <T extends z.ZodTypeAny>(s: T) =>
  z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? null : v), s.nullable().optional());

export const photoUrlSchema = z
  .string()
  .trim()
  .max(2000)
  .url("Photos must be links")
  .refine((u) => /^https?:\/\//i.test(u), "Photos must be http(s) links");

export const reviewInputSchema = z.object({
  rating: z.number().int("Rate 1 to 5 stars").min(1, "Rate 1 to 5 stars").max(5, "Rate 1 to 5 stars"),
  title: opt(z.string().trim().max(120)),
  body: opt(z.string().trim().max(5000)),
  photos: z
    .array(photoUrlSchema)
    .max(MAX_PHOTOS, `At most ${MAX_PHOTOS} photos`)
    .transform((list) => [...new Set(list)])
    .default([]),
});
export type ReviewInput = z.input<typeof reviewInputSchema>;

export const replyInputSchema = z.object({
  /** Empty or null removes the reply. */
  reply: opt(z.string().trim().max(2000)),
});
export type ReplyInput = z.input<typeof replyInputSchema>;

const limit = (max: number, dflt: number) => z.coerce.number().int().min(1).max(max).default(dflt);
const offset = z.coerce.number().int().min(0).default(0);
const ratingFilter = z.coerce.number().int().min(1).max(5).optional();

export const PUBLIC_REVIEW_SORTS = ["recent", "helpful", "rating-desc", "rating-asc"] as const;
export type PublicReviewSort = (typeof PUBLIC_REVIEW_SORTS)[number];

export const publicReviewQuerySchema = z.object({
  sort: z.enum(PUBLIC_REVIEW_SORTS).default("recent"),
  rating: ratingFilter,
  /** `photos=true`: only reviews with photos. */
  photos: z.preprocess((v) => v === "true" || v === true || v === "1", z.boolean()).default(false),
  limit: limit(50, 10),
  offset,
});
export type PublicReviewQuery = z.input<typeof publicReviewQuerySchema>;

/**
 * Staff moderation list, `GET /v1/reviews` (docs/CONVENTIONS.md → "Lists and tables"): `status` and `rating` take
 * comma lists (`status=pending`, `rating=1,2`), `hasPhotos=true|false`, `productId`, `q` (title, text, author name).
 * Default 50 / max 200 rows (unchanged for existing callers).
 */
export const staffReviewQuerySchema = listQuerySchema({ defaultLimit: 50, maxLimit: 200 }).extend({
  status: listFilter.oneOf(REVIEW_STATUSES),
  rating: listFilter.oneOf(["1", "2", "3", "4", "5"]).transform((v) => v?.map(Number)),
  hasPhotos: listFilter.bool(),
  source: listFilter.oneOf(REVIEW_SOURCES),
  productId: listFilter.id(),
});
export type StaffReviewQuery = z.input<typeof staffReviewQuerySchema>;
export type StaffReviewParams = z.output<typeof staffReviewQuerySchema>;

/** `productIds=a,b` (or repeated). */
export const productIdsQuerySchema = z.object({
  productIds: z
    .union([z.string(), z.array(z.string())])
    .transform((v) => (Array.isArray(v) ? v : [v]).flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean))
    .pipe(z.array(z.string().uuid()).max(200)),
});

// ------------------------------------------------------------------ author name

const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const graphemes = (s: string) => [...segmenter.segment(s)].map((g) => g.segment);
const HAS_LETTER = /\p{L}/u;

/** "K", "K.", "R.K." — leading initials, common in Tamil names ("K. Murugan"). */
const isInitial = (token: string) => {
  const bare = token.replace(/\./g, "");
  const n = graphemes(bare).length;
  return n > 0 && (n === 1 || (token.includes(".") && n <= 3));
};

export const ANONYMOUS_AUTHOR = "Customer";

/**
 * Public author name: first name + the initial of another name part. "Priya Sharma" → "Priya S.";
 * "K. Murugan" → "Murugan K."; "முருகன் கணேசன்" → "முருகன் க." (initial = first grapheme); a single name stays as is;
 * blank or letter-less input (e.g. a phone number) → "Customer".
 */
export function formatAuthorName(displayName: string | null | undefined): string {
  const tokens = (displayName ?? "").normalize("NFC").trim().split(/\s+/).filter((t) => HAS_LETTER.test(t));
  if (tokens.length === 0) return ANONYMOUS_AUTHOR;
  const firstIdx = tokens.findIndex((t) => !isInitial(t));
  if (firstIdx < 0) return tokens.join(" ").slice(0, 40);
  const first = tokens[firstIdx]!.slice(0, 40);
  // Prefer a later full name part ("Dr. Priya Sharma" → S), else any later part, else a leading initial ("K. Murugan").
  const later = tokens.slice(firstIdx + 1);
  const other = later.find((t) => !isInitial(t)) ?? later[0] ?? (firstIdx > 0 ? tokens[0] : undefined);
  if (!other) return first;
  const initial = graphemes(other.replace(/\./g, ""))[0];
  return initial ? `${first} ${initial.toLocaleUpperCase()}.` : first;
}

// ------------------------------------------------------------------ rating summary

export interface RatingDistribution {
  1: number;
  2: number;
  3: number;
  4: number;
  5: number;
}

export interface RatingSummary {
  /** Mean rating rounded to one decimal; 0 without reviews. */
  average: number;
  count: number;
  distribution: RatingDistribution;
}

/** From `{ rating, count }` rows (one per star value, any order; out-of-range ratings ignored). */
export function ratingSummary(rows: readonly { rating: number; count: number | string }[]): RatingSummary {
  const distribution: RatingDistribution = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  let count = 0;
  let sum = 0;
  for (const r of rows) {
    const n = Number(r.count);
    if (!Number.isInteger(r.rating) || r.rating < 1 || r.rating > 5 || !(n > 0)) continue;
    distribution[r.rating as keyof RatingDistribution] += n;
    count += n;
    sum += r.rating * n;
  }
  return { average: count ? Math.round((sum / count) * 10) / 10 : 0, count, distribution };
}

export interface ProductRating {
  productId: string;
  average: number;
  count: number;
}

/** Per-product `{ average, count }` for each asked id (in order, deduped; zeros when unrated). */
export function productRatings(ids: readonly string[], rows: readonly { productId: string; rating: number; count: number | string }[]): ProductRating[] {
  const byProduct = new Map<string, { rating: number; count: number | string }[]>();
  for (const r of rows) {
    const list = byProduct.get(r.productId) ?? [];
    list.push(r);
    byProduct.set(r.productId, list);
  }
  return [...new Set(ids)].map((productId) => {
    const s = ratingSummary(byProduct.get(productId) ?? []);
    return { productId, average: s.average, count: s.count };
  });
}

// ------------------------------------------------------------------ output

/** What shoppers see (no user id, order id or status). */
export interface PublicReview {
  id: string;
  productId: string;
  authorName: string;
  /** Staff-entered reviews may carry the reviewer's town. */
  authorCity: string | null;
  /** Where it came from; the storefront labels non-customer reviews ("Shared in store", "From Google"). */
  source: ReviewSource;
  sourcePlatform: ReviewPlatform | null;
  sourceUrl: string | null;
  rating: number;
  title: string | null;
  body: string | null;
  photos: string[];
  verified: boolean;
  helpfulCount: number;
  reply: string | null;
  repliedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Staff view, and the author's own view of their review. */
export interface Review extends PublicReview {
  /** Null for staff-entered reviews. */
  userId: string | null;
  orderId: string | null;
  /** Staff member who entered or imported it. */
  createdBy: string | null;
  status: ReviewStatus;
}

export const toReview = (r: ReviewRow): Review => ({
  id: r.id,
  productId: r.productId,
  userId: r.userId,
  authorName: r.authorName,
  authorCity: r.authorCity ?? null,
  source: r.source ?? "customer",
  sourcePlatform: r.sourcePlatform ?? null,
  sourceUrl: r.sourceUrl ?? null,
  createdBy: r.createdBy ?? null,
  orderId: r.orderId,
  rating: r.rating,
  title: r.title,
  body: r.body,
  photos: r.photos ?? [],
  status: r.status,
  verified: r.verified,
  helpfulCount: r.helpfulCount,
  reply: r.reply,
  repliedAt: r.repliedAt,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

export function toPublicReview(r: Review): PublicReview {
  const { userId: _u, orderId: _o, status: _s, createdBy: _c, ...rest } = r;
  return rest;
}
