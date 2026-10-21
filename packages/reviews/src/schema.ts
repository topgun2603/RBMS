import { pk, tenantId, timestamps } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/**
 * Where a review came from. `customer`: a signed-in shopper wrote it on the store. The others are entered by staff:
 * `in_store` (feedback given at the counter), `imported` (copied from another platform, see `source_platform`),
 * `invited` (the customer answered the shop's review request by message and staff typed it in).
 */
export const REVIEW_SOURCES = ["customer", "in_store", "imported", "invited"] as const;
export type ReviewSource = (typeof REVIEW_SOURCES)[number];
export const STAFF_REVIEW_SOURCES = ["in_store", "imported", "invited"] as const;
export type StaffReviewSource = (typeof STAFF_REVIEW_SOURCES)[number];
/** Platforms an imported review can come from. */
export const REVIEW_PLATFORMS = ["google", "amazon", "flipkart", "meesho", "instagram", "other"] as const;
export type ReviewPlatform = (typeof REVIEW_PLATFORMS)[number];

/**
 * One review of one product. Shopper reviews (`source = customer`) are one per shopper and product (editing replaces
 * it); staff-entered reviews have no user. Only `approved` reviews are public.
 */
export const productReviews = pgTable(
  "product_reviews",
  {
    id: pk(),
    tenantId: tenantId(),
    /** Catalogue product id. */
    productId: uuid("product_id").notNull(),
    /** The shopper (auth user id); null for staff-entered reviews. */
    userId: uuid("user_id"),
    /** Shown publicly: first name + initial ("Priya S."), from the shopper or the name staff entered. */
    authorName: text("author_name").notNull(),
    /** Reviewer's town or city ("Madurai"), optional; staff-entered reviews only. */
    authorCity: text("author_city"),
    /** `customer` (written on the store) or a staff source; the storefront shows it as a label. */
    source: text("source").$type<ReviewSource>().notNull().default("customer"),
    /** Imported reviews: where from. */
    sourcePlatform: text("source_platform").$type<ReviewPlatform>(),
    /** Imported reviews: link to the original (optional). */
    sourceUrl: text("source_url"),
    /** Staff member who entered or imported it. */
    createdBy: uuid("created_by"),
    /**
     * A delivered order containing the product (`OrdersPort.hasDelivered` for shoppers, or an order number staff
     * linked and the service checked); only this makes a review "verified".
     */
    orderId: uuid("order_id"),
    rating: integer("rating").notNull(),
    title: text("title"),
    body: text("body"),
    /** Photo URLs (http/https, at most 5). */
    photos: jsonb("photos").$type<string[]>().notNull().default([]),
    status: text("status").$type<ReviewStatus>().notNull().default("pending"),
    verified: boolean("verified").notNull().default(false),
    helpfulCount: integer("helpful_count").notNull().default(0),
    /** The shop's public reply. */
    reply: text("reply"),
    repliedAt: timestamp("replied_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    unique("product_reviews_tenant_product_user_uq").on(t.tenantId, t.productId, t.userId),
    index("product_reviews_tenant_product_status_idx").on(t.tenantId, t.productId, t.status),
    index("product_reviews_tenant_status_created_idx").on(t.tenantId, t.status, t.createdAt),
    check("product_reviews_rating_ck", sql`${t.rating} between 1 and 5`),
    // "Verified" always points at a real order; a shopper review always has its shopper.
    check("product_reviews_verified_order_ck", sql`not ${t.verified} or ${t.orderId} is not null`),
    check("product_reviews_customer_user_ck", sql`${t.source} <> 'customer' or ${t.userId} is not null`),
  ],
);

/** "Helpful" votes: one per user per review. */
export const reviewVotes = pgTable(
  "review_votes",
  {
    id: pk(),
    tenantId: tenantId(),
    reviewId: uuid("review_id")
      .notNull()
      .references(() => productReviews.id, { onDelete: "cascade" }),
    userId: uuid("user_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [unique("review_votes_review_user_uq").on(t.reviewId, t.userId)],
);

export type ReviewRow = typeof productReviews.$inferSelect;
export type ReviewVoteRow = typeof reviewVotes.$inferSelect;
