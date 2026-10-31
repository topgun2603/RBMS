import { describe, expect, it } from "vitest";
import { HOME_SECTION_TYPES, homeSectionSchema, type HomeSectionType } from "./content";
import { IDS, SECTION_FIXTURES } from "./fixtures";
import { flagHidden, itemsFromSections, sectionsFromItems } from "./hidden";
import {
  checkSection,
  duplicateSectionForm,
  emptyDish,
  emptyStyle,
  fromStyleForm,
  isDefaultStyle,
  isoToLocalInput,
  localInputToIso,
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
    "newArrivals",
    "offerEyebrow",
    "offerHeading",
    "offerText",
    "galleryTitle",
    "logosTitle",
    "faqTitle",
    "faqQ",
    "faqA",
    "locationTitle",
    "hoursWeek",
    "hoursWeekValue",
    "menuTitle",
    "menuGroup",
    "menuDish",
    "appointmentHeading",
    "appointmentText",
    "enquiryHeading",
    "enquiryText",
    "serviceName",
    "book",
    "beforeAfterTitle",
    "goldTitle",
    "goldText",
    "instagramTitle",
    "tabsTitle",
    "lookTitle",
    "bestsellersTitle",
    "recommendedTitle",
    "statsTitle",
    "statYears",
    "statCustomers",
    "timelineTitle",
    "timelineFirst",
    "timelineToday",
    "teamTitle",
    "memberRole",
    "pricingTitle",
    "planBasic",
    "planPopular",
    "planFeature",
    "blogTitle",
    "reviewsTitle",
    "flashTitle",
    "finderTitle",
    "finderQuestion",
    "finderOptionA",
    "finderOptionB",
    "storiesTitle",
    "shelfTitle",
    "storyTitle",
    "chapterHeading",
    "compareTitle",
    "compareRow",
    "tilesTitle",
    "tileLabel",
    "sizeTitle",
    "sizeMen",
    "sizeWomen",
    "sizeKids",
    "swatchesTitle",
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
    const all = fromSectionForm({ type: "categories", title: "", mode: "all", categoryIds: [IDS.C1], layout: "circles", showCounts: false, columns: "auto" });
    expect(all).toEqual({ type: "categories", title: "", layout: "circles", showCounts: false });
    const pick = fromSectionForm({ type: "categories", title: "", mode: "pick", categoryIds: [IDS.C2, IDS.C1], layout: "cards", showCounts: true, columns: "auto" });
    expect(pick).toMatchObject({ categoryIds: [IDS.C2, IDS.C1] });
  });

  it("category layouts and columns round-trip; auto columns aren't stored", () => {
    for (const layout of ["circles", "rounded-squares", "story-rings", "pills", "tiles", "banner-row", "bento", "minimal-list", "big-grid"] as const) {
      const stored = { type: "categories" as const, title: "Shop", layout, showCounts: true, columns: "5" as const };
      const form = toSectionForm(stored);
      expect(form).toMatchObject({ layout, columns: "5", showCounts: true });
      expect(fromSectionForm(form)).toEqual(stored);
    }
    // Older stored sections (no columns) read as auto and save without the field.
    const old = toSectionForm({ type: "categories", title: "", layout: "cards", showCounts: false });
    expect(old).toMatchObject({ columns: "auto" });
    expect(fromSectionForm(old)).not.toHaveProperty("columns");
    expect(newSectionForm("categories", samples, "c")).toMatchObject({ layout: "circles", columns: "auto" });
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
    if (f.type === "hero-video") return { ...f, videoUrl: "https://cdn.example.in/v.mp4" };
    if (f.type === "gallery") return { ...f, images: [{ url: img, alt: "", caption: "", href: "" }] };
    if (f.type === "logos") return { ...f, items: [{ imageUrl: img, name: "Brand", href: "" }] };
    if (f.type === "before-after") return { ...f, beforeUrl: img, afterUrl: img };
    if (f.type === "instagram") return { ...f, handle: "@shop", images: [{ url: img, alt: "", href: "" }] };
    if (f.type === "deal") return { ...f, productId: IDS.P1 };
    if (f.type === "shop-the-look") return { ...f, imageUrl: img, hotspots: [{ x: "40", y: "60.5", productId: IDS.P1 }] };
    if (f.type === "finder") return { ...f, questions: f.questions.map((q) => ({ ...q, options: q.options.map((o, i) => ({ ...o, filterName: "Age", filterValue: String(i) })) })) };
    if (f.type === "stories") return { ...f, items: [{ imageUrl: img, videoUrl: "", title: "New in", text: "", href: "", ctaLabel: "" }] };
    if (f.type === "sticky-story") return { ...f, chapters: f.chapters.map((c) => ({ ...c, imageUrl: img })) };
    if (f.type === "comparison") return { ...f, productIds: [IDS.P1, IDS.P2] };
    if (f.type === "swatches") return { ...f, productIds: [IDS.P1] };
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

describe("logos without pictures", () => {
  it("a name-only logo saves without an imageUrl and validates (a wordmark in the store)", () => {
    const f = newSectionForm("logos", samples, "s-logos");
    if (f.type !== "logos") throw new Error("type");
    const out = fromSectionForm({ ...f, items: [{ imageUrl: "", name: "Wella", href: "" }, { imageUrl: "  ", name: "Schwarzkopf", href: "/search?q=schwarzkopf" }] });
    expect(out).toMatchObject({ type: "logos", items: [{ name: "Wella" }, { name: "Schwarzkopf", href: "/search?q=schwarzkopf" }] });
    expect((out as { items: object[] }).items[0]).not.toHaveProperty("imageUrl");
    expect(homeSectionSchema.safeParse(out).success).toBe(true);
    expect(toSectionForm(homeSectionSchema.parse(out))).toMatchObject({ items: [{ imageUrl: "", name: "Wella" }, { imageUrl: "", name: "Schwarzkopf" }] });
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
    expect(formPath(["cta2", "href"])).toBe("cta2Href");
  });

  it("reports style, price and pin problems on their fields", () => {
    const base = newSectionForm("text", samples, "t");
    const r = checkSection({ ...base, style: { ...emptyStyle(), background: "image" } });
    expect(r.errors["style.imageUrl"]).toBe("required");
    const menu = newSectionForm("menu-board", samples, "m") as Extract<SectionForm, { type: "menu-board" }>;
    const bad = { ...menu, groups: [{ name: "Tiffin", items: [{ ...emptyDish(), name: "Idli", price: "abc" }] }] };
    expect(checkSection(bad).errors["groups.0.items.0.price"]).toBeTruthy();
    const loc = newSectionForm("location", samples, "l") as Extract<SectionForm, { type: "location" }>;
    expect(checkSection({ ...loc, coords: "Madurai" }).errors.coords).toBe("invalid");
    expect(checkSection({ ...loc, coords: "9.9252, 78.1198" }).ok).toBe(true);
  });
});

describe("section style form", () => {
  it("sends only what differs from the theme; picture + overlay only for a picture background", () => {
    expect(fromStyleForm(emptyStyle())).toBeUndefined();
    expect(fromSectionForm({ ...newSectionForm("text", samples, "t"), style: emptyStyle() })).not.toHaveProperty("style");
    expect(fromStyleForm({ ...emptyStyle(), background: "dark", imageUrl: "/left-over.jpg", overlay: "30", padding: "spacious", hideOnMobile: true })).toEqual({
      background: "dark",
      padding: "spacious",
      hideOnMobile: true,
    });
    expect(fromStyleForm({ ...emptyStyle(), background: "image", imageUrl: "/bg.jpg", overlay: "30" })).toEqual({ background: "image", imageUrl: "/bg.jpg", overlay: 30 });
    expect(isDefaultStyle(undefined)).toBe(true);
  });

  it("round-trips through the schema on every section type", () => {
    const style = { background: "gradient", padding: "compact", width: "contained", align: "center", animation: "fade", hideOnDesktop: true } as const;
    for (const fx of SECTION_FIXTURES) {
      const parsed = homeSectionSchema.parse({ ...fx, style });
      const form = toSectionForm(parsed);
      expect(form.style).toMatchObject({ background: "gradient", padding: "compact", hideOnDesktop: true, hideOnMobile: false });
      expect(homeSectionSchema.parse(fromSectionForm(form))).toEqual(parsed);
    }
  });

  it("the preview carries the style", () => {
    const f = { ...newSectionForm("faq", samples, "f"), style: { ...emptyStyle(), background: "muted" as const } };
    expect(resolvePreview([f], { products: new Map(), collections: new Map() })[0]).toMatchObject({ type: "faq", style: { background: "muted" } });
  });
});

describe("new section form details", () => {
  it("prices are typed in rupees and stored in paise", () => {
    const f = newSectionForm("appointment", samples, "a") as Extract<SectionForm, { type: "appointment" }>;
    const out = fromSectionForm({ ...f, services: [{ name: "Haircut", duration: "45 min", price: "₹1,250.50" }] }) as { services: { price: number }[] };
    expect(out.services[0]!.price).toBe(125050);
    const back = toSectionForm(homeSectionSchema.parse(out)) as Extract<SectionForm, { type: "appointment" }>;
    expect(back.services[0]!.price).toBe("1250.5");
  });

  it("the offer end time is edited in local time and saved as ISO", () => {
    const iso = "2026-11-01T18:30:00.000Z";
    const local = isoToLocalInput(iso);
    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(localInputToIso(local)).toBe(iso);
    expect(isoToLocalInput("nonsense")).toBe("");
  });

  it("a category mosaic needs categories loaded for the preview", () => {
    expect(referencedIds([newSectionForm("category-mosaic", samples, "c")]).categories).toBe(true);
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
        { type: "newsletter", heading: "b", text: "", layout: "band" },
      ],
      [{ hidden: false }, { hidden: true }],
    );
    expect(out[0]).not.toHaveProperty("hidden");
    expect(out[1]).toMatchObject({ type: "newsletter", hidden: true });
  });
});

describe("shelf, story and layout forms", () => {
  it("pricing features are one per line; one highlighted plan; prices in rupees", () => {
    const f = toSectionForm({ type: "pricing-table", plans: [{ name: "Gold", price: 250050, features: ["Locker", "Steam"], highlight: true }] });
    expect(f).toMatchObject({ plans: [{ price: "2500.5", features: "Locker\nSteam", highlight: true }] });
    const back = fromSectionForm({ ...(f as Extract<SectionForm, { type: "pricing-table" }>), plans: [{ ...(f as Extract<SectionForm, { type: "pricing-table" }>).plans[0]!, features: " Locker \n\n Steam\n" }] });
    expect(back).toMatchObject({ plans: [{ price: 250050, features: ["Locker", "Steam"] }] });
    const two = checkSection(toSectionForm({ type: "pricing-table", plans: [{ name: "A", highlight: true }, { name: "B", highlight: true }] } as never));
    expect(two.ok).toBe(false);
  });

  it("stats accept typed thousands separators; hotspots and limits go back as numbers", () => {
    const stats = fromSectionForm({ type: "stats", title: "", text: "", items: [{ value: "10,000", prefix: "", suffix: "+", label: "Customers" }] });
    expect(stats).toMatchObject({ items: [{ value: 10000, suffix: "+" }] });
    const look = fromSectionForm({ type: "shop-the-look", title: "", text: "", imageUrl: "/l.jpg", alt: "", hotspots: [{ x: "12.5", y: "80", productId: IDS.P1 }] });
    expect(look).toMatchObject({ hotspots: [{ x: 12.5, y: 80, productId: IDS.P1 }] });
    expect(checkSection({ type: "bestsellers", title: "", layout: "grid", limit: "40" }).ok).toBe(false);
  });

  it("the preview attaches loaded products to a deal and to look dots", () => {
    const p = { id: IDS.P1, name: "Saree", slug: "saree", categoryId: null, categoryName: null, image: null, priceMin: 100, priceMax: 100, mrp: null, variantCount: 1, taxInclusive: true };
    const [deal, look] = resolvePreview(
      [
        { type: "deal", id: "d", title: "", text: "", productId: IDS.P1, endsAt: "" },
        { type: "shop-the-look", id: "l", title: "", text: "", imageUrl: "/l.jpg", alt: "", hotspots: [{ x: "10", y: "20", productId: IDS.P1 }, { x: "1", y: "1", productId: IDS.P2 }] },
      ],
      { products: new Map([[IDS.P1, p]]), collections: new Map() },
    );
    expect(deal).toMatchObject({ type: "deal", product: { id: IDS.P1 } });
    expect(look).toMatchObject({ hotspots: [{ x: 10, y: 20, product: { id: IDS.P1 } }] });
    expect((look as { hotspots: unknown[] }).hotspots).toHaveLength(1);
    expect(referencedIds([{ type: "deal", title: "", text: "", productId: IDS.P2, endsAt: "" }]).products).toEqual([IDS.P2]);
  });
});

describe("enquiry-form section form", () => {
  it("choices are one per line; blanks are dropped and the labels follow their fields", () => {
    const f = newSectionForm("enquiry-form", samples, "e") as Extract<SectionForm, { type: "enquiry-form" }>;
    const out = fromSectionForm({ ...f, options: "LKG\n\n Class 1 \n", optionLabel: "Class", askStudent: false, studentLabel: "ignored" }) as Record<string, unknown>;
    expect(out).toMatchObject({ type: "enquiry-form", options: ["LKG", "Class 1"], optionLabel: "Class", askEmail: true, askMessage: true });
    expect(out).not.toHaveProperty("studentLabel");
    const back = toSectionForm(homeSectionSchema.parse(out)) as Extract<SectionForm, { type: "enquiry-form" }>;
    expect(back.options).toBe("LKG\nClass 1");
  });
});
