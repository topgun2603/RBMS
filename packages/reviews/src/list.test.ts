import { AppError } from "@srirealtime/core";
import { createDb } from "@srirealtime/db";
import { afterAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { staffReviewQuerySchema } from "./logic";
import { productReviews } from "./schema";
import { REVIEW_SORT, ReviewsService } from "./service";

// Never connects: the tests only render SQL.
const { db, close } = createDb("postgres://u:p@127.0.0.1:1/none", { max: 1 });
afterAll(() => close());

const T = "11111111-1111-4111-8111-111111111111";
const P = "44444444-4444-4444-8444-444444444444";
const svc = new ReviewsService({ db, products: { exists: async () => true } });
const where = (q: Record<string, unknown>, without?: "status" | "rating") =>
  db.select().from(productReviews).where(svc.listConditions(T, staffReviewQuerySchema.parse(q), without)).toSQL();
const order = (s?: string) => db.select().from(productReviews).orderBy(...REVIEW_SORT.orderBy(s)).toSQL().sql;

describe("staff review list query", () => {
  it("keeps 50 / 200 rows and takes comma lists for status and rating", () => {
    expect(staffReviewQuerySchema.parse({})).toMatchObject({ limit: 50, offset: 0 });
    expect(() => staffReviewQuerySchema.parse({ limit: "201" })).toThrow(ZodError);
    expect(staffReviewQuerySchema.parse({ status: "pending,approved", rating: "1,2", hasPhotos: "true", productId: P })).toMatchObject({
      status: ["pending", "approved"],
      rating: [1, 2],
      hasPhotos: true,
      productId: P,
    });
    expect(staffReviewQuerySchema.parse({ status: "", rating: "", hasPhotos: "" })).toMatchObject({ status: undefined, rating: undefined, hasPhotos: undefined });
    expect(() => staffReviewQuerySchema.parse({ status: "spam" })).toThrow(ZodError);
    expect(() => staffReviewQuerySchema.parse({ rating: "6" })).toThrow(ZodError);
    expect(() => staffReviewQuerySchema.parse({ productId: "nope" })).toThrow(ZodError);
  });

  it("filters by tenant, status, rating, product, photos and search", () => {
    const q = where({ status: "pending", rating: "4,5", productId: P, hasPhotos: "1", q: "50%_off" });
    expect(q.sql).toContain('"product_reviews"."tenant_id" = $1');
    expect(q.sql).toContain('"product_reviews"."status" in ($2)');
    expect(q.sql).toContain('"product_reviews"."rating" in ($3, $4)');
    expect(q.sql).toContain('"product_reviews"."product_id" = $5');
    expect(q.sql).toContain('jsonb_array_length("product_reviews"."photos") > 0');
    expect(q.sql).toContain('"product_reviews"."title" ilike');
    expect(q.sql).toContain('"product_reviews"."body" ilike');
    expect(q.sql).toContain('"product_reviews"."author_name" ilike');
    expect(q.params).toEqual(expect.arrayContaining([T, "pending", 4, 5, P, "%50\\%\\_off%"]));
    expect(where({ hasPhotos: "false" }).sql).toContain('jsonb_array_length("product_reviews"."photos") = 0');
    expect(where({}).params).toEqual([T]);
    const bySource = where({ source: "in_store,imported" });
    expect(bySource.sql).toContain('"product_reviews"."source" in ($2, $3)');
    expect(bySource.params).toEqual([T, "in_store", "imported"]);
    expect(() => where({ source: "fake" })).toThrow(ZodError);
  });

  it("facet WHEREs leave out their own filter only", () => {
    const byStatus = where({ status: "pending", rating: "5" }, "status");
    expect(byStatus.params).toEqual([T, 5]);
    const byRating = where({ status: "pending", rating: "5" }, "rating");
    expect(byRating.params).toEqual([T, "pending"]);
  });

  it("sorts by whitelisted fields, newest first by default", () => {
    expect(REVIEW_SORT.default).toBe("-date");
    expect(order()).toContain('order by "product_reviews"."created_at" desc nulls last, "product_reviews"."created_at" desc, "product_reviews"."id" desc');
    expect(order("rating")).toContain('order by "product_reviews"."rating" asc nulls last');
    expect(order("-helpful")).toContain('"product_reviews"."helpful_count" desc nulls last');
    expect(() => order("author")).toThrow(AppError);
  });
});
