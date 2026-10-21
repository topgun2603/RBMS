import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  formatAuthorName,
  initialStatus,
  productIdsQuerySchema,
  productRatings,
  publicReviewQuerySchema,
  ratingSummary,
  replyInputSchema,
  resolveSettings,
  REVIEW_SETTINGS_DEFAULTS,
  REVIEW_SETTINGS_SCHEMA,
  reviewInputSchema,
  staffReviewQuerySchema,
  toPublicReview,
  toReview,
} from "./logic";
import type { ReviewRow } from "./schema";

const A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

describe("ratingSummary", () => {
  it("counts, distributes and averages to one decimal", () => {
    expect(
      ratingSummary([
        { rating: 5, count: 3 },
        { rating: 4, count: "1" },
        { rating: 1, count: 1 },
      ]),
    ).toEqual({ average: 4, count: 5, distribution: { 1: 1, 2: 0, 3: 0, 4: 1, 5: 3 } });
    // (5 + 4 + 4) / 3 = 4.333… → 4.3; (5 + 4) / 2 = 4.5
    expect(ratingSummary([{ rating: 5, count: 1 }, { rating: 4, count: 2 }]).average).toBe(4.3);
    expect(ratingSummary([{ rating: 5, count: 1 }, { rating: 4, count: 1 }]).average).toBe(4.5);
    // 2 × 5 + 1 × 4 = 14 / 3 = 4.666… → 4.7
    expect(ratingSummary([{ rating: 4, count: 1 }, { rating: 5, count: 2 }]).average).toBe(4.7);
  });

  it("is zero without reviews and ignores junk rows", () => {
    expect(ratingSummary([])).toEqual({ average: 0, count: 0, distribution: { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 } });
    expect(ratingSummary([{ rating: 6, count: 4 }, { rating: 0, count: 1 }, { rating: 2.5, count: 1 }, { rating: 3, count: 0 }]).count).toBe(0);
  });

  it("merges duplicate star rows", () => {
    expect(ratingSummary([{ rating: 3, count: 1 }, { rating: 3, count: 2 }]).distribution[3]).toBe(3);
  });

  it("productRatings answers every asked id, in order, deduped", () => {
    expect(
      productRatings(
        [B, A, B],
        [
          { productId: A, rating: 5, count: 1 },
          { productId: A, rating: 2, count: 1 },
        ],
      ),
    ).toEqual([
      { productId: B, average: 0, count: 0 },
      { productId: A, average: 3.5, count: 2 },
    ]);
  });
});

describe("formatAuthorName", () => {
  it.each([
    ["Priya Sharma", "Priya S."],
    ["  priya   sharma  ", "priya S."],
    ["Priya", "Priya"],
    ["K. Murugan", "Murugan K."],
    ["R.K. Selvam", "Selvam R."],
    ["Dr. Priya Sharma", "Priya S."],
    ["Priya S.", "Priya S."],
    ["Anand Kumar Raja", "Anand K."],
    ["முருகன் கணேசன்", "முருகன் க."],
    ["கோபி கோபால்", "கோபி கோ."],
    ["K.", "K."],
    ["", "Customer"],
    [null, "Customer"],
    ["+91 98765 43210", "Customer"],
  ])("%s → %s", (input, expected) => {
    expect(formatAuthorName(input)).toBe(expected);
  });
});

describe("moderation", () => {
  it("autoApprove decides the status of new and edited reviews", () => {
    expect(initialStatus("all", false)).toBe("approved");
    expect(initialStatus("verified", true)).toBe("approved");
    expect(initialStatus("verified", false)).toBe("pending");
    expect(initialStatus("none", true)).toBe("pending");
  });

  it("settings default to verified and tolerate partial or stale values", () => {
    expect(REVIEW_SETTINGS_DEFAULTS).toEqual({ autoApprove: "verified" });
    expect(REVIEW_SETTINGS_SCHEMA.parse(REVIEW_SETTINGS_DEFAULTS)).toEqual(REVIEW_SETTINGS_DEFAULTS);
    expect(resolveSettings(null)).toEqual({ autoApprove: "verified" });
    expect(resolveSettings({})).toEqual({ autoApprove: "verified" });
    expect(resolveSettings({ autoApprove: "everyone" })).toEqual({ autoApprove: "verified" });
    expect(resolveSettings({ autoApprove: "all" })).toEqual({ autoApprove: "all" });
  });
});

describe("input schemas", () => {
  it("needs a whole 1–5 rating; title and body are optional and trimmed", () => {
    expect(reviewInputSchema.parse({ rating: 5, title: " Super ", body: "" })).toEqual({ rating: 5, title: "Super", body: null, photos: [] });
    for (const rating of [0, 6, 4.5, "5", undefined]) expect(() => reviewInputSchema.parse({ rating })).toThrow(ZodError);
    expect(() => reviewInputSchema.parse({ rating: 3, title: "x".repeat(121) })).toThrow(ZodError);
    expect(() => reviewInputSchema.parse({ rating: 3, body: "x".repeat(5001) })).toThrow(ZodError);
  });

  it("accepts at most 5 http(s) photo URLs (duplicates dropped)", () => {
    const url = (i: number) => `https://cdn.example.com/r/${i}.jpg`;
    expect(reviewInputSchema.parse({ rating: 4, photos: [url(1), url(1), "http://x.in/a.png"] }).photos).toEqual([url(1), "http://x.in/a.png"]);
    expect(() => reviewInputSchema.parse({ rating: 4, photos: [1, 2, 3, 4, 5, 6].map(url) })).toThrow(ZodError);
    for (const bad of ["javascript:alert(1)", "ftp://x.in/a.png", "data:image/png;base64,AAAA", "not a url", "/relative.jpg"]) {
      expect(() => reviewInputSchema.parse({ rating: 4, photos: [bad] }), bad).toThrow(ZodError);
    }
  });

  it("parses replies and queries", () => {
    expect(replyInputSchema.parse({ reply: " Thank you! " })).toEqual({ reply: "Thank you!" });
    expect(replyInputSchema.parse({ reply: "" })).toEqual({ reply: null });
    expect(publicReviewQuerySchema.parse({})).toEqual({ sort: "recent", photos: false, limit: 10, offset: 0 });
    expect(publicReviewQuerySchema.parse({ sort: "helpful", rating: "5", limit: "20" })).toEqual({ sort: "helpful", rating: 5, photos: false, limit: 20, offset: 0 });
    expect(publicReviewQuerySchema.parse({ photos: "true" }).photos).toBe(true);
    expect(staffReviewQuerySchema.parse({ source: "imported,in_store" }).source).toEqual(["imported", "in_store"]);
    expect(() => publicReviewQuerySchema.parse({ sort: "random" })).toThrow(ZodError);
    expect(() => publicReviewQuerySchema.parse({ rating: "6" })).toThrow(ZodError);
    expect(staffReviewQuerySchema.parse({ status: "pending", productId: A })).toMatchObject({ status: ["pending"], productId: A, limit: 50 });
    expect(() => staffReviewQuerySchema.parse({ status: "spam" })).toThrow(ZodError);
    expect(productIdsQuerySchema.parse({ productIds: `${A}, ${B}` }).productIds).toEqual([A, B]);
    expect(() => productIdsQuerySchema.parse({ productIds: "nope" })).toThrow(ZodError);
  });
});

describe("output", () => {
  it("public reviews hide the user, order and status", () => {
    const row: ReviewRow = {
      id: A,
      tenantId: B,
      productId: B,
      userId: A,
      authorName: "Priya S.",
      authorCity: null,
      source: "customer",
      sourcePlatform: null,
      sourceUrl: null,
      createdBy: null,
      orderId: B,
      rating: 5,
      title: null,
      body: "Lovely silk",
      photos: [],
      status: "approved",
      verified: true,
      helpfulCount: 2,
      reply: null,
      repliedAt: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    const review = toReview(row);
    expect(review).toMatchObject({ userId: A, orderId: B, status: "approved" });
    const pub = toPublicReview(review);
    expect(pub).not.toHaveProperty("userId");
    expect(pub).not.toHaveProperty("orderId");
    expect(pub).not.toHaveProperty("status");
    expect(pub).not.toHaveProperty("tenantId");
    expect(pub).not.toHaveProperty("createdBy");
    expect(pub).toMatchObject({ source: "customer", sourcePlatform: null, authorCity: null });
    expect(pub).toMatchObject({ authorName: "Priya S.", verified: true, helpfulCount: 2 });
  });
});
