import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { gridClass, listClass } from "../lib/grid";
import { en, ta, translatorFor } from "../lib/messages";
import { shelvesEn, shelvesTa } from "../lib/messages-shelves";
import { isProxyAllowed } from "../server/proxy";
import { themeView } from "../server/api";
import type { HomeSectionOf, ProductSummary, ShopReviewSummary } from "../types";
import { CATEGORY_ICONS, categoryIconKey } from "../components/category-art";
import { bentoSpan, gridFit } from "./home-categories";
import { CategoriesSectionView, PricingSection, ReviewsSummarySection, TeamSection, TimelineSection } from "./home-shelves";
import { offerEnded } from "./home-sections";
import { ListingHeader, listingViewOf, moreQuery } from "./listing";

// The rail is a client component that needs the store context; a plain list is enough for markup checks.
vi.mock("../client/carousel", async (orig) => ({
  ...(await orig<typeof import("../client/carousel")>()),
  Carousel: ({ children, className }: { children: React.ReactNode; className?: string }) => <ul className={className}>{children}</ul>,
}));

const t = translatorFor("en");
const html = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>);
const product = (id: string, name = "Silk saree"): ProductSummary => ({
  id,
  name,
  slug: name.toLowerCase().replace(/\s+/g, "-"),
  categoryId: null,
  categoryName: null,
  image: null,
  priceMin: 49900,
  priceMax: 49900,
  mrp: null,
  variantCount: 1,
  taxInclusive: true,
});

describe("listing options", () => {
  it("defaults keep today's listing (sidebar, 4 columns, grid, numbered pages, simple header, no chips, no compare)", () => {
    expect(themeView({})).toMatchObject({ listingFilters: "sidebar", listingColumns: "4", listingView: "grid", listingPaging: "pages", categoryHeader: "simple", subcategories: "off", compare: "off" });
    // The sidebar grid with the default 4 columns is the same as before.
    expect(gridClass("sidebar", "4")).toBe("grid-cols-2 gap-x-3 gap-y-8 sm:gap-x-5 md:grid-cols-3 xl:grid-cols-4");
    expect(gridClass("sidebar")).toBe(gridClass("sidebar", "4"));
  });

  it("columns 2–5 and list rows map to fixed class names", () => {
    expect(gridClass("full", "5")).toContain("xl:grid-cols-5");
    expect(gridClass("full", "3")).toContain("md:grid-cols-3");
    expect(gridClass("full", "3")).not.toContain("lg:grid-cols-4");
    expect(gridClass("sidebar", "2")).not.toContain("md:grid-cols-3");
    expect(listClass("full")).toContain("lg:grid-cols-2");
  });

  it("the view comes from the shopper's toggle, else the theme", () => {
    expect(listingViewOf({}, { listingView: "list" })).toBe("list");
    expect(listingViewOf({ view: "grid" }, { listingView: "list" })).toBe("grid");
    expect(listingViewOf({ view: "cards" }, { listingView: "grid" })).toBe("grid");
  });

  it("later pages reuse the search query without limit / offset", () => {
    const qs = moreQuery({ q: "silk", sort: "new", page: "2", "opt.Size": ["S", "M"], stock: "1" }, { categoryId: "c1" });
    const p = new URLSearchParams(qs);
    expect(p.get("q")).toBe("silk");
    expect(p.get("categoryId")).toBe("c1");
    expect(p.getAll("opt.Size")).toEqual(["S", "M"]);
    expect(p.get("inStock")).toBe("1");
    expect(p.has("limit") || p.has("offset")).toBe(false);
  });

  it("category header: simple, a banner with the picture, or just a screen-reader name", () => {
    const simple = html(<ListingHeader title="Sarees" description="Silk and cotton" style="simple" image={null} count={4} t={t} />);
    expect(simple).toContain('data-category-header="simple"');
    expect(simple).toContain("<h1");
    const banner = html(<ListingHeader title="Sarees" style="banner" image="https://cdn.example.in/sarees.jpg" count={4} t={t} />);
    expect(banner).toContain('data-category-header="banner"');
    expect(banner).toContain('src="https://cdn.example.in/sarees.jpg"');
    expect(banner).toContain("4 products");
    expect(html(<ListingHeader title="Sarees" style="banner" image={null} count={1} t={t} />)).toContain("sf-brand-hero");
    expect(html(<ListingHeader title="Sarees" style="none" image={null} count={1} t={t} />)).toBe('<h1 class="sr-only">Sarees</h1>');
  });

  it("the store proxy lets the new public reads through", () => {
    for (const p of ["/v1/catalog/public/recommendations", "/v1/catalog/public/compare", "/v1/catalog/public/lookup", "/v1/reviews/public/summary"]) expect(isProxyAllowed(p), p).toBe(true);
  });
});

describe("category tile layouts", () => {
  const s = (layout: HomeSectionOf<"categories">["layout"], showCounts = false): HomeSectionOf<"categories"> => ({
    type: "categories",
    title: "Shop by category",
    layout,
    showCounts,
    categories: [
      { id: "c1", name: "Sarees", slug: "sarees", image: null },
      { id: "c2", name: "Kurtis", slug: "kurtis", image: null },
    ],
  });
  const counts = new Map([["c1", 12]]);

  it("renders each layout with its links, counts only when asked", () => {
    for (const layout of ["cards", "big-grid", "icon-list"] as const) {
      const out = html(<CategoriesSectionView s={s(layout, true)} t={t} counts={counts} />);
      expect(out, layout).toContain(`data-layout="${layout}"`);
      expect(out, layout).toContain('href="/c/sarees"');
      expect(out, layout).toContain("12 products");
    }
    expect(html(<CategoriesSectionView s={s("cards")} t={t} counts={counts} />)).not.toContain("12 products");
  });

  it("renders every layout (old and new) with links, counts and the icon fallback for photo-less categories", () => {
    const all = ["circles", "cards", "slider", "icon-list", "big-grid", "rounded-squares", "story-rings", "pills", "tiles", "banner-row", "bento", "minimal-list"] as const;
    for (const layout of all) {
      const out = html(<CategoriesSectionView s={s(layout, true)} t={t} counts={counts} />);
      expect(out, layout).toContain(`data-layout="${layout}"`);
      expect(out, layout).toContain('href="/c/sarees"');
      expect(out, layout).toContain('href="/c/kurtis"');
      // pills show the bare number (the full text is the tooltip); everything else prints "12 products".
      expect(out, layout).toContain(layout === "pills" ? 'title="12 products"' : "12 products");
      if (layout !== "minimal-list") {
        expect(out, layout).toContain('data-cat-icon="saree"');
        expect(out, layout).toContain('data-cat-icon="shirt"');
        expect(out, layout).not.toContain(">SA<");
      }
    }
  });

  it("rotates the brand tint per tile and keeps real photos", () => {
    const sec = s("circles");
    sec.categories = [...sec.categories, { id: "c3", name: "Footwear", slug: "footwear", image: "https://cdn.example.com/f.jpg" }];
    const out = html(<CategoriesSectionView s={sec} t={t} />);
    expect(out).toContain('data-tone="0"');
    expect(out).toContain('data-tone="1"');
    expect(out).toContain('src="https://cdn.example.com/f.jpg"');
    expect(out).not.toContain('data-cat-icon="footwear"');
  });

  it("centres short rows unless the section is aligned to the start", () => {
    expect(html(<CategoriesSectionView s={s("circles")} t={t} />)).toContain("sm:justify-center");
    expect(html(<CategoriesSectionView s={{ ...s("circles"), style: { align: "start" } }} t={t} />)).not.toContain("sm:justify-center");
  });

  it("grids shrink to the number of tiles and respect columns", () => {
    expect(gridFit(2, { sm: 3, lg: 6 }, "auto", 220)).toMatchObject({ sm: 2, lg: 2 });
    expect(gridFit(2, { sm: 3, lg: 6 }, "auto", 220).style).toHaveProperty("maxWidth");
    expect(gridFit(12, { sm: 3, lg: 6 }, "4", 220)).toMatchObject({ sm: 3, lg: 4 });
    expect(gridFit(12, { sm: 3, lg: 6 }, "4", 220).style).not.toHaveProperty("maxWidth");
    expect(gridFit(12, { sm: 2, lg: 3 }, undefined, 440)).toMatchObject({ sm: 2, lg: 3 });
    const out = html(<CategoriesSectionView s={{ ...s("tiles"), columns: "5" }} t={t} />);
    expect(out).toContain("--c-lg:2");
  });
});

describe("bento spans", () => {
  // Cells covered on a 4-column grid: never a hole at the end.
  const md = (cls: string) => (/md:col-span-(\d)/.exec(cls)?.[1] ? Number(/md:col-span-(\d)/.exec(cls)![1]) : /col-span-(\d)/.exec(cls) ? Number(/col-span-(\d)/.exec(cls)![1]) : 1);
  const rows = (cls: string) => (/md:row-span-(\d)/.exec(cls) ? Number(/md:row-span-(\d)/.exec(cls)![1]) : /row-span-(\d)/.exec(cls) ? Number(/row-span-(\d)/.exec(cls)![1]) : 1);
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])("%i tiles fill whole rows", (n) => {
    const cells = Array.from({ length: n }, (_, i) => bentoSpan(i, n)).reduce((sum, c) => sum + md(c) * rows(c), 0);
    expect(cells % 4).toBe(0);
  });
});

describe("category icon fallback", () => {
  it.each([
    ["Sarees", "sarees", "saree"],
    ["Kurtis", "kurtis", "shirt"],
    ["Bottoms", "bottoms", "bottoms"],
    ["Women", "women", "dress"],
    ["Men", "men", "shirt"],
    ["Kids wear", "kids", "kids"],
    ["Footwear", "footwear", "footwear"],
    ["Handbags", "bags", "bag"],
    ["Mobiles", "mobiles", "phone"],
    ["Laptops", "laptops", "laptop"],
    ["TVs", "tvs", "tv"],
    ["Audio", "audio", "audio"],
    ["Home appliances", "appliances", "fridge"],
    ["Chargers & cables", "chargers", "charger"],
    ["Mobile accessories", "mobile-accessories", "phone"],
    ["Fashion accessories", "accessories", "watch"],
    ["Medicines", "medicines", "medicine"],
    ["Wellness", "wellness", "wellness"],
    ["Baby care", "baby-care", "baby"],
    ["Personal care", "personal-care", "personal"],
    ["Health devices", "devices", "device"],
    ["Starters", "starters", "starter"],
    ["Main course", "main-course", "main"],
    ["Biryani", "biryani", "rice"],
    ["Breads", "breads", "bread"],
    ["Desserts", "desserts", "dessert"],
    ["Beverages", "beverages", "drink"],
    ["Snacks", "snacks", "snack"],
    ["Vegetables", "vegetables", "vegetable"],
    ["Fruits", "fruits", "fruit"],
    ["Dairy", "dairy", "dairy"],
    ["Staples", "staples", "staples"],
    ["Spices", "spices", "spice"],
    ["Meat", "meat", "meat"],
    ["Fish", "fish", "fish"],
    ["Bakery", "bakery", "bread"],
    ["Cakes", "cakes", "cake"],
    ["Rings", "rings", "ring"],
    ["Necklaces", "necklaces", "necklace"],
    ["Bangles", "bangles", "bangle"],
    ["Earrings", "earrings", "earring"],
    ["Chains", "chains", "chain"],
    ["Silver", "silver", "jewel"],
    ["Hair", "hair", "hair"],
    ["Skin", "skin", "skin"],
    ["Spa", "spa", "spa"],
    ["Bridal", "bridal", "bridal"],
    ["Nails", "nails", "nails"],
    ["Gym", "gym", "gym"],
    ["Memberships", "memberships", "membership"],
    ["Supplements", "supplements", "supplement"],
    ["Tools", "tools", "tools"],
    ["Paint", "paint", "paint"],
    ["Plumbing", "plumbing", "plumbing"],
    ["Electrical", "electrical", "electrical"],
    ["Cement", "cement", "cement"],
    ["Frames", "frames", "frames"],
    ["Lenses", "lenses", "lenses"],
    ["Sunglasses", "sunglasses", "sunglasses"],
    ["Tailoring", "tailoring", "tailoring"],
    ["Blouses", "blouses", "blouse"],
    ["Alterations", "alterations", "alteration"],
    ["Non-veg starters", "non-veg-starters", "starter"],
    ["Eye drops", "eye-drops", "tag"],
    ["Something else", "misc", "tag"],
  ])("%s → %s", (name, slug, key) => {
    expect(categoryIconKey(name, slug)).toBe(key);
  });

  it("every key has an icon", () => {
    for (const k of ["saree", "ring", "tag"] as const) expect(CATEGORY_ICONS[k]).toBeTruthy();
  });
});

describe("story and proof sections", () => {
  it("timeline lists milestones in order", () => {
    const out = html(<TimelineSection s={{ type: "timeline", items: [{ when: "1985", title: "First shop", text: "Madurai" }, { when: "2024", title: "Online", text: "" }] }} t={t} />);
    expect(out.indexOf("1985")).toBeLessThan(out.indexOf("2024"));
    expect(out).toContain("<ol");
    expect(out).toContain("Our story");
  });

  it("team shows roles and only safe social links, labelled", () => {
    const out = html(<TeamSection s={{ type: "team", members: [{ name: "Divya", role: "Stylist", instagram: "https://instagram.com/divya", website: "javascript:alert(1)" }] }} t={t} />);
    expect(out).toContain("Stylist");
    expect(out).toContain('href="https://instagram.com/divya"');
    expect(out).toContain('aria-label="Divya on Instagram"');
    expect(out).not.toContain("javascript:");
  });

  it("pricing highlights one plan, prices in rupees, 'Ask us' without a price", () => {
    const out = html(
      <PricingSection
        s={{ type: "pricing-table", plans: [{ name: "Monthly", price: 150000, period: "/ month", features: ["Locker"], highlight: true, cta: { label: "Join", href: "/book" } }, { name: "Custom", features: [], highlight: false }] }}
        t={t}
      />,
    );
    expect(out).toContain("₹1,500");
    expect(out).toContain("/ month");
    expect(out).toContain("Most popular");
    expect(out).toContain("Ask us");
    expect(out.match(/data-highlight="true"/g)).toHaveLength(1);
  });

  it("reviews summary: nothing without reviews; average, distribution and linked products otherwise", () => {
    const s: HomeSectionOf<"reviews-summary"> = { type: "reviews-summary", limit: 6 };
    expect(html(<ReviewsSummarySection s={s} t={t} data={undefined} locale="en" />)).toBe("");
    const summary: ShopReviewSummary = {
      average: 4.5,
      count: 2,
      distribution: { "5": 1, "4": 1, "3": 0, "2": 0, "1": 0 },
      items: [{ id: "r1", productId: "p1", authorName: "Meena", rating: 5, title: "Lovely", body: "Great silk", photos: [], verified: true, helpfulCount: 0, reply: null, repliedAt: null, createdAt: "2026-10-01T00:00:00Z" }],
    };
    const out = html(<ReviewsSummarySection s={s} t={t} data={{ summary, products: new Map([["p1", product("p1")]]) }} locale="en" />);
    expect(out).toContain("4.5");
    expect(out).toContain("Based on 2 reviews");
    expect(out).toContain("Verified buyer");
    expect(out).toContain('href="/p/silk-saree"');
  });

  it("a deal past its end is dropped like an offer", () => {
    const deal = { type: "deal" as const, endsAt: "2026-10-01T00:00:00Z", product: product("p1") };
    expect(offerEnded(deal, Date.parse("2026-10-02T00:00:00Z"))).toBe(true);
    expect(offerEnded({ ...deal, endsAt: undefined }, Date.now())).toBe(false);
  });
});

describe("messages", () => {
  it("compare, recommendations, listing and section strings exist in English and Tamil", () => {
    expect(Object.keys(shelvesTa).sort()).toEqual(Object.keys(shelvesEn).sort());
    for (const k of Object.keys(shelvesEn)) {
      expect(en[k], k).toBeDefined();
      expect(ta[k], k).toBeDefined();
    }
  });
});
