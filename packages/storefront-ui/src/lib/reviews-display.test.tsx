import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { ReviewSource } from "../components/review-source";
import { ReviewsSummarySection } from "../pages/home-shelves";
import type { HomeSectionOf, Review, ShopReviewSummary } from "../types";
import { en, ta, translatorFor } from "./messages";
import { reviewsEn, reviewsTa } from "./messages-reviews";

vi.mock("../client/carousel", async (orig) => ({
  ...(await orig<typeof import("../client/carousel")>()),
  Carousel: ({ children }: { children: React.ReactNode }) => <ul>{children}</ul>,
}));

const t = translatorFor("en");
const html = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>);
const review = (patch: Partial<Review>): Review => ({
  id: "r1",
  productId: "p1",
  authorName: "Meena K.",
  rating: 5,
  title: "Lovely",
  body: "Soft cotton, colour as shown",
  photos: [],
  verified: false,
  helpfulCount: 0,
  reply: null,
  repliedAt: null,
  createdAt: "2026-10-01T00:00:00Z",
  ...patch,
});

describe("review source labels", () => {
  it("say where staff-entered reviews came from, and nothing for shopper reviews", () => {
    expect(html(<ReviewSource review={review({ source: "customer" })} t={t} />)).toBe("");
    expect(html(<ReviewSource review={review({})} t={t} />)).toBe("");
    expect(html(<ReviewSource review={review({ source: "in_store" })} t={t} />)).toContain("Shared in store");
    expect(html(<ReviewSource review={review({ source: "invited" })} t={t} />)).toContain("Sent on the shop&#x27;s request");
    const google = html(<ReviewSource review={review({ source: "imported", sourcePlatform: "google", sourceUrl: "https://g.page/r/abc" })} t={t} />);
    expect(google).toContain("From Google");
    expect(google).toContain('href="https://g.page/r/abc"');
    expect(google).toContain('rel="nofollow noopener noreferrer"');
    // A non-web link is never rendered as a link.
    expect(html(<ReviewSource review={review({ source: "imported", sourcePlatform: "amazon", sourceUrl: "javascript:alert(1)" })} t={t} />)).not.toContain("href");
    expect(html(<ReviewSource review={review({ source: "imported", sourcePlatform: null })} t={t} />)).toContain("From another site");
    expect(html(<ReviewSource review={review({ source: "in_store" })} t={translatorFor("ta")} />)).toContain("கடையில் பகிரப்பட்டது");
  });

  it("strings exist in English and Tamil", () => {
    expect(Object.keys(reviewsTa).sort()).toEqual(Object.keys(reviewsEn).sort());
    for (const k of Object.keys(reviewsEn)) {
      expect(en[k], k).toBeDefined();
      expect(ta[k], k).toBeDefined();
    }
  });
});

describe("home reviews summary with staff-entered reviews", () => {
  it("shows the source, the town and photos; verified only for real purchases", () => {
    const s: HomeSectionOf<"reviews-summary"> = { type: "reviews-summary", limit: 6 };
    const summary: ShopReviewSummary = {
      average: 4.5,
      count: 2,
      distribution: { "5": 1, "4": 1 },
      items: [
        review({ id: "a", source: "in_store", authorCity: "Madurai", photos: ["https://x.test/1.jpg"] }),
        review({ id: "b", source: "imported", sourcePlatform: "google", rating: 4 }),
        review({ id: "c", source: "customer", verified: true, orderId: undefined } as Partial<Review>),
      ],
    };
    const out = html(<ReviewsSummarySection s={s} t={t} data={{ summary, products: new Map() }} locale="en" />);
    expect(out).toContain("Meena K., Madurai");
    expect(out).toContain("Shared in store");
    expect(out).toContain("From Google");
    expect(out).toContain('src="https://x.test/1.jpg"');
    expect(out.match(/Verified buyer/g)).toHaveLength(1);
  });
});
