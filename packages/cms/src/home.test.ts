import { describe, expect, it, vi } from "vitest";
import { homeDocSchema, homeSectionSchema, HOME_SECTION_TYPES } from "./content";
import type { CatalogPort, PublicProductSummary } from "./ports";
import { publicHome, resolveSections } from "./resolve";
import { CmsService } from "./service";

const T = "11111111-1111-4111-8111-111111111111";
const P1 = "a1111111-1111-4111-8111-111111111111";

const product: PublicProductSummary = {
  id: P1,
  name: "Silk saree",
  slug: "silk-saree",
  categoryId: null,
  categoryName: null,
  image: null,
  priceMin: 49900,
  priceMax: 49900,
  mrp: null,
  variantCount: 1,
  taxInclusive: true,
};
const catalog: CatalogPort = {
  categories: vi.fn(async () => [{ id: "c1", name: "Sarees", slug: "sarees", image: null }]),
  collection: vi.fn(async (_t: string, slug: string) => ({ name: "New", slug, products: [product] })),
  productsByIds: vi.fn(async () => [product]),
  newest: vi.fn(async () => [product]),
};
const shop = { info: async () => ({ name: "Anbu Fashions", tagline: null }) };

/** One valid section of every type. */
const sample: Record<(typeof HOME_SECTION_TYPES)[number], Record<string, unknown>> = {
  hero: { type: "hero", slides: [{ imageUrl: null, heading: "Festive" }] },
  categories: { type: "categories", title: "Shop" },
  collection: { type: "collection", collectionSlug: "new" },
  products: { type: "products", productIds: [P1] },
  banner: { type: "banner", imageUrl: "/b.jpg" },
  text: { type: "text", markdown: "Hi" },
  "image-text": { type: "image-text", imageUrl: "/a.jpg", heading: "H" },
  testimonials: { type: "testimonials", items: [{ quote: "Lovely", name: "Meena" }] },
  usp: { type: "usp", items: [{ icon: "truck", title: "Free shipping" }] },
  newsletter: { type: "newsletter", heading: "Join" },
  "hero-split": { type: "hero-split", heading: "Bridal gold" },
  "hero-video": { type: "hero-video", videoUrl: "/v.mp4", heading: "Train hard" },
  offer: { type: "offer", heading: "Diwali sale", code: "diwali20", endsAt: "2026-11-01T18:30:00.000Z" },
  gallery: { type: "gallery", images: [{ url: "/g1.jpg" }] },
  logos: { type: "logos", items: [{ imageUrl: "/l.png", name: "Tanishq" }] },
  "category-mosaic": { type: "category-mosaic", title: "Shop" },
  faq: { type: "faq", items: [{ q: "COD?", a: "Yes" }] },
  location: { type: "location", address: "12 West Masi St, Madurai", coords: "9.9252, 78.1198" },
  "menu-board": { type: "menu-board", groups: [{ name: "Tiffin", items: [{ name: "Idli", price: 4000, diet: "veg" }] }] },
  appointment: { type: "appointment", heading: "Book a slot" },
  "before-after": { type: "before-after", beforeUrl: "/b.jpg", afterUrl: "/a.jpg" },
  "gold-rates": { type: "gold-rates" },
  instagram: { type: "instagram", handle: "@lakshmi.jewels", images: [{ url: "/i.jpg" }] },
  "product-tabs": { type: "product-tabs", tabs: [{ source: "new" }, { source: "collection", collectionSlug: "festive" }] },
  deal: { type: "deal", productId: P1, endsAt: "2026-11-01T18:30:00.000Z" },
  "shop-the-look": { type: "shop-the-look", imageUrl: "/look.jpg", hotspots: [{ x: 30, y: 40.5, productId: P1 }] },
  bestsellers: { type: "bestsellers" },
  "recently-viewed": { type: "recently-viewed" },
  recommended: { type: "recommended", title: "For you" },
  stats: { type: "stats", items: [{ value: 25, suffix: "+", label: "Years" }] },
  timeline: { type: "timeline", items: [{ when: "1985", title: "First shop" }] },
  team: { type: "team", members: [{ name: "Divya", role: "Senior stylist", instagram: "https://instagram.com/divya" }] },
  "pricing-table": { type: "pricing-table", plans: [{ name: "Monthly", price: 150000, period: "/ month", features: ["All machines"], highlight: true }, { name: "Trial" }] },
  "blog-posts": { type: "blog-posts", tag: "Care" },
  "reviews-summary": { type: "reviews-summary" },
};

describe("new section types", () => {
  it("apply their defaults and normalise input", () => {
    expect(homeSectionSchema.parse(sample.offer)).toMatchObject({ code: "DIWALI20" });
    expect(homeSectionSchema.parse(sample.instagram)).toMatchObject({ handle: "lakshmi.jewels" });
    expect(homeSectionSchema.parse(sample["hero-split"])).toMatchObject({ imageUrl: null, imageSide: "right" });
    expect(homeSectionSchema.parse(sample["hero-video"])).toMatchObject({ overlay: 45 });
    expect(homeSectionSchema.parse(sample.gallery)).toMatchObject({ layout: "grid", images: [{ url: "/g1.jpg", alt: "" }] });
    expect(homeSectionSchema.parse(sample.location)).toMatchObject({ hours: [] });
    expect(homeSectionSchema.parse(sample["gold-rates"])).toMatchObject({ showSilver: true });
    expect(homeSectionSchema.parse(sample.testimonials)).toMatchObject({ layout: "carousel" });
  });

  it("reject bad values", () => {
    const bad = (s: Record<string, unknown>) => expect(homeSectionSchema.safeParse(s).success, JSON.stringify(s)).toBe(false);
    bad({ ...sample.offer, endsAt: "next friday" });
    bad({ ...sample.offer, code: "50% OFF" });
    bad({ ...sample.location, coords: "Madurai" });
    bad({ ...sample.location, coords: "99.1, 78.1" });
    bad({ ...sample.location, phone: "call me" });
    bad({ ...sample["menu-board"], groups: [{ name: "Tiffin", items: [{ name: "Idli", price: -1 }] }] });
    bad({ ...sample["menu-board"], groups: [{ name: "Tiffin", items: [{ name: "Idli", diet: "vegan" }] }] });
    bad({ ...sample.testimonials, items: [{ quote: "x", name: "y", rating: 6 }] });
    bad({ ...sample.instagram, handle: "not a handle!" });
    bad({ ...sample["hero-video"], videoUrl: "javascript:alert(1)" });
    bad({ ...sample["category-mosaic"], categoryIds: Array.from({ length: 8 }, () => P1) });
  });

  it("shelves, story and proof sections get their defaults", () => {
    expect(homeSectionSchema.parse(sample["product-tabs"])).toMatchObject({ title: "", layout: "grid", limit: 8, tabs: [{ source: "new" }, { source: "collection", collectionSlug: "festive" }] });
    expect(homeSectionSchema.parse(sample.bestsellers)).toMatchObject({ layout: "carousel", limit: 8 });
    expect(homeSectionSchema.parse(sample["shop-the-look"])).toMatchObject({ alt: "", hotspots: [{ x: 30, y: 40.5 }] });
    expect(homeSectionSchema.parse(sample.timeline)).toMatchObject({ items: [{ when: "1985", text: "" }] });
    expect(homeSectionSchema.parse(sample["pricing-table"])).toMatchObject({ plans: [{ highlight: true, features: ["All machines"] }, { highlight: false, features: [] }] });
    expect(homeSectionSchema.parse(sample["blog-posts"])).toMatchObject({ limit: 3, tag: "care" });
    expect(homeSectionSchema.parse(sample["reviews-summary"])).toMatchObject({ limit: 6 });
  });

  it("reject bad shelf, story and proof sections", () => {
    const bad = (s: Record<string, unknown>) => expect(homeSectionSchema.safeParse(s).success, JSON.stringify(s)).toBe(false);
    bad({ type: "product-tabs", tabs: [] });
    bad({ type: "product-tabs", tabs: [{ source: "collection" }] });
    bad({ type: "product-tabs", tabs: [{ source: "trending" }] });
    bad({ ...sample.bestsellers, limit: 25 });
    bad({ type: "deal", productId: "not-a-uuid" });
    bad({ ...sample.deal, endsAt: "tomorrow" });
    bad({ ...sample["shop-the-look"], hotspots: [{ x: 101, y: 10, productId: P1 }] });
    bad({ ...sample["shop-the-look"], hotspots: Array.from({ length: 9 }, () => ({ x: 1, y: 1, productId: P1 })) });
    bad({ type: "stats", items: [{ value: -1, label: "x" }] });
    bad({ type: "stats", items: Array.from({ length: 7 }, () => ({ value: 1, label: "x" })) });
    bad({ type: "team", members: [{ name: "A", instagram: "javascript:alert(1)" }] });
    bad({ type: "pricing-table", plans: [{ name: "A", highlight: true }, { name: "B", highlight: true }] });
    bad({ type: "pricing-table", plans: Array.from({ length: 5 }, (_, i) => ({ name: `P${i}` })) });
    bad({ type: "blog-posts", limit: 0 });
  });

  it("category, USP and newsletter layouts default to the original look (unknown values too)", () => {
    expect(homeSectionSchema.parse(sample.categories)).toMatchObject({ layout: "circles", showCounts: false });
    expect(homeSectionSchema.parse({ ...sample.categories, layout: "big-grid", showCounts: true })).toMatchObject({ layout: "big-grid", showCounts: true });
    expect(homeSectionSchema.parse({ ...sample.categories, layout: "hexagons" })).toMatchObject({ layout: "circles" });
    expect(homeSectionSchema.parse(sample.categories)).toMatchObject({ columns: "auto" });
    for (const layout of ["rounded-squares", "story-rings", "pills", "tiles", "banner-row", "bento", "minimal-list"]) {
      expect(homeSectionSchema.parse({ ...sample.categories, layout }), layout).toMatchObject({ layout });
    }
    expect(homeSectionSchema.parse({ ...sample.categories, layout: "tiles", columns: "5" })).toMatchObject({ layout: "tiles", columns: "5" });
    expect(homeSectionSchema.parse({ ...sample.categories, columns: "9" })).toMatchObject({ columns: "auto" });
    expect(homeSectionSchema.parse(sample.usp)).toMatchObject({ layout: "cards" });
    expect(homeSectionSchema.parse({ ...sample.usp, layout: "split", title: "Why us" })).toMatchObject({ layout: "split", title: "Why us" });
    expect(homeSectionSchema.parse(sample.newsletter)).toMatchObject({ layout: "band" });
    expect(homeSectionSchema.parse({ ...sample.newsletter, layout: "split", imageUrl: "/n.jpg" })).toMatchObject({ layout: "split", imageUrl: "/n.jpg" });
    expect(homeSectionSchema.safeParse({ ...sample.newsletter, imageUrl: "javascript:x" }).success).toBe(false);
  });

  it("resolve attaches products to a deal and to look hotspots (dropping the ones that are gone)", async () => {
    const out = await resolveSections(T, [sample.deal, sample["shop-the-look"], { ...sample.categories, layout: "cards", showCounts: true, columns: "4" }], { catalog });
    expect(out[0]).toMatchObject({ type: "deal", product: { id: P1 }, endsAt: "2026-11-01T18:30:00.000Z" });
    expect(out[0]).not.toHaveProperty("productId");
    expect(out[1]).toMatchObject({ type: "shop-the-look", hotspots: [{ x: 30, y: 40.5, product: { id: P1 } }] });
    expect(out[2]).toMatchObject({ type: "categories", layout: "cards", showCounts: true, columns: "4" });
    const none: CatalogPort = { ...catalog, productsByIds: async () => [] };
    expect(await resolveSections(T, [sample.deal, sample["shop-the-look"]], { catalog: none })).toEqual([]);
  });

  it("old testimonials (quote + name only) still parse", () => {
    expect(homeSectionSchema.parse({ type: "testimonials", items: [{ quote: "Nice", name: "Anu" }] })).toEqual({ type: "testimonials", layout: "carousel", items: [{ quote: "Nice", name: "Anu" }] });
  });
});

describe("section style", () => {
  it("is optional and kept as given", () => {
    expect(homeSectionSchema.parse(sample.text)).not.toHaveProperty("style");
    const style = { background: "image", imageUrl: "/bg.jpg", overlay: 40, padding: "spacious", width: "full", align: "center", animation: "rise", hideOnMobile: true };
    expect(homeSectionSchema.parse({ ...sample.text, style })).toMatchObject({ style });
  });

  it("works on every section type", () => {
    for (const type of HOME_SECTION_TYPES) {
      expect(homeSectionSchema.parse({ ...sample[type], style: { background: "dark" } }), type).toMatchObject({ style: { background: "dark" } });
    }
  });

  it("an image background needs a picture; unknown values fall back to the default", () => {
    expect(homeSectionSchema.safeParse({ ...sample.text, style: { background: "image" } }).success).toBe(false);
    expect(homeSectionSchema.safeParse({ ...sample.text, style: { background: "image", imageUrl: "javascript:x" } }).success).toBe(false);
    expect(homeSectionSchema.parse({ ...sample.text, style: { background: "neon", padding: "huge", animation: "spin" } })).toMatchObject({ style: {} });
    expect(homeSectionSchema.safeParse({ ...sample.text, style: { overlay: 120 } }).success).toBe(false);
  });

  it("resolve keeps the style on catalogue sections too", async () => {
    const style = { background: "muted" as const, padding: "compact" as const };
    const out = await resolveSections(T, [{ ...sample.categories, style }, { ...sample.text, style }, { ...sample["category-mosaic"], style }], { catalog });
    expect(out.map((s) => s.style)).toEqual([style, style, style]);
    expect(out[2]).toMatchObject({ type: "category-mosaic", categories: [{ slug: "sarees" }] });
  });
});

describe("hidden sections: schema", () => {
  for (const type of HOME_SECTION_TYPES) {
    it(`${type} accepts hidden and keeps it`, () => {
      expect(homeSectionSchema.parse({ ...sample[type], hidden: true })).toMatchObject({ type, hidden: true });
      expect(homeSectionSchema.parse(sample[type])).not.toHaveProperty("hidden");
      expect(homeSectionSchema.safeParse({ ...sample[type], hidden: "yes" }).success).toBe(false);
    });
  }

  it("hero slides take no image (null or omitted → null)", () => {
    expect(homeSectionSchema.parse({ type: "hero", slides: [{ heading: "x" }] })).toMatchObject({ slides: [{ imageUrl: null }] });
    expect(homeSectionSchema.parse({ type: "hero", slides: [{ imageUrl: null }] })).toMatchObject({ slides: [{ imageUrl: null }] });
    expect(homeSectionSchema.safeParse({ type: "hero", slides: [{ imageUrl: "javascript:x" }] }).success).toBe(false);
    expect(homeSectionSchema.safeParse({ type: "hero", slides: [{ imageUrl: "" }] }).success).toBe(false);
  });
});

describe("hidden sections: resolve", () => {
  const all = HOME_SECTION_TYPES.map((type) => ({ ...sample[type], hidden: true }));

  it("public output skips every hidden section", async () => {
    expect(await resolveSections(T, all, { catalog })).toEqual([]);
    const home = await publicHome(T, homeDocSchema.parse({ sections: [...all, sample.text] }), new Date(), { catalog, shop });
    expect(home.sections).toEqual([{ type: "text", markdown: "Hi" }]);
    expect(home.isDefault).toBe(false);
  });

  it("the staff preview keeps them, flagged hidden", async () => {
    const out = await resolveSections(T, [...all, sample.text], { catalog }, { includeHidden: true });
    expect(out.map((s) => s.type)).toEqual([...HOME_SECTION_TYPES, "text"]);
    expect(out.slice(0, -1).every((s) => (s as { hidden?: boolean }).hidden === true)).toBe(true);
    expect(out.at(-1)).not.toHaveProperty("hidden");
  });
});

/** In-memory stand-in for the cms_home table (select/insert-upsert/update chains the service uses). */
function fakeDb() {
  let row: Record<string, unknown> | null = null;
  const db = {
    select: (fields?: Record<string, unknown>) => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            if (!row) return [];
            if (!fields) return [{ ...row }];
            const r = row;
            return [Object.fromEntries(Object.keys(fields).map((k) => [k, r[k] ?? null]))];
          },
        }),
      }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoUpdate: async ({ set }: { set: Record<string, unknown> }) => {
          row = row ? { ...row, ...set } : { published: null, publishedAt: null, updatedAt: new Date(), ...v };
        },
      }),
    }),
    update: () => ({
      set: (s: Record<string, unknown>) => ({
        where: async () => {
          if (row) row = { ...row, ...s };
        },
      }),
    }),
  };
  return { db, stored: () => row };
}

describe("hidden sections: draft round-trip", () => {
  it("saves hidden in the draft, publishes it, and the public home skips it", async () => {
    const { db, stored } = fakeDb();
    const service = new CmsService({ db: db as never, catalog, shop } as never);
    const saved = await service.saveHomeDraft(T, {
      sections: [{ ...sample.text, hidden: true }, { ...sample.newsletter }, { ...sample.hero, hidden: false }],
    });
    expect(saved.draft?.sections).toEqual([
      { type: "text", markdown: "Hi", hidden: true },
      { type: "newsletter", heading: "Join", text: "", layout: "band" },
      { type: "hero", hidden: false, slides: [{ imageUrl: null, heading: "Festive" }] },
    ]);
    expect((stored()!.draft as { sections: { hidden?: boolean }[] }).sections[0]!.hidden).toBe(true);

    const preview = await service.previewHome(T);
    expect(preview.sections.map((s) => [s.type, (s as { hidden?: boolean }).hidden ?? false])).toEqual([
      ["text", true],
      ["newsletter", false],
      ["hero", false],
    ]);

    const published = await service.publishHome(T);
    expect(published.published?.sections[0]).toMatchObject({ hidden: true });
    expect(published.hasUnpublishedChanges).toBe(false);
    const pub = await service.publicHome(T);
    expect(pub.sections.map((s) => s.type)).toEqual(["newsletter", "hero"]);
  });
});
