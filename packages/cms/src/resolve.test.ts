import { describe, expect, it, vi } from "vitest";
import type { CatalogPort, PublicProductSummary, ShopPort } from "./ports";
import { defaultHome, publicHome, resolveMenu, resolveSections } from "./resolve";

const T = "11111111-1111-4111-8111-111111111111";
const C1 = "c1111111-1111-4111-8111-111111111111";
const C2 = "c2222222-2222-4222-8222-222222222222";
const P1 = "a1111111-1111-4111-8111-111111111111";
const P2 = "a2222222-2222-4222-8222-222222222222";
const GONE = "deadbeef-dead-4ead-8ead-deadbeefdead";

const product = (id: string, name = `Product ${id.slice(0, 2)}`): PublicProductSummary => ({
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

const categories = [
  { id: C1, name: "Sarees", slug: "sarees", image: "/s.jpg" },
  { id: C2, name: "Kurtis", slug: "kurtis", image: null },
];

function stubCatalog(over: Partial<CatalogPort> = {}): CatalogPort {
  return {
    categories: vi.fn(async (_t: string, ids?: string[]) => (ids ? categories.filter((c) => ids.includes(c.id)).reverse() : categories)),
    collection: vi.fn(async (_t: string, slug: string, limit: number) =>
      slug === "best" ? { name: "Best sellers", slug: "best", products: [product(P1), product(P2)].slice(0, limit) } : null,
    ),
    productsByIds: vi.fn(async (_t: string, ids: string[]) => [product(P1), product(P2)].filter((p) => ids.includes(p.id))),
    newest: vi.fn(async (_t: string, limit: number) => [product(P2), product(P1)].slice(0, limit)),
    ...over,
  };
}
const shop: ShopPort = { info: async () => ({ name: "Raja Silks", tagline: "Since 1962" }) };

describe("resolveSections", () => {
  it("fills catalogue data, keeps chosen order and drops sections whose data is gone", async () => {
    const catalog = stubCatalog();
    const out = await resolveSections(
      T,
      [
        { type: "text", markdown: "Welcome" },
        { type: "categories", title: "Shop", categoryIds: [C1, GONE, C2] },
        { type: "categories", title: "Gone", categoryIds: [GONE] },
        { type: "collection", title: "", collectionSlug: "best", limit: 1 },
        { type: "collection", title: "Old", collectionSlug: "deleted" },
        { type: "products", title: "Picks", productIds: [P2, GONE, P1] },
        { type: "products", title: "None", productIds: [GONE] },
        { type: "banner", imageUrl: "/b.jpg" },
      ],
      { catalog },
    );
    expect(out.map((s) => s.type)).toEqual(["text", "categories", "collection", "products", "banner"]);
    const cats = out[1] as { categories: { id: string }[] };
    expect(cats.categories.map((c) => c.id)).toEqual([C1, C2]);
    expect(out[2]).toMatchObject({ title: "Best sellers", layout: "carousel", collection: { slug: "best" } });
    expect((out[2] as { products: unknown[] }).products).toHaveLength(1);
    expect((out[3] as { products: { id: string }[] }).products.map((p) => p.id)).toEqual([P2, P1]);
    expect(catalog.collection).toHaveBeenCalledWith(T, "best", 1);
  });

  it("drops invalid stored sections and sections whose lookup throws", async () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const catalog = stubCatalog({ productsByIds: async () => Promise.reject(new Error("db down")) });
    const out = await resolveSections(
      T,
      [{ type: "products", title: "x", productIds: [P1] }, { type: "nope" }, { type: "newsletter", heading: "Join" }],
      { catalog, log },
    );
    expect(out.map((s) => s.type)).toEqual(["newsletter"]);
    expect(log.warn).toHaveBeenCalledOnce();
  });

  it("categories without ids shows all", async () => {
    const out = await resolveSections(T, [{ type: "categories" }], { catalog: stubCatalog() });
    expect((out[0] as { categories: unknown[] }).categories).toHaveLength(2);
  });
});

describe("default home", () => {
  it("hero with the shop name, categories and newest products", async () => {
    const home = await defaultHome(T, { catalog: stubCatalog(), shop });
    expect(home.isDefault).toBe(true);
    expect(home.sections.map((s) => s.type)).toEqual(["hero", "categories", "products"]);
    expect(home.sections[0]).toEqual({
      type: "hero",
      slides: [{ imageUrl: null, heading: "Raja Silks", subheading: "Since 1962", cta: { label: "Shop now", href: "/products" } }],
    });
    expect(home.sections[2]).toMatchObject({ title: "New arrivals", href: "/products" });
  });

  it("an empty shop still gets a hero", async () => {
    const catalog = stubCatalog({ categories: async () => [], newest: async () => [] });
    const home = await defaultHome(T, { catalog, shop: { info: async () => ({ name: "Kumar Stores" }) } });
    expect(home.sections).toHaveLength(1);
    expect(home.sections[0]).toMatchObject({ slides: [{ heading: "Kumar Stores" }] });
  });

  it("is used only while nothing is published", async () => {
    const catalog = stubCatalog();
    const none = await publicHome(T, null, null, { catalog, shop });
    expect(none.isDefault).toBe(true);
    const at = new Date("2026-10-01T10:00:00Z");
    const pub = await publicHome(T, { sections: [{ type: "newsletter", heading: "Join", text: "" }] }, at, { catalog, shop });
    expect(pub).toMatchObject({ isDefault: false, publishedAt: "2026-10-01T10:00:00.000Z", sections: [{ type: "newsletter" }] });
    // Published but every section's data gone → empty, not the default.
    const empty = await publicHome(T, { sections: [{ type: "products", title: "", productIds: [GONE] }] }, at, { catalog, shop });
    expect(empty.sections).toEqual([]);
    expect(empty.isDefault).toBe(false);
  });
});

describe("resolveMenu", () => {
  it("builds storefront hrefs and drops unpublished pages/posts", () => {
    const out = resolveMenu(
      [
        { label: "Sarees", type: "category", ref: "sarees", children: [{ label: "Best", type: "collection", ref: "best" }] },
        { label: "About", type: "page", ref: "about" },
        { label: "Draft", type: "page", ref: "secret" },
        { label: "Tips", type: "post", ref: "care-tips" },
        { label: "More", type: "url", children: [{ label: "Gone", type: "page", ref: "secret" }] },
        { label: "Insta", type: "url", href: "https://instagram.com/raja" },
      ],
      (type, slug) => (type === "page" ? slug === "about" : true),
    );
    expect(out).toEqual([
      { label: "Sarees", type: "category", href: "/c/sarees", children: [{ label: "Best", type: "collection", href: "/collections/best" }] },
      { label: "About", type: "page", href: "/about" },
      { label: "Tips", type: "post", href: "/blog/care-tips" },
      { label: "Insta", type: "url", href: "https://instagram.com/raja" },
    ]);
  });
});
