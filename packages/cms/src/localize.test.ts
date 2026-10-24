import { describe, expect, it } from "vitest";
import { homeDocSchema } from "./content";
import { localizeSections, overlayWords } from "./localize";

const hero = {
  type: "hero" as const,
  id: "h",
  slides: [
    { imageUrl: "https://x.test/a.jpg", heading: "Build it right", subheading: "Cement to taps", cta: { label: "Get a quote", href: "/pages/quote" } },
    { imageUrl: "https://x.test/b.jpg", heading: "Second", cta: { label: "Shop", href: "/products" } },
  ],
};
const faq = { type: "faq" as const, id: "f", title: "Questions", items: [{ q: "Do you deliver?", a: "Yes." }, { q: "GST bill?", a: "Always." }] };

describe("home translations", () => {
  it("replaces only words, by key and by position", () => {
    const t = { ta: { h: { slides: [{ heading: "சரியாகக் கட்டுங்கள்", cta: { label: "விலைப்புள்ளி", href: "https://evil.test" } }] }, f: { items: [{}, { a: "எப்போதும்." }] } } };
    const [h] = localizeSections([hero], t, "ta");
    const [f] = localizeSections([faq], t, "ta");
    expect(h!.slides[0]).toEqual({ ...hero.slides[0], heading: "சரியாகக் கட்டுங்கள்", cta: { label: "விலைப்புள்ளி", href: "/pages/quote" } });
    expect(h!.slides[1]).toBe(hero.slides[1]);
    expect(f!.items).toEqual([{ q: "Do you deliver?", a: "Yes." }, { q: "GST bill?", a: "எப்போதும்." }]);
    expect(f!.title).toBe("Questions");
  });

  it("never touches links, pictures, ids, references or catalogue data, and ignores unknown keys and empty words", () => {
    const s = { id: "c", type: "collection", title: "Plumbing", collectionSlug: "plumbing", products: [{ name: "PVC pipe" }], imageUrl: "u" };
    const out = overlayWords(s, { id: "x", type: "faq", title: " ", collectionSlug: "other", products: [{ name: "பைப்" }], imageUrl: "v", extra: "y" });
    expect(out).toBe(s);
  });

  it("leaves English, other locales and sections without an id or a translation alone", () => {
    const t = { ta: { h: { slides: [{ heading: "த" }] } } };
    expect(localizeSections([hero], t, "en")[0]).toBe(hero);
    expect(localizeSections([hero], t, "hi")[0]).toBe(hero);
    expect(localizeSections([hero], undefined, "ta")[0]).toBe(hero);
    expect(localizeSections([{ ...hero, id: undefined }], t, "ta")[0]!.slides[0]!.heading).toBe("Build it right");
  });

  it("the home document keeps translations and rejects ones that aren't words", () => {
    const doc = homeDocSchema.parse({ sections: [hero], translations: { ta: { h: { slides: [{ heading: "த" }] } } } });
    expect(doc.translations?.ta?.h).toEqual({ slides: [{ heading: "த" }] });
    expect(homeDocSchema.safeParse({ sections: [], translations: { ta: { h: { heading: 5 } } } }).success).toBe(false);
    expect(homeDocSchema.safeParse({ sections: [], translations: { ta: { h: { heading: "x".repeat(200_001) } } } }).success).toBe(false);
    expect(homeDocSchema.parse({ sections: [hero] }).translations).toBeUndefined();
  });
});
