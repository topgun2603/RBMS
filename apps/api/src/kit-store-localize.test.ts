import { describe, expect, it, vi } from "vitest";
import { applyTranslations, collectProductIds, createStoreLocalizer, wantsTranslation, type ApprovedText } from "./kit-store-localize";

const P1 = "11111111-1111-4111-8111-111111111111";
const P2 = "22222222-2222-4222-8222-222222222222";
const CAT = "33333333-3333-4333-8333-333333333333";

const texts: Record<string, ApprovedText> = {
  [P1]: { name: "பட்டுப் புடவை", description: "அழகான புடவை", sourceName: "Silk saree" },
};

describe("applyTranslations", () => {
  it("translates the name and description of a public product and the name of a card", () => {
    const out = applyTranslations(
      { id: P1, slug: "silk-saree", name: "Silk saree", description: "Nice saree", variants: [{ id: "v", title: "Red" }], categoryName: "Sarees" },
      texts,
    );
    expect(out).toMatchObject({ name: "பட்டுப் புடவை", description: "அழகான புடவை", categoryName: "Sarees", variants: [{ id: "v", title: "Red" }] });
    expect(applyTranslations({ items: [{ id: P1, slug: "s", name: "Silk saree", priceMin: 100 }] }, texts)).toEqual({ items: [{ id: P1, slug: "s", name: "பட்டுப் புடவை", priceMin: 100 }] });
  });

  it("falls back to the original text when there is no approved translation or the Tamil part is empty", () => {
    const en = { id: P2, slug: "x", name: "Cotton saree", description: "Soft" };
    expect(applyTranslations(en, texts)).toEqual(en);
    expect(applyTranslations(en, {})).toEqual(en);
    // A description-only translation (from "Write description") keeps the English name.
    const descOnly = applyTranslations({ id: P2, slug: "x", name: "Cotton saree", description: "Soft" }, { [P2]: { name: "", description: "மென்மையான", sourceName: "Cotton saree" } });
    expect(descOnly).toEqual({ id: P2, slug: "x", name: "Cotton saree", description: "மென்மையான" });
    // A translation without a description never blanks the English one.
    expect(applyTranslations({ id: P1, slug: "x", name: "Silk saree", description: "Nice" }, { [P1]: { name: "புடவை", description: null } })).toEqual({ id: P1, slug: "x", name: "புடவை", description: "Nice" });
  });

  it("lets the page meta follow the Tamil text instead of the English SEO title and description", () => {
    const en = { id: P1, slug: "s", name: "Silk saree", description: "Nice", seo: { title: "Buy silk saree", description: "English seo", noindex: false } };
    expect(applyTranslations(en, texts).seo).toEqual({ noindex: false });
    // No Tamil description: the English SEO description stays rather than leaving the page without one.
    expect(applyTranslations(en, { [P1]: { name: "புடவை", description: null } }).seo).toEqual({ noindex: false, description: "English seo" });
    expect(applyTranslations({ ...en, seo: null }, texts).seo).toBeNull();
  });

  it("leaves categories, variants and other ids alone", () => {
    const cat = { id: CAT, slug: "sarees", name: "Sarees" };
    expect(applyTranslations(cat, texts)).toEqual(cat);
  });

  it("translates cart lines, and order lines only while they still read the translated name", () => {
    const cartLine = { variantId: "v", productId: P1, productSlug: "silk-saree", name: "Silk saree", variantTitle: "Red" };
    expect(applyTranslations({ lines: [cartLine] }, texts)).toEqual({ lines: [{ ...cartLine, name: "பட்டுப் புடவை" }] });
    const orderLine = { variantId: "v", productId: P1, name: "Silk saree", qty: 1 };
    expect(applyTranslations({ lines: [orderLine] }, texts).lines[0]!.name).toBe("பட்டுப் புடவை");
    const renamed = { ...orderLine, name: "Silk saree - Red" };
    expect(applyTranslations({ lines: [renamed] }, texts).lines[0]!.name).toBe("Silk saree - Red");
  });

  it("does not mutate the input and keeps dates", () => {
    const at = new Date();
    const input = { id: P1, slug: "s", name: "Silk saree", createdAt: at };
    const out = applyTranslations(input, texts);
    expect(input.name).toBe("Silk saree");
    expect(out.createdAt).toBe(at);
  });
});

describe("collectProductIds", () => {
  it("finds product ids in nested answers", () => {
    expect(collectProductIds({ items: [{ id: P1, slug: "a", name: "A" }, { id: CAT, slug: "c", name: "C" }], lines: [{ productId: P2, name: "B" }] }).sort()).toEqual([P1, P2, CAT].sort());
    expect(collectProductIds({ ok: true })).toEqual([]);
  });
});

describe("wantsTranslation", () => {
  it("only translates Tamil requests on shopper-facing routes", () => {
    expect(wantsTranslation("GET", "/v1/catalog/public/products/:slug", "ta")).toBe(true);
    expect(wantsTranslation("GET", "/v1/store/cart/:token", "ta")).toBe(true);
    expect(wantsTranslation("GET", "/v1/catalog/public/products/:slug", "en")).toBe(false);
    expect(wantsTranslation("GET", "/v1/catalog/products/:id", "ta")).toBe(false); // staff side
    expect(wantsTranslation("GET", "/v1/ai/assist/translations", "ta")).toBe(false);
  });
});

describe("createStoreLocalizer", () => {
  const req = (locale: string, url = "/v1/catalog/public/products/:slug", tenant: { id: string } | null = { id: "t1" }) =>
    ({ method: "GET", routeOptions: { url }, ctx: { locale, tenant } }) as never;
  const reply = { statusCode: 200 } as never;
  const body = () => ({ id: P1, slug: "s", name: "Silk saree", description: "Nice" });

  it("looks the ids up once and translates a Tamil request", async () => {
    const lookup = vi.fn(async () => texts);
    const { preSerialization } = createStoreLocalizer({ lookup });
    const out = (await preSerialization(req("ta"), reply, body())) as { name: string };
    expect(out.name).toBe("பட்டுப் புடவை");
    expect(lookup).toHaveBeenCalledWith("t1", [P1], "ta");
  });

  it("does not touch English requests (no lookup) and survives a failing lookup", async () => {
    const lookup = vi.fn(async () => texts);
    const { preSerialization } = createStoreLocalizer({ lookup });
    const en = body();
    expect(await preSerialization(req("en"), reply, en)).toBe(en);
    expect(lookup).not.toHaveBeenCalled();
    const warn = vi.fn();
    const broken = createStoreLocalizer({ lookup: async () => { throw new Error("db down"); }, log: { warn } });
    const same = body();
    expect(await broken.preSerialization(req("ta"), reply, same)).toBe(same);
    expect(warn).toHaveBeenCalled();
  });
});
