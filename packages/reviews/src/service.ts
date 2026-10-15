import { badRequest, notFound, type FeatureGatePort } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
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
  type StaffReviewQuery,
} from "./logic";
import { noopLogger, type LoggerPort, type OrdersPort, type ProductsPort, type ReviewSettings, type ReviewSettingsPort, type ShopperPort } from "./ports";
import { productReviews, reviewVotes, type ReviewStatus } from "./schema";

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
  log?: LoggerPort;
  now?: () => Date;
}

export interface ListResult<T> {
  items: T[];
  total: number;
}

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
    return toReview(row!);
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

  /** `GET /`: every review, newest first, filterable by status, rating and product. */
  async list(tenantId: string, query: StaffReviewQuery = {}): Promise<ListResult<Review>> {
    const q = staffReviewQuerySchema.parse(query);
    const where = and(
      eq(productReviews.tenantId, tenantId),
      q.status ? eq(productReviews.status, q.status) : undefined,
      q.rating ? eq(productReviews.rating, q.rating) : undefined,
      q.productId ? eq(productReviews.productId, q.productId) : undefined,
    );
    const [rows, [counted]] = await Promise.all([
      this.db.select().from(productReviews).where(where).orderBy(desc(productReviews.createdAt), asc(productReviews.id)).limit(q.limit).offset(q.offset),
      this.db.select({ total: count() }).from(productReviews).where(where),
    ]);
    return { items: rows.map(toReview), total: counted?.total ?? 0 };
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
