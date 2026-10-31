import { THEME_PRESETS } from "@rbms/branding";
import { describe, expect, it } from "vitest";
import { APP_IDS, BUSINESS_TYPES, copyFor, DEFAULT_PACK_FOR_APP, GENERAL_PACKS, isGeneralPack, PACK_GROUPS, packFor, packOrDefault, packPickerGroups, packsByGroup, PACKS, resolvePack, SIZE_GUIDES, starterHome } from "./index";

describe("business packs", () => {
  it("ships its solutions (batches 1 to 10 and the three general packs), each with a group, a real theme preset and full copy in both languages", () => {
    expect(BUSINESS_TYPES.length).toBeGreaterThanOrEqual(52);
    expect(Object.keys(PACKS).sort()).toEqual([...BUSINESS_TYPES].sort());
    expect(new Set(BUSINESS_TYPES).size).toBe(BUSINESS_TYPES.length);
    const presets = new Set(THEME_PRESETS.map((p) => p.id));
    for (const t of BUSINESS_TYPES) {
      const p = PACKS[t];
      expect(p.id).toBe(t);
      expect(PACK_GROUPS, `${t} group`).toContain(p.group);
      expect(APP_IDS, `${t} app`).toContain(p.appId);
      expect(presets.has(p.preset), `${t} preset ${p.preset}`).toBe(true);
      for (const lang of ["en", "ta"] as const) for (const [k, v] of Object.entries(p.copy[lang])) expect(v.trim(), `${t}.${lang}.${k}`).not.toBe("");
      expect(p.categories.length).toBeGreaterThan(2);
      expect(p.usps.length).toBeGreaterThan(0);
    }
  });

  it("only clothing, tailoring, footwear and sportswear get the size guide; no clothing words leak into other packs", () => {
    // Footwear's guide is the storefront's shoe chart (sizeKindFor picks it), not the clothing one; sports gets both.
    expect(BUSINESS_TYPES.filter((t) => PACKS[t].sizeGuide)).toEqual(["fashion", "tailoring", "footwear", "sports"]);
    // The guide is a kind, not a flag: footwear has the shoe chart, the clothing trades the clothing ones, the rest none.
    expect(Object.fromEntries(BUSINESS_TYPES.filter((t) => PACKS[t].sizeGuide).map((t) => [t, PACKS[t].sizeGuide]))).toEqual({ fashion: "clothing", tailoring: "clothing", footwear: "shoes", sports: "clothing" });
    expect(BUSINESS_TYPES.filter((t) => !PACKS[t].sizeGuide).every((t) => PACKS[t].sizeGuide === null)).toBe(true);
    for (const t of BUSINESS_TYPES) expect([null, ...SIZE_GUIDES], t).toContain(PACKS[t].sizeGuide);
    for (const t of BUSINESS_TYPES.filter((t) => t !== "fashion")) expect(JSON.stringify(PACKS[t].copy.en), t).not.toMatch(/kurti|saree/i);
  });

  it("resolves aliases and falls back per app", () => {
    expect(packFor("Textiles")?.id).toBe("fashion");
    expect(packFor("medical")?.id).toBe("pharmacy");
    expect(packFor("cloud kitchen")?.id).toBe("cloud_kitchen");
    expect(packFor("other")).toBeNull();
    expect(packFor("zzz unknown trade")).toBeNull();
    expect(packOrDefault(null, "RS").id).toBe("restaurant");
    expect(packOrDefault("", "PH").id).toBe("pharmacy");
    expect(copyFor(PACKS.grocery, "ta").search).toContain("அரிசி");
    for (const a of ["organic", "Millets", "naturals", "Organic store", "siruthaniyam"]) expect(packFor(a)?.id, a).toBe("organic");
  });

  it("organic: an EC store on the scales, local makers' badge, millets and oils sold by weight and volume", () => {
    const p = PACKS.organic;
    expect(p).toMatchObject({ appId: "EC", features: ["scales", "pos.weighing"], localMade: true, sizeGuide: null });
    expect(p.categories).toEqual(expect.arrayContaining(["Millets", "Cold-pressed oils", "Country sugar & jaggery"]));
    expect(p.editor.options).toEqual(expect.arrayContaining(["Weight", "Volume"]));
    expect(copyFor(p, "ta").search).toContain("சிறுதானியம்");
  });
  it("footwear, stationery, toys, cosmetics: EC stores with their own words, editor hints and aliases", () => {
    const want = { footwear: ["shoes", "Chappal", "slippers", "sandals", "shoe shop"], stationery: ["books", "school supplies", "office supplies", "Book shop"], toys: ["toy", "games", "kids toys", "Toy store"], cosmetics: ["cosmetic", "makeup", "skincare", "parlour products", "beauty products"] } as const;
    for (const [id, aliases] of Object.entries(want)) {
      const p = PACKS[id as keyof typeof want];
      expect(p).toMatchObject({ id, appId: "EC", sizeGuide: id === "footwear" ? "shoes" : null });
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
    expect(packFor("xerox")?.id).toBe("print_shop");
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
  it("groups: every pack is in one group, the picker lists them in order and leaves out empty groups", () => {
    const groups = packsByGroup();
    expect(groups.map((g) => g.group)).toEqual(PACK_GROUPS.filter((g) => BUSINESS_TYPES.some((t) => PACKS[t].group === g)));
    expect(groups.flatMap((g) => g.packs.map((p) => p.id)).sort()).toEqual([...BUSINESS_TYPES].sort());
    expect(groups.find((g) => g.group === "general")?.packs.map((p) => p.id)).toEqual([...GENERAL_PACKS]);
    expect(PACKS.pharmacy.group).toBe("health");
    expect(PACKS.restaurant.group).toBe("food");
    expect(PACKS.school.group).toBe("education");
    expect(PACKS.hardware.group).toBe("building");
    expect(packsByGroup((p) => p.appId === "SV").every((g) => g.packs.every((p) => p.appId === "SV"))).toBe(true);
  });

  it("general packs: one per app with neutral words and no trade engines; an unknown trade lands on the one for its app", () => {
    expect(GENERAL_PACKS.map((id) => PACKS[id].appId)).toEqual(["EC", "BL", "SV"]);
    expect(DEFAULT_PACK_FOR_APP).toEqual({ EC: "general_shop", BL: "general_counter", SV: "general_services", PH: "pharmacy", RS: "restaurant", SC: "school" });
    for (const id of GENERAL_PACKS) {
      const p = PACKS[id];
      expect(p.group).toBe("general");
      expect(p.features ?? [], id).toEqual([]);
      expect(p.off ?? [], id).toEqual([]);
      expect(p.sizeGuide || p.localMade).toBe(false);
      expect(isGeneralPack(id)).toBe(true);
    }
    expect(PACKS.general_shop.copy.en.categoriesTitle).toBe("Our products");
    expect(PACKS.general_shop.copy.en.cta).toBe("Order now");
    expect(PACKS.general_services.copy.en.cta).toBe("Book now");
    expect(PACKS.general_services.ctaHref).toBe("/book");
    expect(isGeneralPack("pharmacy")).toBe(false);
    expect(isGeneralPack(null)).toBe(false);
    for (const [app, id] of [["EC", "general_shop"], ["BL", "general_counter"], ["SV", "general_services"]] as const) {
      expect(packOrDefault("some trade nobody listed", app).id).toBe(id);
      expect(packOrDefault(undefined, app).id).toBe(id);
    }
    // PH and RS keep their own trade: the app itself sets it.
    expect(packOrDefault("something odd", "PH").id).toBe("pharmacy");
    expect(packOrDefault("something odd", "RS").id).toBe("restaurant");
    expect(packOrDefault("something odd", null).id).toBe("general_shop");
  });

  it("resolvePack: the chosen pack, else what the owner typed (through the aliases), else the app's default", () => {
    expect(resolvePack("grocery", "my kirana", "EC").id).toBe("grocery");
    expect(resolvePack("", "Lodge", "SV").id).toBe("general_services");
    expect(resolvePack(null, "tuition centre", "SV").id).toBe("tuition");
    expect(resolvePack("nonsense", "xerox", "BL").id).toBe("print_shop");
    expect(resolvePack("", "Space rockets", "EC").id).toBe("general_shop");
    expect(resolvePack(null, null, "BL").id).toBe("general_counter");
  });

  it("aliases: common typed trades land on the nearest pack, or on a general pack until the trade has its own", () => {
    const want: Record<string, string> = {
      lodge: "general_services", "guest house": "general_services", hospital: "general_services", "travel agency": "general_services",
      milk: "grocery", dairy: "grocery", "milk booth": "grocery",
      xerox: "print_shop", "Xerox shop": "print_shop", flex: "print_shop", "visiting cards": "print_shop", "cyber cafe": "print_shop",
      "driving school": "driving_school", "Motor driving school": "driving_school",
      florist: "florist_pooja", footwear: "footwear", stationery: "stationery", Tuition: "tuition", "tuition centre": "tuition", coaching: "tuition",
      "dance classes": "dance_music", "music school": "dance_music", Bharatanatyam: "dance_music", "yoga centre": "yoga", meditation: "yoga",
      caterers: "catering", "tiffin service": "catering", "dog grooming": "pet_grooming", "photo studio": "photo_studio", photographer: "photo_studio",
      "dry cleaning": "laundry", dhobi: "laundry", "ironing shop": "laundry", "event management": "event_decor", decorators: "event_decor", "tent house": "event_decor",
      "AC repair": "ac_service", "fridge repair": "ac_service", "water purifier": "ac_service",
      "paint shop": "paints", electricals: "electricals", "electrical shop": "electricals", tiles: "tiles_sanitary", sanitaryware: "tiles_sanitary",
      "wholesale cloth": "textiles_wholesale", "textile wholesale": "textiles_wholesale", "cloth store": "fashion",
      wholesale: "general_counter", "retail shop": "general_shop", barber: "salon", "beauty parlour": "salon", "mobile repair": "repair",
    };
    for (const [typed, id] of Object.entries(want)) expect(packFor(typed)?.id, typed).toBe(id);
    // Whatever the trade, a typed label always resolves to a real pack for the app.
    for (const app of APP_IDS) for (const typed of ["lodge", "tuition", "xerox", "????", "a very long trade nobody has heard of"]) expect(BUSINESS_TYPES).toContain(resolvePack(null, typed, app).id);
  });

  it("alias table: every alias points at a real pack and no alias shadows a pack id", () => {
    // packFor() resolves ids first, so an alias equal to an id would be dead; and a typo'd target would return undefined.
    for (const id of BUSINESS_TYPES) expect(packFor(id)?.id).toBe(id);
    const words = ["lodge", "milk", "xerox", "tuition", "yoga", "paints", "electricals", "laundry", "catering", "tiles", "printing", "photography", "driving", "dance", "music"];
    for (const w of words) expect(packFor(w), w).not.toBeNull();
  });

  it("batch 9: each new pack has its app, group, solution preset (off list), words, aliases and a starter home", () => {
    const want = {
      textiles_wholesale: { app: "EC", group: "retail", aliases: ["wholesale cloth", "fabrics"] },
      catering: { app: "SV", group: "food", aliases: ["caterers", "catering service"] },
      pet_grooming: { app: "SV", group: "services", aliases: ["dog grooming", "pet spa"] },
      photo_studio: { app: "SV", group: "services", aliases: ["photographer", "videography"] },
      laundry: { app: "SV", group: "services", aliases: ["dry cleaning", "dhobi"] },
      event_decor: { app: "SV", group: "services", aliases: ["decorators", "event management"] },
      ac_service: { app: "SV", group: "services", aliases: ["ac repair", "fridge repair"] },
      print_shop: { app: "BL", group: "services", aliases: ["xerox", "flex printing"] },
      tuition: { app: "SV", group: "education", aliases: ["tuition centre", "coaching centre"] },
      dance_music: { app: "SV", group: "education", aliases: ["dance classes", "music school"] },
      yoga: { app: "SV", group: "education", aliases: ["yoga centre", "meditation"] },
      driving_school: { app: "SV", group: "education", aliases: ["driving school", "driving classes"] },
      paints: { app: "BL", group: "building", aliases: ["paint shop", "putty"] },
      electricals: { app: "BL", group: "building", aliases: ["electrical shop", "lighting"] },
      tiles_sanitary: { app: "BL", group: "building", aliases: ["tiles", "sanitary ware"] },
    } as const;
    const homes = new Set<string>();
    for (const [id, { app, group, aliases }] of Object.entries(want)) {
      const p = PACKS[id as keyof typeof want];
      expect(p, id).toMatchObject({ id, appId: app, group });
      expect(p.usps, id).toHaveLength(3);
      for (const u of p.usps) for (const lang of ["en", "ta"] as const) expect(u.title[lang] && u.text[lang], `${id} usp ${lang}`).toBeTruthy();
      expect(p.categories.length, id).toBeGreaterThanOrEqual(5);
      expect(p.categories.length, id).toBeLessThanOrEqual(7);
      for (const lang of ["en", "ta"] as const) for (const k of ["search", "heroHeading", "heroSubheading"] as const) {
        expect(BUSINESS_TYPES.filter((t) => PACKS[t].copy[lang][k] === p.copy[lang][k]), `${id}.${lang}.${k}`).toEqual([id]);
      }
      expect(copyFor(p, "ta").heroHeading, id).toMatch(/[஀-௿]/);
      expect(p.nameTa, id).toMatch(/[஀-௿]/);
      for (const a of aliases) expect(packFor(a)?.id, a).toBe(id);
      // The SV classes and services book online; the shops and counters sell.
      expect(p.ctaHref ?? "/search", id).toBe(app === "SV" ? "/book" : "/search");
      // A solution preset: SV packs that aren't workshops turn job cards off; none of these is a school website.
      expect(p.site, id).toBeUndefined();
      for (const lang of ["en", "ta"] as const) {
        const home = starterHome(p, "Shop", lang);
        homes.add(`${id}:${home.map((s) => s.type).join(",")}`);
        const faq = home.find((s) => s.type === "faq");
        expect(faq && "items" in faq ? faq.items.length : 0, `${id} faq ${lang}`).toBeGreaterThanOrEqual(3);
        if (p.ctaHref === "/book") {
          const appt = home.find((s) => s.type === "appointment");
          expect(appt && "services" in appt ? appt.services.length : 0, `${id} services ${lang}`).toBe(3);
        }
        const hours = home.find((s) => s.type === "location");
        if (hours) expect(JSON.stringify(hours), id).toMatch(/\d/);
      }
    }
    expect(homes.size).toBe(Object.keys(want).length);
    // Presets that matter: classes and services don't see job cards; the classes keep bookings and memberships.
    for (const id of ["tuition", "dance_music", "yoga", "driving_school", "pet_grooming", "catering", "event_decor"] as const) expect(PACKS[id].off, id).toContain("jobcards");
    for (const id of ["tuition", "dance_music", "yoga", "driving_school"] as const) {
      expect(PACKS[id].off, id).not.toContain("bookings");
      expect(PACKS[id].off, id).not.toContain("memberships");
    }
    // Laundry, AC service start on today's job cards and bookings (their proper engines come in batch 10).
    for (const id of ["laundry", "ac_service"] as const) {
      expect(PACKS[id].off ?? [], id).not.toContain("jobcards");
      expect(PACKS[id].off ?? [], id).not.toContain("bookings");
    }
    expect(PACKS.electricals.features).toEqual(["serials", "serials.warranty"]);
    expect(PACKS.tiles_sanitary.editor.attributes).toContain("Coverage per box (sq ft)");
    expect(PACKS.tuition.copy.en.cta).toMatch(/demo/i);
    // Wholesale cloth is local-made; "Nobody turned away": no pack here leaks clothing words into other trades' copy.
    for (const id of Object.keys(want)) expect(JSON.stringify(PACKS[id as keyof typeof want].copy.en), id).not.toMatch(/kurti|saree/i);
  });
  it("batch 10: garages, agri inputs and auto parts have their app, group, job template, words and starter home", () => {
    const want = {
      two_wheeler_service: { app: "SV", group: "auto", job: "vehicle", aliases: ["bike service", "scooter repair", "two wheeler workshop"] },
      car_service: { app: "SV", group: "auto", job: "vehicle", aliases: ["car garage", "car repair", "car wash"] },
      agri_inputs: { app: "BL", group: "retail", job: undefined, aliases: ["fertiliser shop", "seed shop", "agro centre"] },
      auto_parts: { app: "BL", group: "auto", job: undefined, aliases: ["auto spares", "bike spares", "tyre shop"] },
    } as const;
    for (const [id, { app, group, job, aliases }] of Object.entries(want)) {
      const p = PACKS[id as keyof typeof want];
      expect(p, id).toMatchObject({ id, appId: app, group, sizeGuide: null });
      expect(p.jobTemplate, id).toBe(job);
      expect(p.usps, id).toHaveLength(3);
      expect(p.categories.length, id).toBeGreaterThanOrEqual(5);
      expect(p.nameTa, id).toMatch(/[஀-௿]/);
      for (const lang of ["en", "ta"] as const) {
        for (const [k, v] of Object.entries(p.copy[lang])) expect(v.trim(), `${id}.${lang}.${k}`).not.toBe("");
        for (const k of ["search", "heroHeading", "heroSubheading"] as const) expect(BUSINESS_TYPES.filter((t) => PACKS[t].copy[lang][k] === p.copy[lang][k]), `${id}.${lang}.${k}`).toEqual([id]);
        const home = starterHome(p, "Shop", lang);
        const faq = home.find((s) => s.type === "faq");
        expect(faq && "items" in faq ? faq.items.length : 0, `${id} faq ${lang}`).toBeGreaterThanOrEqual(3);
        if (app === "SV") {
          const appt = home.find((s) => s.type === "appointment");
          expect(appt && "services" in appt ? appt.services.length : 0, `${id} services ${lang}`).toBe(3);
        }
      }
      for (const a of aliases) expect(packFor(a)?.id, a).toBe(id);
      expect(p.ctaHref ?? "/search", id).toBe(app === "SV" ? "/book" : "/search");
    }
    // Garages keep job cards and bookings (they are workshops); the shops don't book.
    for (const id of ["two_wheeler_service", "car_service"] as const) {
      expect(PACKS[id].off ?? [], id).not.toContain("jobcards");
      expect(PACKS[id].off ?? [], id).not.toContain("bookings");
    }
    expect(PACKS.agri_inputs.trackBatches).toBe(true);
    expect(BUSINESS_TYPES.filter((t) => PACKS[t].trackBatches)).toEqual(["agri_inputs"]);
    expect(PACKS.auto_parts.editor.attributes).toEqual(expect.arrayContaining(["Part number", "Fits vehicles"]));
    // The workshop packs name the card template they start on; it is always one of the job card templates.
    expect(Object.fromEntries(BUSINESS_TYPES.filter((t) => PACKS[t].jobTemplate).map((t) => [t, PACKS[t].jobTemplate]))).toEqual({
      repair: "device", tailoring: "garment", optical: "eyewear", laundry: "laundry", ac_service: "appliance", two_wheeler_service: "vehicle", car_service: "vehicle",
    });
  });
  it("picker groups: every real trade once, headings in both languages, no general pack, the app's own trades first", () => {
    for (const locale of ["en", "ta"]) {
      const groups = packPickerGroups(locale);
      const ids = groups.flatMap((g) => g.options.map((o) => o.value));
      expect(ids.sort()).toEqual(BUSINESS_TYPES.filter((t) => !isGeneralPack(t)).sort());
      for (const g of groups) {
        expect(g.label.trim(), g.key).not.toBe("");
        for (const o of g.options) expect(o.label && o.hint && o.keywords, o.value).toBeTruthy();
      }
    }
    expect(packPickerGroups("ta")[0]!.label).toMatch(/[஀-௿]/);
    // Searchable in either language.
    const tuition = packPickerGroups("en").flatMap((g) => g.options).find((o) => o.value === "tuition")!;
    expect(tuition.keywords).toContain("டியூஷன்");
    // Trades made for the chosen app come first within their group.
    const retail = packPickerGroups("en", "BL").find((g) => g.key === "services")!.options.map((o) => PACKS[o.value].appId);
    expect(retail[0]).toBe("BL");
  });
});
