import { describe, expect, it } from "vitest";
import { themePreset } from "@rbms/branding";
import { blocksSchema, homeDocSchema, localizeSections, menuItemsSchema, postInputSchema } from "@rbms/cms";
import { GST_RATES } from "@rbms/gst";
import { PACKS, type BusinessType } from "@rbms/verticals";
import { DEMO_STORES } from "./index";
import { imageType, pexelsUrl, variantInputs } from "./seed-demo-store";
import type { DemoStore, HomeContext, PhotoSize } from "./types";

const UUID = "00000000-0000-4000-8000-000000000001";
/** A context that records the photos asked for and answers with fake URLs / ids. */
function fakeCtx() {
  const photos: { id: number; size: PhotoSize }[] = [];
  const ctx: HomeContext = {
    photo: (id, size = "wide") => {
      photos.push({ id, size });
      return `http://localhost:4000/v1/uploads/files/t/x/storefront/2026/10/${id}-${size}.jpg`;
    },
    category: () => UUID,
    product: () => UUID,
  };
  return { ctx, photos };
}

describe.each(DEMO_STORES.map((s) => [s.shop.slug, s] as [string, DemoStore]))("demo store %s", (_slug, store) => {
  it("runs on an app with the online store, in a known trade, with its own look", () => {
    expect(["EC", "PH", "RS", "SV", "SC"]).toContain(store.shop.appId);
    expect(PACKS[store.shop.businessType as BusinessType]).toBeDefined();
    const preset = themePreset(store.preset);
    expect(preset).not.toBeNull();
    // A store of the series shows a look of its own, not its trade's starter look.
    expect(store.preset).not.toBe(PACKS[store.shop.businessType as BusinessType].preset);
    // Every other store of the series has a different look.
    expect(DEMO_STORES.filter((s) => s.preset === store.preset)).toHaveLength(1);
  });

  it("has a believable catalogue: 30–95 products over its categories (a website-only school: 10+ programmes), valid GST, MRP ≥ price, unique names and SKUs", () => {
    // A website-only store (school) lists programmes, not goods: a smaller catalogue, and no price (shown as "Fee on enquiry").
    const site = !!PACKS[store.shop.businessType as BusinessType].site;
    expect(store.products.length).toBeGreaterThanOrEqual(site ? 10 : 30);
    expect(store.products.length).toBeLessThanOrEqual(95);
    const cats = new Set(store.categories.map((c) => c.name));
    // Every category has products, or (a parent) sub-categories that have them; parents are listed before children.
    const under = (c: string) => [c, ...store.categories.filter((x) => x.parent === c).map((x) => x.name)];
    for (const c of cats) expect(store.products.some((p) => under(c).includes(p.category)), c).toBe(true);
    for (const [i, c] of store.categories.entries()) if (c.parent) expect(store.categories.findIndex((x) => x.name === c.parent), c.name).toBeLessThan(i);
    expect(new Set(store.products.map((p) => p.name)).size).toBe(store.products.length);
    const skus = store.products.flatMap((p) => variantInputs(p).map((v) => v.sku));
    expect(new Set(skus).size).toBe(skus.length);
    for (const p of store.products) {
      expect(cats.has(p.category), p.name).toBe(true);
      expect(GST_RATES as readonly number[], p.name).toContain(p.gstRate);
      expect(p.hsn, p.name).toMatch(/^\d{4,8}$/);
      expect(p.description.length, p.name).toBeGreaterThan(40);
      const combos = (p.options ?? []).reduce((n, o) => n * o.values.length, 1);
      expect(p.variants, p.name).toHaveLength(combos);
      for (const v of p.variants) {
        if (site) expect(v.price, p.name).toBeGreaterThanOrEqual(0);
        else expect(v.price, p.name).toBeGreaterThan(0);
        expect(v.mrp, p.name).toBeGreaterThanOrEqual(v.price);
        for (const o of p.options ?? []) expect(o.values, p.name).toContain(v.values?.[o.name]);
      }
    }
    for (const c of store.collections) if (c.rule.category) expect(cats.has(c.rule.category), c.slug).toBe(true);
  });

  it("credits every photo it uses, and uses every photo it credits", () => {
    const { ctx, photos } = fakeCtx();
    store.home(ctx);
    for (const p of store.pages) p.blocks(ctx);
    for (const post of store.posts ?? []) post.blocks(ctx);
    const used = new Set([...store.products.map((p) => p.photo), ...store.categories.map((c) => c.photo), ...(store.posts ?? []).map((p) => p.cover), ...photos.map((p) => p.id)]);
    for (const id of used) expect(store.photos[id], `photo ${id}`).toBeDefined();
    for (const id of Object.keys(store.photos)) expect(used.has(Number(id)), `photo ${id} unused`).toBe(true);
  });

  it("has a valid home with stable ids and a Tamil translation of every section's words", () => {
    const doc = homeDocSchema.parse(store.home(fakeCtx().ctx));
    const ids = doc.sections.map((s) => s.id);
    expect(ids.every((id) => !!id && !id.startsWith("starter-"))).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
    const ta = doc.translations?.ta ?? {};
    for (const id of Object.keys(ta)) expect(ids, id).toContain(id);
    // Sections with words of their own have Tamil ones (shelves and deals show catalogue names).
    for (const s of doc.sections) expect(ta[s.id!], s.id).toBeDefined();
    const local = localizeSections(doc.sections, doc.translations, "ta");
    // The opening banner (a slide hero or a split hero) reads in Tamil.
    const hero = local.find((s) => s.type === "hero" || s.type === "hero-split");
    // A home without a banner (Thunai opens with a finder) reads in Tamil in its first section's title.
    const opening = hero ? (hero.type === "hero" ? hero.slides[0]?.heading : hero.type === "hero-split" ? hero.heading : undefined) : (local[0] as { title?: string; heading?: string }).title ?? (local[0] as { heading?: string }).heading;
    expect(opening).toMatch(/[஀-௿]/);
    expect(localizeSections(doc.sections, doc.translations, "en")).toEqual(doc.sections);
  });

  it("has valid pages and menus", () => {
    for (const p of store.pages) expect(blocksSchema.safeParse(p.blocks(fakeCtx().ctx)).success, p.slug).toBe(true);
    for (const post of store.posts ?? []) expect(postInputSchema.safeParse({ title: post.title, slug: post.slug, excerpt: post.excerpt, tags: post.tags, authorName: post.authorName, blocks: post.blocks(fakeCtx().ctx) }).success, post.slug).toBe(true);
    expect(menuItemsSchema.safeParse(store.menus.header).success).toBe(true);
    expect(menuItemsSchema.safeParse(store.menus.footer).success).toBe(true);
    const pageSlugs = new Set(store.pages.map((p) => p.slug));
    const collections = new Set(store.collections.map((c) => c.slug));
    for (const item of [...store.menus.header, ...store.menus.footer].flatMap((i) => [i, ...(i.children ?? [])])) {
      if (item.type === "page") expect(pageSlugs.has(item.ref!), item.ref).toBe(true);
      if (item.type === "collection") expect(collections.has(item.ref!), item.ref).toBe(true);
    }
  });
});

describe("demo store photos", () => {
  it("asks the Pexels CDN for a reduced, cropped picture", () => {
    expect(pexelsUrl(123, "square")).toBe("https://images.pexels.com/photos/123/pexels-photo-123.jpeg?auto=compress&cs=tinysrgb&w=1000&h=1000&fit=crop");
    expect(pexelsUrl(123, "wide")).toContain("w=1800&fit=max");
  });

  it("only stores real images", () => {
    expect(imageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(imageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]))).toBe("image/png");
    expect(imageType(new TextEncoder().encode("<!doctype html>"))).toBeNull();
  });

  it("gives every variant its own SKU and a cost below the price", () => {
    const p = DEMO_STORES[0]!.products.find((x) => (x.options?.length ?? 0) > 1)!;
    const vs = variantInputs(p);
    expect(vs).toHaveLength(p.variants.length);
    expect(vs.every((v) => v.cost < v.price)).toBe(true);
  });
});
