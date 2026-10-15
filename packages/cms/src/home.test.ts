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
};

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
      { type: "newsletter", heading: "Join", text: "" },
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
