import { describe, expect, it } from "vitest";
import {
  freshness,
  priceAffinity,
  rankBestsellers,
  rankForCart,
  rankForHome,
  rankSimilar,
  rankTogether,
  recommendationQuerySchema,
  similarityScore,
  trendScore,
  type RecCandidate,
} from "./recommend";

const NOW = new Date("2026-10-20T00:00:00Z");
const daysAgo = (d: number) => new Date(NOW.getTime() - d * 86_400_000);

/** sarees ⊂ women, kurtis ⊂ women; bags elsewhere. */
const PARENT: Record<string, string | null> = { sarees: "women", kurtis: "women", women: null, bags: null };
const parentOf = (id: string) => PARENT[id] ?? null;

const p = (id: string, x: Partial<RecCandidate> = {}): RecCandidate => ({ id, categoryId: "sarees", brand: null, tags: [], price: 100_000, createdAt: daysAgo(100), ...x });

describe("scoring parts", () => {
  it("price affinity is 1 at the same price and 0 at half / double", () => {
    expect(priceAffinity(1000, 1000)).toBe(1);
    expect(priceAffinity(1000, 2000)).toBe(0);
    expect(priceAffinity(1000, 500)).toBe(0);
    expect(priceAffinity(1000, 1300)).toBeGreaterThan(0.5);
    expect(priceAffinity(0, 1000)).toBe(0);
  });

  it("trend is log-scaled against the best seller; freshness fades over 60 days", () => {
    expect(trendScore(10, 10)).toBe(1);
    expect(trendScore(0, 10)).toBe(0);
    expect(trendScore(undefined, 0)).toBe(0);
    expect(trendScore(1, 100)).toBeGreaterThan(0.1);
    expect(freshness(NOW, NOW)).toBe(1);
    expect(freshness(daysAgo(30), NOW)).toBeCloseTo(0.5);
    expect(freshness(daysAgo(90), NOW)).toBe(0);
  });

  it("similarity: same category > sibling > none; collection, tags and brand add", () => {
    const a = p("a", { tags: ["silk", "wedding"], brand: "Nalli", collections: ["c1"] });
    const same = similarityScore(a, p("b"), { parentOf });
    const sibling = similarityScore(a, p("c", { categoryId: "kurtis" }), { parentOf });
    const other = similarityScore(a, p("d", { categoryId: "bags", price: 900_000 }), { parentOf });
    expect(same).toBeGreaterThan(sibling);
    expect(sibling).toBeGreaterThan(other);
    expect(other).toBe(0);
    const rich = similarityScore(a, p("e", { tags: ["Silk", "wedding", "x"], brand: "nalli", collections: ["c1"] }), { parentOf });
    expect(rich - same).toBeCloseTo(1.5 + 1 + 1);
  });
});

describe("you may also like", () => {
  const anchor = p("a");
  const pool = [
    anchor,
    p("same-cheap", { price: 50_000 }),
    p("same-close", { price: 110_000 }),
    p("sibling", { categoryId: "kurtis" }),
    p("bag", { categoryId: "bags" }),
    p("new-bag", { categoryId: "bags", createdAt: daysAgo(1) }),
  ];

  it("puts the closest products first and never the product itself", () => {
    const ids = rankSimilar(anchor, pool, {}, { parentOf, now: NOW, limit: 4 });
    expect(ids[0]).toBe("same-close");
    expect(ids.slice(0, 3)).toEqual(["same-close", "same-cheap", "sibling"]);
    expect(ids).not.toContain("a");
    // Topped up with the newest unrelated product.
    expect(ids[3]).toBe("new-bag");
  });

  it("a best seller in the same category climbs above an equally similar one", () => {
    const ids = rankSimilar(anchor, [anchor, p("x", { price: 120_000 }), p("y", { price: 120_000 })], { sales: new Map([["y", 9]]) }, { parentOf, now: NOW, limit: 2 });
    expect(ids).toEqual(["y", "x"]);
  });

  it("respects skip (the bought-together items) and the limit", () => {
    expect(rankSimilar(anchor, pool, {}, { parentOf, now: NOW, limit: 2, skip: new Set(["same-close"]) })).toEqual(["same-cheap", "sibling"]);
  });
});

describe("bought together and cart", () => {
  it("ranks co-purchases by order count, without the anchors", () => {
    const together = new Map([["x", 2], ["y", 5], ["a", 9], ["z", 0]]);
    expect(rankTogether(together, new Set(["a"]), 5)).toEqual(["y", "x"]);
    expect(rankTogether(undefined, new Set(), 5)).toEqual([]);
    // Only products still in the store.
    expect(rankTogether(together, new Set(["a"]), 5, new Set(["x"]))).toEqual(["x"]);
  });

  it("cart: co-purchases first, then like the cart's items, never the cart's own", () => {
    const cart = [p("a"), p("b", { categoryId: "bags", price: 20_000 })];
    const pool = [...cart, p("bag2", { categoryId: "bags", price: 25_000 }), p("saree2"), p("blouse", { categoryId: "kurtis", price: 5_000 }), p("other", { categoryId: null, price: 1 })];
    const ids = rankForCart(cart, pool, { together: new Map([["blouse", 3], ["a", 4]]) }, { parentOf, now: NOW, limit: 4 });
    expect(ids[0]).toBe("blouse");
    expect(ids).toEqual(expect.arrayContaining(["bag2", "saree2"]));
    expect(ids).not.toContain("a");
    expect(ids).not.toContain("b");
    expect(ids).toHaveLength(4);
  });
});

describe("home and best sellers", () => {
  const pool = [
    p("old-saree", { createdAt: daysAgo(200) }),
    p("hit-bag", { categoryId: "bags", createdAt: daysAgo(200) }),
    p("new-kurti", { categoryId: "kurtis", createdAt: daysAgo(2) }),
    p("women-top", { categoryId: "women", createdAt: daysAgo(200) }),
  ];

  it("a new shop (no orders, no history) gets its newest products", () => {
    expect(rankForHome(pool, {}, [], { parentOf, now: NOW, limit: 2 })[0]).toBe("new-kurti");
  });

  it("trending wins without history; viewed categories pull their products up", () => {
    const sales = new Map([["hit-bag", 20]]);
    expect(rankForHome(pool, { sales }, [], { parentOf, now: NOW, limit: 1 })).toEqual(["hit-bag"]);
    const viewed = rankForHome(pool, { sales }, ["sarees"], { parentOf, now: NOW, limit: 4 });
    expect(viewed[0]).toBe("old-saree");
    // The viewed category's parent counts half.
    expect(viewed.indexOf("women-top")).toBeLessThan(viewed.indexOf("new-kurti") + 2);
  });

  it("best sellers by sales, topped up with the newest", () => {
    expect(rankBestsellers(pool, { sales: new Map([["old-saree", 3], ["hit-bag", 7]]) }, { limit: 3, now: NOW })).toEqual(["hit-bag", "old-saree", "new-kurti"]);
    expect(rankBestsellers(pool, {}, { limit: 1, now: NOW })).toEqual(["new-kurti"]);
  });
});

describe("query", () => {
  it("parses comma lists, dedupes and caps", () => {
    const id = "0b6f5f36-0000-4000-8000-000000000001";
    expect(recommendationQuerySchema.parse({ kind: "cart", productIds: `${id},${id}`, limit: "4" })).toMatchObject({ kind: "cart", productIds: [id], categoryIds: [], limit: 4 });
    expect(recommendationQuerySchema.parse({})).toMatchObject({ kind: "home", limit: 8 });
    expect(recommendationQuerySchema.safeParse({ kind: "magic" }).success).toBe(false);
    expect(recommendationQuerySchema.safeParse({ productIds: "nope" }).success).toBe(false);
    expect(recommendationQuerySchema.safeParse({ limit: 99 }).success).toBe(false);
  });
});
