import { badRequest, defineSort, facetCounts, notFound, runList, searchAny, type FeatureGatePort, type ListPage } from "@rbms/core";
import type { Db } from "@rbms/db";
import { and, asc, count, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import { REVIEW_FEATURE_KEYS } from "./features";
import {
  formatAuthorName,
  initialStatus,
  productRatings,
  publicReviewQuerySchema,
  ratingSummary,
  replyInputSchema,
  resolveSettings,
  reviewInputSchema,
  staffReviewQuerySchema,
  toPublicReview,
  toReview,
  type ProductRating,
  type PublicReview,
  type PublicReviewQuery,
  type RatingSummary,
  type ReplyInput,
  type Review,
  type ReviewInput,
  type StaffReviewParams,
  type StaffReviewQuery,
} from "./logic";
import {
  noopLogger,
  type EventsPort,
  type LoggerPort,
  type OrdersPort,
  type ProductsPort,
  type ReviewRequestResult,
  type ReviewRequestsPort,
  type ReviewSettings,
  type ReviewSettingsPort,
  type ShopperPort,
} from "./ports";
import { productReviews, reviewVotes, type ReviewStatus } from "./schema";
import {
  DATE_MESSAGES,
  duplicateKey,
  importInputSchema,
  parseCsv,
  parseReviewDate,
  planImport,
  staffReviewInputSchema,
  verifyLinkedOrder,
  type ImportInput,
  type ImportRowResult,
  type StaffReviewInput,
} from "./staff";

export interface ReviewsDeps {
  db: Db;
  /** Product existence (catalogue). */
  products: ProductsPort;
  /** Verified-buyer check (orders). Without it no review is verified. */
  orders?: OrdersPort;
  /** The shopper's name for `author_name`. Without it reviews are by "Customer". */
  shoppers?: ShopperPort;
  /** Settings namespace `reviews`. Without it `autoApprove` is "verified". */
  settings?: ReviewSettingsPort;
  /** When given, `ratings()` (the catalogue's ratings port) returns nothing for shops with `reviews` off. */
  featureGate?: FeatureGatePort;
  /** Webhook events (developer module). Without it nothing is emitted. */
  events?: EventsPort;
  /** "Ask for a review" messages (customer messages). Without it review requests are unavailable. */
  requests?: ReviewRequestsPort;
  log?: LoggerPort;
  now?: () => Date;
}

export interface ListResult<T> {
  items: T[];
  total: number;
}

/** Staff list sort fields: `date` (written), `rating`, `helpful` (votes). Default newest first. */
export const REVIEW_SORT = defineSort(
  {
    date: productReviews.createdAt,
    rating: productReviews.rating,
    helpful: productReviews.helpfulCount,
  },
  { default: "-date", tieBreaker: [productReviews.createdAt, productReviews.id] },
);

export interface PublicReviewPage extends ListResult<PublicReview> {
  /** Over all approved reviews of the product (the `rating` filter doesn't change it). */
  summary: RatingSummary;
}

/**
 * Product reviews (docs/commerce-batch2.md §3): one review per shopper and product (editing replaces it), verified
 * buyers through the orders port, moderation (`autoApprove` setting), shop replies, one helpful vote per user, and
 * rating summaries for the storefront and the catalogue's rating sort.
 */
export class ReviewsService {
  private readonly db: Db;
  private readonly log: LoggerPort;
  private readonly now: () => Date;

  constructor(private readonly deps: ReviewsDeps) {
    this.db = deps.db;
    this.log = deps.log ?? noopLogger;
    this.now = deps.now ?? (() => new Date());
  }

  async settings(tenantId: string): Promise<ReviewSettings> {
    if (!this.deps.settings) return resolveSettings(null);
    try {
      return resolveSettings(await this.deps.settings.get(tenantId));
    } catch (err) {
      this.log.warn({ err, tenantId }, "reviews: settings unavailable, using defaults");
      return resolveSettings(null);
    }
  }

  private async row(tenantId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(productReviews)
      .where(and(eq(productReviews.tenantId, tenantId), eq(productReviews.id, id)))
      .limit(1);
    if (!row) throw notFound("Review");
    return row;
  }

  // ================================================================ public

  private async summaryOf(tenantId: string, productId: string): Promise<RatingSummary> {
    const rows = await this.db
      .select({ rating: productReviews.rating, count: count() })
      .from(productReviews)
      .where(and(eq(productReviews.tenantId, tenantId), eq(productReviews.productId, productId), eq(productReviews.status, "approved")))
      .groupBy(productReviews.rating);
    return ratingSummary(rows);
  }

  /** `GET /public/products/:productId/reviews`: approved reviews, sorted and filtered, plus the product's summary. */
  async listPublic(tenantId: string, productId: string, query: PublicReviewQuery = {}): Promise<PublicReviewPage> {
    const q = publicReviewQuerySchema.parse(query);
    const where = and(
      eq(productReviews.tenantId, tenantId),
      eq(productReviews.productId, productId),
      eq(productReviews.status, "approved"),
      q.rating ? eq(productReviews.rating, q.rating) : undefined,
      q.photos ? sql`jsonb_array_length(${productReviews.photos}) > 0` : undefined,
    );
    const order: SQL[] =
      q.sort === "helpful"
        ? [desc(productReviews.helpfulCount), desc(productReviews.createdAt)]
        : q.sort === "rating-desc"
          ? [desc(productReviews.rating), desc(productReviews.createdAt)]
          : q.sort === "rating-asc"
            ? [asc(productReviews.rating), desc(productReviews.createdAt)]
            : [desc(productReviews.createdAt)];
    const [rows, [counted], summary] = await Promise.all([
      this.db
        .select()
        .from(productReviews)
        .where(where)
        .orderBy(...order, asc(productReviews.id))
        .limit(q.limit)
        .offset(q.offset),
      this.db.select({ total: count() }).from(productReviews).where(where),
      this.summaryOf(tenantId, productId),
    ]);
    return { items: rows.map((r) => toPublicReview(toReview(r))), total: counted?.total ?? 0, summary };
  }

  /**
   * `GET /public/summary`: the whole shop's rating over approved reviews and the latest `limit` (≤ 12) of them, for the
   * storefront's reviews section. Zeros and no reviews when the shop has reviews switched off.
   */
  async shopSummary(tenantId: string, rawLimit: unknown = 6): Promise<RatingSummary & { items: PublicReview[] }> {
    const n = Number(rawLimit);
    const limit = Number.isInteger(n) && n >= 1 ? Math.min(n, 12) : 6;
    if (this.deps.featureGate && !(await this.deps.featureGate.isEnabled(tenantId, REVIEW_FEATURE_KEYS.base))) {
      return { ...ratingSummary([]), items: [] };
    }
    const where = and(eq(productReviews.tenantId, tenantId), eq(productReviews.status, "approved"));
    const [rows, latest] = await Promise.all([
      this.db.select({ rating: productReviews.rating, count: count() }).from(productReviews).where(where).groupBy(productReviews.rating),
      // Reviews with words read better on the home page than bare star ratings; then newest first.
      this.db
        .select()
        .from(productReviews)
        .where(where)
        .orderBy(sql`(coalesce(${productReviews.body}, '') <> '') desc`, desc(productReviews.createdAt), asc(productReviews.id))
        .limit(limit),
    ]);
    return { ...ratingSummary(rows), items: latest.map((r) => toPublicReview(toReview(r))) };
  }

  /**
   * `{ productId, average, count }` per product over approved reviews (zeros when unrated), in the order asked. Also the
   * catalogue's `RatingsPort`: with a feature gate, shops with `reviews` off get zeros.
   */
  async ratings(tenantId: string, productIds: string[]): Promise<ProductRating[]> {
    const ids = [...new Set(productIds)];
    if (ids.length === 0) return [];
    if (this.deps.featureGate && !(await this.deps.featureGate.isEnabled(tenantId, REVIEW_FEATURE_KEYS.base))) {
      return productRatings(ids, []);
    }
    const rows: { productId: string; rating: number; count: number }[] = [];
    for (let i = 0; i < ids.length; i += 500) {
      rows.push(
        ...(await this.db
          .select({ productId: productReviews.productId, rating: productReviews.rating, count: count() })
          .from(productReviews)
          .where(
            and(eq(productReviews.tenantId, tenantId), inArray(productReviews.productId, ids.slice(i, i + 500)), eq(productReviews.status, "approved")),
          )
          .groupBy(productReviews.productId, productReviews.rating)),
      );
    }
    return productRatings(ids, rows);
  }

  // ================================================================ shopper

  /** The shopper's own review of a product (any status), or null. */
  async mine(tenantId: string, userId: string, productId: string): Promise<Review | null> {
    const [row] = await this.db
      .select()
      .from(productReviews)
      .where(and(eq(productReviews.tenantId, tenantId), eq(productReviews.productId, productId), eq(productReviews.userId, userId)))
      .limit(1);
    return row ? toReview(row) : null;
  }

  /**
   * Writes the shopper's review of a product; a second submit replaces the first (rating, text, photos) and goes
   * through moderation again. Verified = a delivered order with the product; status from `autoApprove`. Helpful votes
   * and the shop's reply are kept.
   */
  async submit(tenantId: string, userId: string, productId: string, input: ReviewInput): Promise<Review> {
    const b = reviewInputSchema.parse(input);
    if (!(await this.deps.products.exists(tenantId, productId))) throw notFound("Product");
    const [delivered, name, settings] = await Promise.all([
      this.deps.orders?.hasDelivered(tenantId, userId, productId) ?? Promise.resolve(null),
      this.deps.shoppers?.displayName(tenantId, userId) ?? Promise.resolve(null),
      this.settings(tenantId),
    ]);
    const verified = Boolean(delivered);
    const values = {
      authorName: formatAuthorName(name),
      orderId: delivered?.orderId ?? null,
      rating: b.rating,
      title: b.title ?? null,
      body: b.body ?? null,
      photos: b.photos,
      status: initialStatus(settings.autoApprove, verified),
      verified,
    };
    const [row] = await this.db
      .insert(productReviews)
      .values({ tenantId, productId, userId, ...values })
      .onConflictDoUpdate({
        target: [productReviews.tenantId, productReviews.productId, productReviews.userId],
        set: { ...values, updatedAt: this.now() },
      })
      .returning();
    const review = toReview(row!);
    await this.emit(tenantId, "review.created", {
      id: review.id,
      productId: review.productId,
      rating: review.rating,
      title: review.title,
      status: review.status,
      createdAt: review.createdAt,
    });
    return review;
  }

  /** Best effort: a failing events port is logged, never thrown. */
  private async emit(tenantId: string, type: string, data: unknown): Promise<void> {
    if (!this.deps.events) return;
    try {
      await this.deps.events.emit(tenantId, type, data);
    } catch (err) {
      this.log.warn({ err, tenantId, type }, "reviews: event emit failed");
    }
  }

  /** One helpful vote per user (repeat votes are ignored); only approved reviews, not your own. */
  async markHelpful(tenantId: string, userId: string, reviewId: string): Promise<{ id: string; helpfulCount: number; voted: boolean }> {
    return this.db.transaction(async (tx) => {
      const [review] = await tx
        .select({ userId: productReviews.userId, status: productReviews.status, helpfulCount: productReviews.helpfulCount })
        .from(productReviews)
        .where(and(eq(productReviews.tenantId, tenantId), eq(productReviews.id, reviewId)))
        .limit(1);
      if (!review || review.status !== "approved") throw notFound("Review");
      if (review.userId === userId) throw badRequest("You can't vote for your own review");
      const inserted = await tx
        .insert(reviewVotes)
        .values({ tenantId, reviewId, userId })
        .onConflictDoNothing({ target: [reviewVotes.reviewId, reviewVotes.userId] })
        .returning({ id: reviewVotes.id });
      if (inserted.length === 0) return { id: reviewId, helpfulCount: review.helpfulCount, voted: false };
      const [updated] = await tx
        .update(productReviews)
        .set({ helpfulCount: sql`${productReviews.helpfulCount} + 1`, updatedAt: sql`${productReviews.updatedAt}` })
        .where(and(eq(productReviews.tenantId, tenantId), eq(productReviews.id, reviewId)))
        .returning({ helpfulCount: productReviews.helpfulCount });
      return { id: reviewId, helpfulCount: updated?.helpfulCount ?? review.helpfulCount + 1, voted: true };
    });
  }

  // ================================================================ staff

  /**
   * WHERE of the staff list; `without` drops one filter for its facet counts (status counts under the other filters,
   * rating counts under the other filters).
   */
  listConditions(tenantId: string, p: StaffReviewParams, without?: "status" | "rating"): SQL | undefined {
    return and(
      eq(productReviews.tenantId, tenantId),
      without !== "status" && p.status?.length ? inArray(productReviews.status, p.status) : undefined,
      without !== "rating" && p.rating?.length ? inArray(productReviews.rating, p.rating) : undefined,
      p.source?.length ? inArray(productReviews.source, p.source) : undefined,
      p.productId ? eq(productReviews.productId, p.productId) : undefined,
      p.hasPhotos === undefined
        ? undefined
        : p.hasPhotos
          ? sql`jsonb_array_length(${productReviews.photos}) > 0`
          : sql`jsonb_array_length(${productReviews.photos}) = 0`,
      searchAny(p.q, [productReviews.title, productReviews.body, productReviews.authorName]),
    );
  }

  /**
   * `GET /`: every review (docs/CONVENTIONS.md → "Lists and tables"), newest first by default (REVIEW_SORT), with
   * `facets.status` and `facets.rating` counts under the other filters.
   */
  async list(tenantId: string, query: StaffReviewQuery = {}): Promise<ListPage<Review>> {
    const p = staffReviewQuerySchema.parse(query);
    const order = REVIEW_SORT.orderBy(p.sort);
    const where = this.listConditions(tenantId, p);
    const [page, byStatus, byRating] = await Promise.all([
      runList(p, {
        rows: () => this.db.select().from(productReviews).where(where).orderBy(...order).limit(p.limit).offset(p.offset),
        count: () => this.db.select({ total: count() }).from(productReviews).where(where),
        map: toReview,
      }),
      this.db
        .select({ key: productReviews.status, n: count() })
        .from(productReviews)
        .where(this.listConditions(tenantId, p, "status"))
        .groupBy(productReviews.status),
      this.db
        .select({ key: sql<string>`${productReviews.rating}::text`, n: count() })
        .from(productReviews)
        .where(this.listConditions(tenantId, p, "rating"))
        .groupBy(productReviews.rating),
    ]);
    return { ...page, facets: { status: facetCounts(byStatus), rating: facetCounts(byRating) } };
  }

  async get(tenantId: string, id: string): Promise<Review> {
    return toReview(await this.row(tenantId, id));
  }

  private async setStatus(tenantId: string, id: string, status: ReviewStatus): Promise<Review> {
    const [row] = await this.db
      .update(productReviews)
      .set({ status })
      .where(and(eq(productReviews.tenantId, tenantId), eq(productReviews.id, id)))
      .returning();
    if (!row) throw notFound("Review");
    return toReview(row);
  }

  approve(tenantId: string, id: string): Promise<Review> {
    return this.setStatus(tenantId, id, "approved");
  }

  reject(tenantId: string, id: string): Promise<Review> {
    return this.setStatus(tenantId, id, "rejected");
  }

  /** The shop's public reply; an empty reply removes it. */
  async reply(tenantId: string, id: string, input: ReplyInput): Promise<Review> {
    const { reply } = replyInputSchema.parse(input);
    const [row] = await this.db
      .update(productReviews)
      .set({ reply: reply ?? null, repliedAt: reply ? this.now() : null })
      .where(and(eq(productReviews.tenantId, tenantId), eq(productReviews.id, id)))
      .returning();
    if (!row) throw notFound("Review");
    return toReview(row);
  }

  // ================================================================ staff-entered reviews

  /**
   * `POST /` (staff): a review the shop received elsewhere (at the counter, on Google, in reply to a review request).
   * The source is required and shown publicly. Verified only when `orderNumber` names a delivered order of this
   * product; status `approved` unless staff hold it as `pending`.
   */
  async createStaff(tenantId: string, staffUserId: string | null, input: StaffReviewInput): Promise<Review> {
    const b = staffReviewInputSchema.parse(input);
    if (!(await this.deps.products.exists(tenantId, b.productId))) throw notFound("Product");
    const now = this.now();
    let createdAt = now;
    if (b.date) {
      const d = parseReviewDate(b.date, now);
      if (!d.ok) throw badRequest(DATE_MESSAGES[d.error]);
      createdAt = d.date;
    }
    let link: { verified: boolean; orderId: string | null; error?: string } = { verified: false, orderId: null };
    if (b.orderNumber) {
      if (!this.deps.orders?.findForReview) throw badRequest("Orders can't be linked in this shop");
      link = verifyLinkedOrder(b.orderNumber, await this.deps.orders.findForReview(tenantId, b.orderNumber, b.productId));
      if (link.error) throw badRequest(link.error);
    }
    const [row] = await this.db
      .insert(productReviews)
      .values({
        tenantId,
        productId: b.productId,
        userId: null,
        authorName: formatAuthorName(b.authorName),
        authorCity: b.city ?? null,
        source: b.source,
        sourcePlatform: b.source === "imported" ? (b.platform ?? "other") : null,
        sourceUrl: b.source === "imported" ? (b.sourceUrl ?? null) : null,
        createdBy: staffUserId,
        orderId: link.orderId,
        verified: link.verified,
        rating: b.rating,
        title: b.title ?? null,
        body: b.body ?? null,
        photos: b.photos,
        status: b.status,
        createdAt,
        updatedAt: now,
      })
      .returning();
    const review = toReview(row!);
    await this.emit(tenantId, "review.created", {
      id: review.id,
      productId: review.productId,
      rating: review.rating,
      title: review.title,
      status: review.status,
      createdAt: review.createdAt,
    });
    return review;
  }

  /**
   * `POST /import` (staff): CSV of reviews (product SKU or slug, rating, title, text, name, city, date, source,
   * source_url, photos). `dryRun` (default) only checks: unknown products, bad ratings and dates, missing sources,
   * duplicates (same product, name, day and text, in the file or already saved). Otherwise saves the valid rows (never
   * verified) with the chosen status and reports the rest.
   */
  async importCsv(
    tenantId: string,
    staffUserId: string | null,
    input: ImportInput,
  ): Promise<{ dryRun: boolean; error?: string; total: number; valid: number; invalid: number; imported: number; rows: Omit<ImportRowResult, "values">[] }> {
    const b = importInputSchema.parse(input);
    let table: string[][];
    try {
      table = parseCsv(b.csv);
    } catch (err) {
      throw badRequest(`Couldn't read the CSV: ${(err as Error).message}`);
    }
    const now = this.now();
    // A first pass without products finds the file-level errors and the product keys to look up.
    const first = planImport(table, { products: new Map(), existing: new Set(), now });
    if (first.error) return { dryRun: b.dryRun, error: first.error, total: 0, valid: 0, invalid: 0, imported: 0, rows: [] };
    const productKeys = [...new Set(first.rows.map((r) => r.product.toLowerCase()).filter(Boolean))];
    const products = productKeys.length && this.deps.products.resolve ? await this.deps.products.resolve(tenantId, productKeys) : new Map<string, string>();
    const productIds = [...new Set(products.values())];
    const existing = new Set<string>();
    for (let i = 0; i < productIds.length; i += 500) {
      const rows = await this.db
        .select({ productId: productReviews.productId, authorName: productReviews.authorName, createdAt: productReviews.createdAt, body: productReviews.body })
        .from(productReviews)
        .where(and(eq(productReviews.tenantId, tenantId), inArray(productReviews.productId, productIds.slice(i, i + 500))));
      for (const r of rows) existing.add(duplicateKey(r.productId, r.authorName, r.createdAt, r.body));
    }
    const plan = planImport(table, { products, existing, now });
    const report = plan.rows.map(({ values: _v, ...r }) => r);
    const result = { dryRun: b.dryRun, error: plan.error, total: plan.rows.length, valid: plan.valid, invalid: plan.invalid, imported: 0, rows: report };
    if (b.dryRun || plan.valid === 0) return result;
    const values = plan.rows.flatMap((r) => (r.values ? [r.values] : []));
    await this.db.transaction(async (tx) => {
      for (let i = 0; i < values.length; i += 200) {
        await tx.insert(productReviews).values(
          values.slice(i, i + 200).map((v) => ({
            tenantId,
            productId: v.productId,
            userId: null,
            authorName: v.authorName,
            authorCity: v.authorCity,
            source: v.source,
            sourcePlatform: v.platform,
            sourceUrl: v.sourceUrl,
            createdBy: staffUserId,
            orderId: null,
            verified: false,
            rating: v.rating,
            title: v.title,
            body: v.body,
            photos: v.photos,
            status: b.status,
            createdAt: v.date,
            updatedAt: now,
          })),
        );
      }
    });
    this.log.info({ tenantId, imported: values.length, skipped: plan.invalid }, "reviews: CSV import");
    return { ...result, imported: values.length };
  }

  /** `POST /requests` (staff): asks the customer of a delivered order to review what they bought (once per order). */
  async requestReview(tenantId: string, orderId: string): Promise<ReviewRequestResult> {
    if (!this.deps.requests) throw badRequest("Review requests aren't available in this shop");
    return this.deps.requests.send(tenantId, orderId);
  }

  /** Deletes the review and its votes. */
  async remove(tenantId: string, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      await tx.delete(reviewVotes).where(and(eq(reviewVotes.tenantId, tenantId), eq(reviewVotes.reviewId, id)));
      const rows = await tx
        .delete(productReviews)
        .where(and(eq(productReviews.tenantId, tenantId), eq(productReviews.id, id)))
        .returning({ id: productReviews.id });
      if (rows.length === 0) throw notFound("Review");
    });
  }
}
