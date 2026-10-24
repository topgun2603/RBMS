import { describe, expect, it, vi } from "vitest";
import { homeSectionSchema, sectionStyleSchema } from "./content";
import { localizeSections } from "./localize";
import type { CatalogPort, PublicProductSummary } from "./ports";
import { resolveSections } from "./resolve";

/* Layout sections (flash sale, finder, stories, category shelf, sticky story, comparison) and the half-width span. */

const T = "11111111-1111-4111-8111-111111111111";
const P1 = "a1111111-1111-4111-8111-111111111111";
const P2 = "a2222222-2222-4222-8222-222222222222";
const P3 = "a3333333-3333-4333-8333-333333333333";
const GONE = "deadbeef-dead-4ead-8ead-deadbeefdead";
const C1 = "c1111111-1111-4111-8111-111111111111";
const C2 = "c2222222-2222-4222-8222-222222222222";
const ENDS = "2026-11-01T18:30:00.000Z";

const product = (id: string): PublicProductSummary => ({
  id,
  name: `P ${id.slice(1, 2)}`,
  slug: `p-${id.slice(1, 2)}`,
  categoryId: null,
  categoryName: null,
  image: null,
  priceMin: 49900,
  priceMax: 49900,
  mrp: 59900,
  variantCount: 1,
  taxInclusive: true,
});
const live = new Set([P1, P2, P3]);
const catalog: CatalogPort = {
  categories: vi.fn(async (_t: string, ids?: string[]) => {
    const all = [
      { id: C1, name: "School bags", slug: "school-bags", image: null },
      { id: C2, name: "Notebooks", slug: "notebooks", image: "/n.jpg" },
    ];
    return ids ? all.filter((c) => ids.includes(c.id)) : all;
  }),
  collection: vi.fn(async (_t: string, slug: string, limit: number) => (slug === "festive" ? { name: "Festive", slug, products: [product(P3), product(P1)].slice(0, limit) } : null)),
  productsByIds: vi.fn(async (_t: string, ids: string[]) => ids.filter((id) => live.has(id)).map(product)),
  newest: vi.fn(async () => []),
};
const bad = (s: Record<string, unknown>) => expect(homeSectionSchema.safeParse(s).success, JSON.stringify(s)).toBe(false);

describe("flash sale", () => {
  it("defaults: picked products, a carousel of 8", () => {
    expect(homeSectionSchema.parse({ type: "flash-sale", endsAt: ENDS, productIds: [P1] })).toEqual({
      type: "flash-sale",
      endsAt: ENDS,
      source: "pick",
      productIds: [P1],
      layout: "carousel",
      limit: 8,
    });
    expect(homeSectionSchema.parse({ type: "flash-sale", endsAt: ENDS, source: "mystery" })).toMatchObject({ source: "pick", productIds: [] });
  });

  it("takes an optional daily window (shop time HH:MM, 24:00 = midnight, may run past midnight)", () => {
    expect(homeSectionSchema.parse({ type: "flash-sale", endsAt: ENDS, productIds: [P1], daily: { from: "18:00", to: "21:00" } })).toMatchObject({ daily: { from: "18:00", to: "21:00" } });
    expect(homeSectionSchema.parse({ type: "flash-sale", endsAt: ENDS, productIds: [P1], daily: { from: "22:00", to: "24:00" } })).toMatchObject({ daily: { to: "24:00" } });
    bad({ type: "flash-sale", endsAt: ENDS, daily: { from: "6pm", to: "9pm" } });
    bad({ type: "flash-sale", endsAt: ENDS, daily: { from: "18:00", to: "18:00" } });
    bad({ type: "flash-sale", endsAt: ENDS, daily: { from: "18:00" } });
  });

  it("needs an end and real dates", () => {
    bad({ type: "flash-sale", productIds: [P1] });
    bad({ type: "flash-sale", endsAt: "tonight" });
    bad({ type: "flash-sale", endsAt: ENDS, startsAt: "soon" });
    bad({ type: "flash-sale", endsAt: ENDS, limit: 30 });
    bad({ type: "flash-sale", endsAt: ENDS, cta: { label: "Go", href: "javascript:alert(1)" } });
  });

  it("resolves picked products in order, a collection's, and leaves `sale` to the storefront", async () => {
    const out = await resolveSections(
      T,
      [
        { type: "flash-sale", endsAt: ENDS, productIds: [P2, GONE, P1] },
        { type: "flash-sale", endsAt: ENDS, source: "collection", collectionSlug: "festive", limit: 1 },
        { type: "flash-sale", endsAt: ENDS, source: "sale" },
        { type: "flash-sale", endsAt: ENDS, productIds: [GONE] },
        { type: "flash-sale", endsAt: ENDS, source: "collection", collectionSlug: "gone" },
      ],
      { catalog },
    );
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ type: "flash-sale", source: "pick", products: [{ id: P2 }, { id: P1 }] });
    expect(out[0]).not.toHaveProperty("productIds");
    expect(out[1]).toMatchObject({ source: "collection", products: [{ id: P3 }] });
    expect(out[2]).toMatchObject({ source: "sale", products: [] });
  });
});

describe("finder", () => {
  const finder = {
    type: "finder",
    questions: [
      { label: "Which class?", options: [{ label: "LKG–UKG", filterName: "Class", filterValue: "LKG-UKG" }, { label: "Class 1–5", categoryId: C1 }] },
      { label: "Budget", options: [{ label: "Under ₹500", priceMax: 50000 }, { label: "Any", keywords: "premium" }] },
    ],
  };

  it("parses questions and options with their filters", () => {
    expect(homeSectionSchema.parse(finder)).toMatchObject({ layout: "wizard", limit: 8, questions: [{ options: [{ filterName: "Class" }, { categoryId: C1 }] }, { options: [{ priceMax: 50000 }, {}] }] });
    expect(homeSectionSchema.parse({ ...finder, layout: "chips" })).toMatchObject({ layout: "chips" });
  });

  it("needs 1–3 questions of 2–8 answers", () => {
    bad({ ...finder, questions: [] });
    bad({ ...finder, questions: [finder.questions[0], finder.questions[0], finder.questions[0], finder.questions[0]] });
    bad({ ...finder, questions: [{ label: "Age", options: [{ label: "Only one" }] }] });
    bad({ ...finder, questions: [{ label: "Age", options: [{ label: "A", categoryId: "x" }, { label: "B" }] }] });
    bad({ ...finder, questions: [{ label: "", options: [{ label: "A" }, { label: "B" }] }] });
  });

  it("a Tamil translation changes the words, never the filters", () => {
    const s = { ...homeSectionSchema.parse({ ...finder, title: "Find the right bag" }), id: "f1" };
    const [ta] = localizeSections([s], { ta: { f1: { title: "சரியானதைக் கண்டறியுங்கள்", questions: [{ label: "எந்த வகுப்பு?", options: [{ label: "எல்கேஜி", filterValue: "X" }] }] } } }, "ta");
    const q = (ta as unknown as { title: string; questions: { label: string; options: { label: string; filterValue?: string }[] }[] });
    expect(q.title).toBe("சரியானதைக் கண்டறியுங்கள்");
    expect(q.questions[0]).toMatchObject({ label: "எந்த வகுப்பு?" });
    expect(q.questions[0]!.options[0]).toEqual({ label: "எல்கேஜி", filterName: "Class", filterValue: "LKG-UKG" });
    expect(q.questions[1]!.options).toHaveLength(2);
  });
});

describe("stories", () => {
  it("rings by default; reels and video clips allowed", () => {
    expect(homeSectionSchema.parse({ type: "stories", items: [{ imageUrl: "/a.jpg", title: "New" }] })).toMatchObject({ layout: "rings" });
    expect(homeSectionSchema.parse({ type: "stories", layout: "reels", items: [{ imageUrl: "/a.jpg", videoUrl: "/a.mp4", title: "Drape", href: "/c/sarees", ctaLabel: "Shop" }] })).toMatchObject({ layout: "reels" });
  });
  it("rejects empty strips, bad links and too many stories", () => {
    bad({ type: "stories", items: [] });
    bad({ type: "stories", items: [{ imageUrl: "/a.jpg", title: "x", href: "javascript:alert(1)" }] });
    bad({ type: "stories", items: Array.from({ length: 13 }, () => ({ imageUrl: "/a.jpg", title: "x" })) });
  });
});

describe("category shelf", () => {
  it("defaults and resolve (picked in order, or the first categories)", async () => {
    expect(homeSectionSchema.parse({ type: "category-shelf" })).toEqual({ type: "category-shelf", title: "", showImages: true, limit: 8 });
    bad({ type: "category-shelf", categoryIds: Array.from({ length: 9 }, () => C1) });
    const [picked, all] = await resolveSections(T, [{ type: "category-shelf", categoryIds: [C2, C1] }, { type: "category-shelf" }], { catalog });
    expect(picked).toMatchObject({ categories: [{ id: C2 }, { id: C1 }] });
    expect(picked).not.toHaveProperty("categoryIds");
    expect(all).toMatchObject({ categories: [{ id: C1 }, { id: C2 }] });
  });
});

describe("sticky story", () => {
  it("chapters with pictures, 1–6", () => {
    expect(homeSectionSchema.parse({ type: "sticky-story", chapters: [{ heading: "Loom", imageUrl: "/l.jpg", markdown: "<b>Hand</b> woven" }] })).toMatchObject({
      imageSide: "left",
      chapters: [{ heading: "Loom", markdown: "Hand woven", alt: "" }],
    });
    bad({ type: "sticky-story", chapters: [] });
    bad({ type: "sticky-story", chapters: [{ heading: "Loom" }] });
    bad({ type: "sticky-story", chapters: Array.from({ length: 7 }, () => ({ heading: "x", imageUrl: "/x.jpg" })) });
  });
});

describe("comparison", () => {
  it("2–4 products; rows default to none", () => {
    expect(homeSectionSchema.parse({ type: "comparison", productIds: [P1, P2] })).toEqual({ type: "comparison", productIds: [P1, P2], showRating: true, rows: [] });
    bad({ type: "comparison", productIds: [P1] });
    bad({ type: "comparison", productIds: [P1, P2, P3, P1, P2] });
    bad({ type: "comparison", productIds: [P1, P2], rows: [{ label: "", values: [] }] });
  });

  it("resolve drops gone products and their values, and a highlight that is gone", async () => {
    const [out] = await resolveSections(
      T,
      [{ type: "comparison", productIds: [P1, GONE, P2], highlightId: GONE, rows: [{ label: "Sole", values: ["Rubber", "Gone", "Leather"] }, { label: "Weight", values: ["300 g"] }] }],
      { catalog },
    );
    expect(out).toMatchObject({ products: [{ id: P1 }, { id: P2 }], rows: [{ label: "Sole", values: ["Rubber", "Leather"] }, { label: "Weight", values: ["300 g", ""] }] });
    expect((out as { highlightId?: string }).highlightId).toBeUndefined();
    expect(await resolveSections(T, [{ type: "comparison", productIds: [P1, GONE] }], { catalog })).toEqual([]);
  });
});

describe("section span", () => {
  it("half pairs sections; unknown values fall back to the default", () => {
    expect(sectionStyleSchema.parse({ span: "half" })).toEqual({ span: "half" });
    expect(sectionStyleSchema.parse({ span: "third" })).toEqual({});
  });
});

describe("finder: button results, picture, second button, answer links", () => {
  it("defaults to inline matches; takes a button, picture and a WhatsApp link", () => {
    const base = { type: "finder", questions: [{ label: "Class", options: [{ label: "LKG", href: "/collections/class-lkg-ukg" }, { label: "1–5", tag: "Class-1-5" }] }] };
    expect(homeSectionSchema.parse(base)).toMatchObject({ results: "inline" });
    expect(homeSectionSchema.parse({ ...base, results: "button", buttonLabel: "Show my list", imageUrl: "/f.jpg", cta: { label: "WhatsApp", href: "https://wa.me/919876500088" } })).toMatchObject({
      results: "button",
      buttonLabel: "Show my list",
      questions: [{ options: [{ href: "/collections/class-lkg-ukg" }, { tag: "class-1-5" }] }],
    });
    bad({ ...base, questions: [{ label: "Class", options: [{ label: "A", href: "javascript:alert(1)" }, { label: "B" }] }] });
  });
});

describe("tiles (shop by need)", () => {
  it("row by default with counts; each tile needs a name", () => {
    expect(homeSectionSchema.parse({ type: "tiles", items: [{ label: "Acne & oily skin", note: "Niacinamide", collectionSlug: "acne" }] })).toMatchObject({ layout: "row", showCounts: true });
    bad({ type: "tiles", items: [] });
    bad({ type: "tiles", items: [{ label: "" }] });
    bad({ type: "tiles", items: [{ label: "x", href: "javascript:x" }] });
  });
});

describe("size finder", () => {
  it("groups of sizes over an option (Size by default)", () => {
    expect(homeSectionSchema.parse({ type: "size-finder", groups: [{ label: "Men", categoryId: C1, sizes: ["UK 6", "UK 7"] }] })).toMatchObject({ optionName: "Size", footLength: false });
    bad({ type: "size-finder", groups: [] });
    bad({ type: "size-finder", groups: [{ label: "Men", sizes: [] }] });
    bad({ type: "size-finder", groups: Array.from({ length: 5 }, () => ({ label: "x", sizes: ["1"] })) });
  });
  it("a translation keeps the option name and sizes", () => {
    const s = { ...homeSectionSchema.parse({ type: "size-finder", title: "Find your size", groups: [{ label: "Men", sizes: ["UK 6"] }] }), id: "z" };
    const [ta] = localizeSections([s], { ta: { z: { title: "அளவு", optionName: "அளவு", groups: [{ label: "ஆண்", sizes: ["ஆறு"] }] } } }, "ta");
    expect(ta).toMatchObject({ title: "அளவு", optionName: "Size", groups: [{ label: "ஆண்", sizes: ["UK 6"] }] });
  });
});

describe("shade finder (swatches)", () => {
  it("products with shade colours; bad colours and depths are refused", async () => {
    expect(homeSectionSchema.parse({ type: "swatches", productIds: [P1] })).toMatchObject({ optionName: "Shade", shades: [] });
    bad({ type: "swatches", productIds: [] });
    bad({ type: "swatches", productIds: [P1], shades: [{ value: "Ruby", hex: "red" }] });
    bad({ type: "swatches", productIds: [P1], shades: [{ value: "Ruby", hex: "#9b111e", depth: "olive" }] });
    const [out] = await resolveSections(T, [{ type: "swatches", productIds: [GONE, P2], shades: [{ value: "Ruby", hex: "#9b111e" }] }], { catalog });
    expect(out).toMatchObject({ type: "swatches", products: [{ id: P2 }], shades: [{ value: "Ruby" }] });
    const [ta] = localizeSections([{ ...(out as object), id: "w" } as { id: string }], { ta: { w: { shades: [{ value: "மாணிக்கம்" }] } } }, "ta");
    expect(ta).toMatchObject({ shades: [{ value: "Ruby" }] });
  });
});
