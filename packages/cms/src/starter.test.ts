import { BUSINESS_TYPES, PACKS, starterHome } from "@srirealtime/verticals";
import { describe, expect, it } from "vitest";
import { homeDocSchema, homeSectionSchema } from "./content";

describe("business pack starter homes", () => {
  it("every pack's starter home is valid CMS content, in both languages", () => {
    for (const t of BUSINESS_TYPES) {
      for (const lang of ["en", "ta"] as const) {
        for (const s of starterHome(PACKS[t], "Test Shop", lang)) {
          const r = homeSectionSchema.safeParse(s);
          expect(r.success, `${t} ${lang} ${s.type} ${r.success ? "" : JSON.stringify(r.error.issues)}`).toBe(true);
        }
        expect(homeDocSchema.safeParse({ sections: starterHome(PACKS[t], "Test Shop", lang) }).success).toBe(true);
      }
    }
  });

  it("gives each trade its own mix of sections", () => {
    const types = (t: (typeof BUSINESS_TYPES)[number]) => starterHome(PACKS[t], "Shop").map((s) => s.type);
    expect(types("jewellery")).toEqual(["hero-split", "gold-rates", "category-mosaic", "testimonials", "location", "newsletter"]);
    expect(types("gym")).toEqual(expect.arrayContaining(["hero", "appointment", "testimonials", "faq", "location"]));
    expect(types("restaurant")).toEqual(expect.arrayContaining(["hero", "menu-board", "location"]));
    for (const t of BUSINESS_TYPES) expect(types(t).length, t).toBeGreaterThanOrEqual(5);
  });

  it("starts the owner's own claims hidden (customer words, prices, answers) and books through /book", () => {
    for (const t of BUSINESS_TYPES) {
      for (const s of starterHome(PACKS[t], "Shop")) {
        if (s.type === "testimonials" || s.type === "menu-board" || s.type === "faq") expect(s.hidden, `${t} ${s.type}`).toBe(true);
        if (s.type === "appointment") expect(s.cta.href).toBe("/book");
      }
    }
  });

  it("keeps a long shop name inside the limits", () => {
    const long = "A".repeat(140);
    for (const s of starterHome(PACKS.jewellery, long)) expect(homeSectionSchema.safeParse(s).success, s.type).toBe(true);
  });
});
