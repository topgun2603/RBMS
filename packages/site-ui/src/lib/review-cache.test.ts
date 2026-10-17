import { describe, expect, it } from "vitest";
import { patchReviewList } from "./review-cache";
import type { Review } from "./types";

const review = (id: string, patch: Partial<Review> = {}): Review => ({
  id,
  productId: "p",
  userId: "u",
  authorName: "Priya S.",
  orderId: null,
  rating: 5,
  title: null,
  body: null,
  photos: [],
  status: "pending",
  verified: false,
  helpfulCount: 0,
  reply: null,
  repliedAt: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
  ...patch,
});

describe("patchReviewList", () => {
  it("patches the table's plain { items } page", () => {
    const page = { items: [review("a"), review("b")], total: 2, limit: 25, offset: 0, facets: { status: { pending: 2 } } };
    const next = patchReviewList(page, "b", { status: "approved" });
    expect(next.items.map((r) => r.status)).toEqual(["pending", "approved"]);
    expect(next).toMatchObject({ total: 2, limit: 25, facets: { status: { pending: 2 } } });
    expect(page.items[1]!.status).toBe("pending");
  });

  it("patches older infinite { pages } caches", () => {
    const inf = { pages: [{ items: [review("a")], total: 2 }, { items: [review("b")], total: 2 }], pageParams: [0, 1] };
    const next = patchReviewList(inf, "b", { status: "rejected" });
    expect(next.pages[1]!.items[0]!.status).toBe("rejected");
    expect(next.pages[0]).toBe(inf.pages[0]);
    expect(next.pageParams).toEqual([0, 1]);
  });

  it("removes a deleted review and lowers the total", () => {
    expect(patchReviewList({ items: [review("a"), review("b")], total: 7 }, "a", null)).toEqual({ items: [review("b")], total: 6 });
  });

  it("leaves other caches and unrelated lists alone", () => {
    const counts = { pending: 1, approved: 2 };
    expect(patchReviewList(counts, "a", { status: "approved" })).toBe(counts);
    const page = { items: [review("x")], total: 1 };
    expect(patchReviewList(page, "a", { status: "approved" })).toBe(page);
    expect(patchReviewList(undefined, "a", null)).toBeUndefined();
  });
});
