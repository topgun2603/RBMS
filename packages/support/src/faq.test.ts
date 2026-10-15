import { describe, expect, it } from "vitest";
import { ZodError } from "zod";
import {
  excerptOf,
  faqArticleInputSchema,
  groupFaq,
  rankArticles,
  scoreArticle,
  slugify,
  slugProblem,
  stripHtml,
  tokenize,
  uniqueSlug,
  type FaqArticle,
} from "./faq";

const article = (id: string, title: string, body: string, patch: Partial<FaqArticle> = {}): FaqArticle => ({
  id,
  categoryId: null,
  slug: id,
  title,
  body,
  status: "published",
  helpfulYes: 0,
  helpfulNo: 0,
  sort: 0,
  seo: null,
  publishedAt: null,
  createdAt: new Date(0),
  updatedAt: new Date(0),
  ...patch,
});

describe("markdown and slugs", () => {
  it("strips raw HTML like cms", () => {
    expect(stripHtml("Hi <img src=x onerror=alert(1)> <!-- c -->**there**</p>")).toBe("Hi  **there**");
    expect(stripHtml("2 < 3 and 5 > 4")).toBe("2 < 3 and 5 > 4");
    expect(faqArticleInputSchema.parse({ title: "Returns", body: "<iframe src=x></iframe>Within 7 days" }).body).toBe("Within 7 days");
    expect(() => faqArticleInputSchema.parse({ title: "Re" })).toThrow(ZodError);
  });

  it("slugify / uniqueSlug / slugProblem", () => {
    expect(slugify("Refunds & Returns!")).toBe("refunds-and-returns");
    expect(slugify("What's COD?")).toBe("whats-cod");
    expect(slugify("பணம் திரும்ப", "faq", () => "abc123")).toBe("faq-abc123");
    expect(uniqueSlug("returns", new Set(["returns", "returns-2"]))).toBe("returns-3");
    expect(uniqueSlug("search", new Set())).toBe("search-2");
    expect(slugProblem("search", new Set())).toBe("reserved");
    expect(slugProblem("Bad Slug", new Set())).toBe("invalid");
    expect(slugProblem("returns", new Set(["returns"]))).toBe("taken");
    expect(slugProblem("returns", new Set())).toBeNull();
  });

  it("excerpts are plain text", () => {
    expect(excerptOf("# Title\n\nSee [our policy](/p/policy) **now**.")).toBe("Title See our policy now.");
    expect(excerptOf("x".repeat(300)).length).toBe(160);
  });
});

describe("search ranking", () => {
  const refund = article("refund", "How do I get a refund?", "Refunds go back to the original payment method within 5–7 days.");
  const returns = article("returns", "Return policy", "You can return items within 7 days. Once we receive the return, we issue a refund.");
  const shipping = article("shipping", "Shipping charges", "Free delivery above ₹499. Cash on delivery available.");
  const cod = article("cod", "Cash on delivery (COD)", "Pay cash when the parcel arrives. COD is available in Tamil Nadu.");
  const tamil = article("tamil", "பணம் திரும்ப பெறுவது எப்படி", "ரீஃபண்ட் 7 நாட்களில் வரும்.");
  const all = [shipping, returns, refund, cod, tamil];

  it("tokenizes any script and drops stop words", () => {
    expect(tokenize("How do I get a REFUND?")).toEqual(["get", "refund"]);
    expect(tokenize("பணம் திரும்ப")).toEqual(["பணம்", "திரும்ப"]);
  });

  it("title matches beat body matches", () => {
    const ranked = rankArticles("refund", all).map((r) => r.article.id);
    expect(ranked).toEqual(["refund", "returns"]);
    expect(scoreArticle("refund", refund)).toBeGreaterThan(scoreArticle("refund", returns));
  });

  it("shared stems match (refunds ~ refund) but short prefixes don't", () => {
    expect(scoreArticle("refunds", refund)).toBeGreaterThan(0);
    expect(scoreArticle("ref", refund)).toBe(0);
  });

  it("all terms and the title phrase add bonuses", () => {
    const ranked = rankArticles("cash on delivery", all);
    expect(ranked[0]?.article.id).toBe("cod");
    expect(ranked.map((r) => r.article.id)).toContain("shipping");
    expect(ranked[0]!.score).toBeGreaterThan(ranked[1]!.score);
  });

  it("finds Tamil articles", () => {
    expect(rankArticles("பணம்", all).map((r) => r.article.id)).toEqual(["tamil"]);
  });

  it("no match, empty or stop-word-only queries return nothing", () => {
    expect(rankArticles("warranty", all)).toEqual([]);
    expect(rankArticles("", all)).toEqual([]);
    expect(rankArticles("how do i", all)).toEqual([]);
  });

  it("ties break on helpful votes, then sort, then title; limit applies", () => {
    const a = article("a", "Delivery time", "x", { helpfulYes: 1 });
    const b = article("b", "Delivery time", "x", { helpfulYes: 5, helpfulNo: 1 });
    const c = article("c", "Delivery time", "x", { sort: 1 });
    expect(rankArticles("delivery", [a, c, b]).map((r) => r.article.id)).toEqual(["b", "a", "c"]);
    expect(rankArticles("delivery", [a, b, c], 1)).toHaveLength(1);
  });
});

describe("groupFaq", () => {
  it("orders categories, drops empty ones and puts loose articles last", () => {
    const cats = [
      { id: "c2", name: "Payments", slug: "payments", description: null, sort: 2 },
      { id: "c1", name: "Orders", slug: "orders", description: null, sort: 1 },
      { id: "c3", name: "Empty", slug: "empty", description: null, sort: 0 },
    ];
    const groups = groupFaq(cats, [
      article("p", "UPI", "Pay by UPI", { categoryId: "c2" }),
      article("o2", "Cancel", "x", { categoryId: "c1", sort: 2 }),
      article("o1", "Track", "x", { categoryId: "c1", sort: 1 }),
      article("l", "Loose", "x", { categoryId: "gone" }),
    ]);
    expect(groups.map((g) => g.category?.id ?? null)).toEqual(["c1", "c2", null]);
    expect(groups[0]!.articles.map((a) => a.id)).toEqual(["o1", "o2"]);
    expect(groups[0]!.articles[0]).not.toHaveProperty("body");
  });
});
