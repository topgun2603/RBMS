import { describe, expect, it } from "vitest";
import { HOME_SECTION_TYPES, homeSectionSchema, type HomeSectionType } from "./content";
import { IDS, SECTION_FIXTURES } from "./fixtures";
import { flagHidden, itemsFromSections, sectionsFromItems } from "./hidden";
import {
  checkSection,
  duplicateSectionForm,
  formPath,
  fromSectionForm,
  newSectionForm,
  referencedIds,
  resolvePreview,
  toSectionForm,
  uspIconKey,
  type SectionForm,
  type SectionSamples,
} from "./sections";

const samples = Object.fromEntries(
  [
    "heroHeading",
    "heroSubheading",
    "shopNow",
    "categoriesTitle",
    "productsTitle",
    "textHeading",
    "textBody",
    "imageTextHeading",
    "testimonialsTitle",
    "testimonialQuote",
    "testimonialName",
    "uspFreeShipping",
    "uspFreeShippingText",
    "uspCod",
    "uspCodText",
    "uspReturns",
    "uspReturnsText",
    "newsletterHeading",
    "newsletterText",
  ].map((k) => [k, `sample ${k}`]),
) as unknown as SectionSamples;

describe("section form ↔ schema round-trips", () => {
  for (const fixture of SECTION_FIXTURES) {
    it(`${fixture.type}${fixture.id ? ` (${fixture.id})` : ""} survives schema → form → schema`, () => {
      const parsed = homeSectionSchema.parse(fixture);
      const form = toSectionForm(parsed);
      const back = homeSectionSchema.parse(fromSectionForm(form));
      expect(back).toEqual(parsed);
      // and the form is stable: form → schema → form gives the same form
      expect(toSectionForm(back)).toEqual(form);
    });
  }

  it("has a fixture for every section type", () => {
    expect(new Set(SECTION_FIXTURES.map((s) => s.type))).toEqual(new Set(HOME_SECTION_TYPES));
  });

  it("omits blank optional fields instead of sending empty strings", () => {
    const f = toSectionForm({ type: "hero", slides: [{ imageUrl: "https://x.in/a.jpg" }] });
    expect(fromSectionForm(f)).toEqual({ type: "hero", slides: [{ imageUrl: "https://x.in/a.jpg" }] });
    const b = fromSectionForm({ type: "banner", imageUrl: "https://x.in/b.jpg", mobileImageUrl: " ", href: "", alt: "" });
    expect(b).toEqual({ type: "banner", imageUrl: "https://x.in/b.jpg", alt: "" });
  });

  it("'All categories' drops picked ids; 'Choose' keeps their order", () => {
    const all = fromSectionForm({ type: "categories", title: "", mode: "all", categoryIds: [IDS.C1] });
    expect(all).toEqual({ type: "categories", title: "" });
    const pick = fromSectionForm({ type: "categories", title: "", mode: "pick", categoryIds: [IDS.C2, IDS.C1] });
    expect(pick).toMatchObject({ categoryIds: [IDS.C2, IDS.C1] });
  });

  it("sends the collection limit as a number", () => {
    const f = toSectionForm({ type: "collection", title: "", collectionSlug: "sale", layout: "carousel", limit: 12 });
    expect(f).toMatchObject({ limit: "12" });
    expect(fromSectionForm({ ...(f as Extract<SectionForm, { type: "collection" }>), limit: "6" })).toMatchObject({ limit: 6 });
  });
});

describe("new sections", () => {
  const fillImages = (f: SectionForm): SectionForm => {
    const img = "https://cdn.example.in/x.jpg";
    if (f.type === "hero") return { ...f, slides: f.slides.map((s) => ({ ...s, imageUrl: img })) };
    if (f.type === "banner" || f.type === "image-text") return { ...f, imageUrl: img };
    if (f.type === "collection") return { ...f, collectionSlug: "new-arrivals" };
    if (f.type === "products") return { ...f, productIds: [IDS.P1] };
    return f;
  };

  it.each(HOME_SECTION_TYPES.map((t) => [t]))("%s starts with a valid shape once its picture/target is chosen", (type) => {
    const f = newSectionForm(type as HomeSectionType, samples, "s-test");
    expect(f.type).toBe(type);
    expect(f.id).toBe("s-test");
    const check = checkSection(fillImages(f));
    expect(check.errors).toEqual({});
    expect(check.ok).toBe(true);
  });

  it("duplicates with a new id and a deep copy", () => {
    const f = newSectionForm("usp", samples, "a");
    const d = duplicateSectionForm(f, "b");
    expect(d.id).toBe("b");
    expect(d).not.toBe(f);
    (d as Extract<SectionForm, { type: "usp" }>).items[0]!.title = "changed";
    expect((f as Extract<SectionForm, { type: "usp" }>).items[0]!.title).not.toBe("changed");
  });
});

describe("validation errors map to form fields", () => {
  it("allows a hero without an image (branded gradient) but reports a half-filled button", () => {
    const blank = { imageUrl: "", mobileImageUrl: "", heading: "Hi", subheading: "", ctaLabel: "", ctaHref: "" };
    const ok = checkSection({ type: "hero", slides: [blank] });
    expect(ok.ok).toBe(true);
    expect(fromSectionForm({ type: "hero", slides: [blank] })).toEqual({ type: "hero", slides: [{ imageUrl: null, heading: "Hi" }] });
    const r = checkSection({ type: "hero", slides: [{ ...blank, ctaLabel: "Shop" }] });
    expect(r.ok).toBe(false);
    expect(r.errors["slides.0.imageUrl"]).toBeUndefined();
    expect(r.errors["slides.0.ctaHref"]).toBeTruthy();
  });

  it("flags unsafe links as url errors", () => {
    const r = checkSection({ type: "banner", imageUrl: "javascript:alert(1)", mobileImageUrl: "", href: "//evil.com", alt: "" });
    expect(r.errors.imageUrl).toBe("url");
    expect(r.errors.href).toBe("url");
  });

  it("needs at least one product and a collection slug", () => {
    expect(checkSection({ type: "products", title: "", productIds: [] }).errors.productIds).toBe("minItems");
    expect(checkSection({ type: "collection", title: "", collectionSlug: "", layout: "grid", limit: "4" }).errors.collectionSlug).toBeTruthy();
    expect(checkSection({ type: "collection", title: "", collectionSlug: "x", layout: "grid", limit: "99" }).errors.limit).toBe("tooBig");
  });

  it("flattens cta paths", () => {
    expect(formPath(["slides", 0, "cta", "href"])).toBe("slides.0.ctaHref");
    expect(formPath(["cta", "label"])).toBe("ctaLabel");
    expect(formPath(["items", 2, "quote"])).toBe("items.2.quote");
  });
});

describe("usp icons", () => {
  it("maps legacy keys to storefront icons", () => {
    expect(uspIconKey("truck")).toBe("truck");
    expect(uspIconKey("free-shipping")).toBe("truck");
    expect(uspIconKey("COD")).toBe("cash");
    expect(uspIconKey("returns")).toBe("return");
    expect(uspIconKey("rocket")).toBeNull();
  });
});

describe("live preview resolution", () => {
  const product = (id: string, name: string) => ({ id, name, slug: name.toLowerCase(), categoryId: null, categoryName: null, image: null, priceMin: 49900, priceMax: 49900, mrp: null });
  const lookups = {
    categories: [
      { id: IDS.C1, name: "Sarees", slug: "sarees", image: null },
      { id: IDS.C2, name: "Kurtis", slug: "kurtis", image: null },
    ],
    products: new Map([
      [IDS.P1, product(IDS.P1, "One")],
      [IDS.P2, product(IDS.P2, "Two")],
    ]),
    collections: new Map([["new-arrivals", { name: "New arrivals", slug: "new-arrivals", products: [product(IDS.P1, "One"), product(IDS.P2, "Two")] }]]),
  };

  it("fills catalogue sections in the chosen order and keeps static ones", () => {
    const forms = SECTION_FIXTURES.map((s) => toSectionForm(homeSectionSchema.parse(s)));
    const out = resolvePreview(forms, lookups);
    expect(out).toHaveLength(forms.length);
    const picked = out.find((s) => s.type === "categories" && s.id === "s-cats");
    expect(picked && "categories" in picked ? picked.categories.map((c) => c.name) : null).toEqual(["Kurtis", "Sarees"]);
    const products = out.find((s) => s.type === "products");
    expect(products && "products" in products ? products.products.map((p) => p.name) : null).toEqual(["Two", "One"]);
    const col = out.find((s) => s.type === "collection");
    expect(col && col.type === "collection" ? [col.title, col.products.length] : null).toEqual(["New arrivals", 2]);
    const text = out.find((s) => s.type === "text");
    expect(text).toMatchObject({ heading: "About us" });
  });

  it("caps collection products at the limit and uses the collection name as a fallback title", () => {
    const out = resolvePreview([{ type: "collection", title: "", collectionSlug: "new-arrivals", layout: "grid", limit: "1" }], lookups);
    expect(out[0]).toMatchObject({ title: "New arrivals" });
    expect(out[0]?.type === "collection" ? out[0].products : []).toHaveLength(1);
  });

  it("renders a hero without an image as a branded slide", () => {
    const out = resolvePreview([{ type: "hero", slides: [{ imageUrl: "", mobileImageUrl: "", heading: "Hi", subheading: "", ctaLabel: "", ctaHref: "" }] }], lookups);
    expect(out[0]).toEqual({ type: "hero", slides: [{ imageUrl: null, heading: "Hi" }] });
  });

  it("lists what the preview needs to load", () => {
    const forms = SECTION_FIXTURES.map((s) => toSectionForm(homeSectionSchema.parse(s)));
    const r = referencedIds(forms);
    expect(r.categories).toBe(true);
    expect(r.collections).toEqual(["new-arrivals"]);
    expect(r.products.sort()).toEqual([IDS.P1, IDS.P2].sort());
  });
});

describe("hidden sections (saved in the draft)", () => {
  const parsed = SECTION_FIXTURES.slice(0, 4).map((s) => homeSectionSchema.parse(s));

  it("reads the hidden flag from saved sections", () => {
    let k = 0;
    const items = itemsFromSections([parsed[0]!, { ...parsed[1]!, hidden: true }, parsed[2]!, { ...parsed[3]!, hidden: false }], () => `k${k++}`);
    expect(items.map((i) => [i.key, i.hidden])).toEqual([
      ["k0", false],
      ["k1", true],
      ["k2", false],
      ["k3", false],
    ]);
    expect(items.map((i) => i.form)).toEqual(parsed.map(toSectionForm));
  });

  it("toggling hidden updates the draft payload (all sections kept, in order)", () => {
    let k = 0;
    const items = itemsFromSections(parsed, () => `k${k++}`);
    const before = sectionsFromItems(items);
    expect(before.some((s) => "hidden" in s)).toBe(false);

    const toggled = items.map((it, i) => (i === 1 ? { ...it, hidden: !it.hidden } : it));
    const payload = sectionsFromItems(toggled);
    expect(payload).toHaveLength(parsed.length);
    expect(payload.map((s) => s.type)).toEqual(parsed.map((s) => s.type));
    expect(payload[1]).toMatchObject({ type: parsed[1]!.type, hidden: true });
    expect(payload.filter((s) => s.hidden)).toHaveLength(1);
    // the payload is what PUT /cms/home accepts, and reads back hidden
    for (const s of payload) expect(homeSectionSchema.safeParse(s).success).toBe(true);
    const again = itemsFromSections(payload.map((s) => homeSectionSchema.parse(s)), () => "x");
    expect(again.map((i) => i.hidden)).toEqual([false, true, false, false]);

    // showing it again drops the flag
    const shown = sectionsFromItems(toggled.map((it) => ({ ...it, hidden: false })));
    expect(shown).toEqual(before);
  });

  it("flags hidden sections in the local preview", () => {
    const out = flagHidden(
      [
        { type: "text", markdown: "a" },
        { type: "newsletter", heading: "b", text: "" },
      ],
      [{ hidden: false }, { hidden: true }],
    );
    expect(out[0]).not.toHaveProperty("hidden");
    expect(out[1]).toMatchObject({ type: "newsletter", hidden: true });
  });
});
