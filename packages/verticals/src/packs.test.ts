import { THEME_PRESETS } from "@rbms/branding";
import { describe, expect, it } from "vitest";
import { BUSINESS_TYPES, copyFor, DEFAULT_PACK_FOR_APP, packFor, packOrDefault, PACKS, starterHome } from "./index";

describe("business packs", () => {
  it("ships its solutions (15 trades + organic, footwear, stationery, toys, cosmetics + nine retail, food and wellness packs), each with a real theme preset and full copy in both languages", () => {
    expect(BUSINESS_TYPES).toHaveLength(30);
    expect(new Set(BUSINESS_TYPES).size).toBe(BUSINESS_TYPES.length);
    const presets = new Set(THEME_PRESETS.map((p) => p.id));
    for (const t of BUSINESS_TYPES) {
      const p = PACKS[t];
      expect(p.id).toBe(t);
      expect(presets.has(p.preset), `${t} preset ${p.preset}`).toBe(true);
      for (const lang of ["en", "ta"] as const) for (const [k, v] of Object.entries(p.copy[lang])) expect(v.trim(), `${t}.${lang}.${k}`).not.toBe("");
      expect(p.categories.length).toBeGreaterThan(2);
      expect(p.usps.length).toBeGreaterThan(0);
    }
  });

  it("only clothing, tailoring, footwear and sportswear get the size guide; no clothing words leak into other packs", () => {
    // Footwear's guide is the storefront's shoe chart (sizeKindFor picks it), not the clothing one; sports gets both.
    expect(BUSINESS_TYPES.filter((t) => PACKS[t].sizeGuide)).toEqual(["fashion", "tailoring", "footwear", "sports"]);
    for (const t of BUSINESS_TYPES.filter((t) => t !== "fashion")) expect(JSON.stringify(PACKS[t].copy.en), t).not.toMatch(/kurti|saree/i);
  });

  it("resolves aliases and falls back per app", () => {
    expect(packFor("Textiles")?.id).toBe("fashion");
    expect(packFor("medical")?.id).toBe("pharmacy");
    expect(packFor("cloud kitchen")?.id).toBe("cloud_kitchen");
    expect(packFor("other")).toBeNull();
    expect(packOrDefault(null, "RS").id).toBe("restaurant");
    expect(packOrDefault("", "PH").id).toBe("pharmacy");
    expect(copyFor(PACKS.grocery, "ta").search).toContain("அரிசி");
    for (const a of ["organic", "Millets", "naturals", "Organic store", "siruthaniyam"]) expect(packFor(a)?.id, a).toBe("organic");
  });

  it("organic: an EC store on the scales, local makers' badge, millets and oils sold by weight and volume", () => {
    const p = PACKS.organic;
    expect(p).toMatchObject({ appId: "EC", features: ["scales", "pos.weighing"], localMade: true, sizeGuide: false });
    expect(p.categories).toEqual(expect.arrayContaining(["Millets", "Cold-pressed oils", "Country sugar & jaggery"]));
    expect(p.editor.options).toEqual(expect.arrayContaining(["Weight", "Volume"]));
    expect(copyFor(p, "ta").search).toContain("சிறுதானியம்");
  });
  it("footwear, stationery, toys, cosmetics: EC stores with their own words, editor hints and aliases", () => {
    const want = { footwear: ["shoes", "Chappal", "slippers", "sandals", "shoe shop"], stationery: ["books", "school supplies", "office supplies", "Book shop"], toys: ["toy", "games", "kids toys", "Toy store"], cosmetics: ["cosmetic", "makeup", "skincare", "parlour products", "beauty products"] } as const;
    for (const [id, aliases] of Object.entries(want)) {
      const p = PACKS[id as keyof typeof want];
      expect(p).toMatchObject({ id, appId: "EC", sizeGuide: id === "footwear" });
      expect(p.features ?? []).not.toContain("serials");
      expect(p.usps).toHaveLength(3);
      for (const u of p.usps) for (const lang of ["en", "ta"] as const) expect(u.title[lang] && u.text[lang], `${id} usp ${lang}`).toBeTruthy();
      expect(p.categories.length).toBeGreaterThanOrEqual(5);
      expect(copyFor(p, "ta").search).toMatch(/[஀-௿]/);
      for (const a of aliases) expect(packFor(a)?.id, a).toBe(id);
    }
    expect(PACKS.footwear.editor.options).toEqual(["Size", "Colour", "Width"]);
    expect(PACKS.stationery.editor.options).toEqual(["Pack size", "Colour", "Ruling"]);
    expect(PACKS.toys.editor.attributes).toContain("Safety (BIS/ISI)");
    expect(PACKS.cosmetics.editor.options).toEqual(["Shade", "Size"]);
    expect(packFor("beauty")?.id).toBe("salon");
    expect(packFor("xerox")).toBeNull();
  });

  it("crackers, florist & pooja, mobile accessories, furniture, home décor, pet shop, sports, tea stall, spa: own app, engines, words and aliases", () => {
    const want = {
      crackers: { app: "EC", aliases: ["pattasu", "fireworks", "Sivakasi", "fire crackers", "cracker shop"] },
      florist_pooja: { app: "EC", aliases: ["flowers", "Poo kadai", "garlands", "pooja store", "florist"] },
      mobile_accessories: { app: "EC", aliases: ["phone accessories", "mobile shop accessories", "Mobile accessories"] },
      furniture: { app: "EC", aliases: ["furnitures", "sofa shop", "Furniture store"] },
      home_decor: { app: "EC", aliases: ["decor", "handicrafts", "gift shop", "home decor"] },
      pet_shop: { app: "EC", aliases: ["pets", "pet store", "dog food", "Pet shop"] },
      sports: { app: "EC", aliases: ["sports goods", "sports shop", "Sports"] },
      tea_stall: { app: "RS", aliases: ["tea shop", "tea kadai", "juice shop", "juice bar", "coffee", "Tea stall"] },
      spa: { app: "SV", aliases: ["wellness", "massage", "ayurveda spa", "Spa"] },
    } as const;
    for (const [id, { app, aliases }] of Object.entries(want)) {
      const p = PACKS[id as keyof typeof want];
      expect(p).toMatchObject({ id, appId: app });
      expect(p.usps, id).toHaveLength(3);
      for (const u of p.usps) for (const lang of ["en", "ta"] as const) expect(u.title[lang] && u.text[lang], `${id} usp ${lang}`).toBeTruthy();
      expect(p.categories.length, id).toBeGreaterThanOrEqual(5);
      expect(p.categories.length, id).toBeLessThanOrEqual(7);
      // Its own words, not a copy of another pack's.
      for (const lang of ["en", "ta"] as const) for (const k of ["search", "heroHeading", "heroSubheading"] as const) {
        expect(BUSINESS_TYPES.filter((t) => PACKS[t].copy[lang][k] === p.copy[lang][k]), `${id}.${lang}.${k}`).toEqual([id]);
      }
      expect(copyFor(p, "ta").heroHeading).toMatch(/[஀-௿]/);
      for (const a of aliases) expect(packFor(a)?.id, a).toBe(id);
    }
    // Engines: flowers and garlands are weighed; nothing else here needs serials or scales.
    expect(PACKS.florist_pooja.features).toEqual(["scales", "pos.weighing"]);
    for (const id of ["crackers", "mobile_accessories", "furniture", "home_decor", "pet_shop", "sports", "tea_stall", "spa"] as const) expect(PACKS[id].features ?? [], id).toEqual([]);
    // Counter-first tea stall like the cloud kitchen; spa books like the salon, no job cards.
    expect(PACKS.tea_stall.off).toEqual(PACKS.cloud_kitchen.off);
    expect(PACKS.spa).toMatchObject({ ctaHref: "/book", off: ["jobcards"] });
    expect(PACKS.florist_pooja.editor.options).toEqual(expect.arrayContaining(["Weight", "Length"]));
    expect(PACKS.furniture.editor.attributes[0]).toMatch(/Dimensions/);
    expect(PACKS.crackers.editor.attributes).toContain("Green cracker");
    expect(PACKS.mobile_accessories.editor.options[0]).toBe("Phone model");
    expect(PACKS.crackers.localMade).toBe(true);
    // "spa" used to be a salon alias; it is its own pack now, beauty stays with the salon.
    expect(packFor("spa")?.id).toBe("spa");
    expect(packFor("fitness")?.id).toBe("gym");
    expect(packFor("mobile")?.id).toBe("electronics");
    expect(packFor("cafe")?.id).toBe("restaurant");
    // Starter homes: their own mix of sections, the tea stall's menu board, the spa's bookable services.
    const kinds = (id: keyof typeof want) => starterHome(PACKS[id], "Shop").map((s) => s.type).join(",");
    expect(new Set(Object.keys(want).map((id) => kinds(id as keyof typeof want))).size).toBe(Object.keys(want).length);
    const tea = starterHome(PACKS.tea_stall, "Shop", "ta").find((s) => s.type === "menu-board");
    expect(tea && "groups" in tea ? tea.groups.length : 0).toBe(3);
    const spa = starterHome(PACKS.spa, "Shop").find((s) => s.type === "appointment");
    expect(spa && "services" in spa ? spa.services.map((x) => x.name) : []).toContain("Foot reflexology");
    for (const id of Object.keys(want) as (keyof typeof want)[]) {
      const faq = starterHome(PACKS[id], "Shop", "ta").find((s) => s.type === "faq");
      expect(faq && "items" in faq ? faq.items.length : 0, id).toBe(3);
    }
  });

  it("school: a website on its own School app (SC), not a shop", () => {
    expect(PACKS.school).toMatchObject({ appId: "SC", site: true, ctaHref: "/admissions", preset: "campus-navy" });
    expect(PACKS.school.off).not.toContain("bookings");
    expect(DEFAULT_PACK_FOR_APP.SC).toBe("school");
    expect(Object.values(PACKS).filter((p) => p.site).map((p) => p.id)).toEqual(["school"]);
    for (const a of ["School", "matric school", "CBSE school", "play school", "Montessori", "hr-sec-school"]) expect(packFor(a)?.id, a).toBe("school");
    const home = starterHome(PACKS.school, "Thamarai School");
    expect(home.map((x) => x.type)).toContain("appointment");
    expect(home.map((x) => x.type)).toContain("faq");
  });
});
