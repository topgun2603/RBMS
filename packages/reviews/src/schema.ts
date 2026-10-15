import { pk, tenantId, timestamps } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import { boolean, check, index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

export const REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];

/** One shopper's review of one product (editing replaces it). Only `approved` reviews are public. */
export const productReviews = pgTable(
  "product_reviews",
  {
    id: pk(),
    tenantId: tenantId(),
    /** Catalogue product id. */
    productId: uuid("product_id").notNull(),
    /** The shopper (auth user id). */
    userId: uuid("user_id").notNull(),
    /** Shown publicly: first name + initial ("Priya S."), taken from the shopper when the review is written. */
    authorName: text("author_name").notNull(),
    /** A delivered order containing the product (`OrdersPort.hasDelivered`); makes the review "verified". */
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
