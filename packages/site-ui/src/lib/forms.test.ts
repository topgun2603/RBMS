import { describe, expect, it } from "vitest";
import { permits } from "./access";
import { normalizeDomain } from "./domain";
import { cleanSlugInput, compactINR, paiseToInput, rupeesToPaise, slugify } from "./format";
import { slugIssue } from "./slug-check";
import { fromStoreForm, STORE_DEFAULTS, storeFormSchema, toStoreForm } from "./store-form";
import { storeUrlFor } from "./store-url";

describe("store settings form", () => {
  const live = {
    open: false,
    closedMessage: "Closed for Pongal",
    codEnabled: true,
    codMaxAmount: 250_050,
    minOrderValue: 0,
    contactPhone: "+919876500003",
    contactEmail: "hello@anbufashions.in",
    social: { instagram: "https://instagram.com/anbufashions", whatsapp: "+919876500003" },
    policies: { shipping: "Ships in 2 days", returns: "7 days", privacy: "", terms: "Prices include GST." },
  };

  it("round-trips the namespace (missing keys get defaults)", () => {
    const form = toStoreForm(live);
    expect(form.codMaxAmount).toBe("2500.5");
    expect(form.minOrderValue).toBe("");
    expect(storeFormSchema.parse(form)).toEqual(form);
    expect(fromStoreForm(form)).toEqual({
      ...live,
      social: { instagram: "https://instagram.com/anbufashions", facebook: "", youtube: "", whatsapp: "+919876500003" },
      installBanner: true,
      deliveryEnabled: true,
      pickupEnabled: false,
      pickupNote: "",
      trust: { returns: "auto", payment: "auto", badges: [] },
    });
  });

  it("trust badges: modes and the owner's own badges round-trip; empty titles are dropped", () => {
    const own = { returns: "replace" as const, payment: "confirm" as const, badges: [{ title: "Licensed stock", text: "PESO licence 12/2025", titleTa: "உரிமம் பெற்றவை", textTa: "" }] };
    const form = toStoreForm({ ...live, trust: own });
    expect(form).toMatchObject({ trustReturns: "replace", trustPayment: "confirm" });
    expect(fromStoreForm(form).trust).toEqual(own);
    expect(fromStoreForm({ ...form, trustBadges: [...form.trustBadges, { title: " ", text: "x", titleTa: "", textTa: "" }] }).trust?.badges).toHaveLength(1);
    expect(toStoreForm({ ...live, trust: { returns: "weird" as never, payment: "auto", badges: [] } }).trustReturns).toBe("auto");
    expect(storeFormSchema.safeParse({ ...form, trustBadges: Array(5).fill(own.badges[0]) }).success).toBe(false);
  });

  it("defaults match the API's", () => {
    expect(fromStoreForm(toStoreForm({}))).toEqual(STORE_DEFAULTS);
  });

  it("rejects bad links, emails and amounts with message keys", () => {
    const r = storeFormSchema.safeParse({ ...toStoreForm({}), instagram: "instagram.com/x", contactEmail: "nope", codMaxAmount: "99999999" });
    expect(r.success).toBe(false);
    const msgs = Object.fromEntries((r.success ? [] : r.error.issues).map((i) => [i.path[0], i.message]));
    expect(msgs).toMatchObject({ instagram: "site.validation.fullUrl", contactEmail: "site.validation.email", codMaxAmount: "site.validation.amount" });
  });
});

describe("domains", () => {
  it("normalises what owners paste", () => {
    expect(normalizeDomain("https://WWW.AnbuFashions.in/shop?x=1")).toBe("www.anbufashions.in");
    expect(normalizeDomain("shop.example.co.in.")).toBe("shop.example.co.in");
    expect(normalizeDomain("localhost")).toBeNull();
    expect(normalizeDomain("bad_domain.in")).toBeNull();
    expect(normalizeDomain("-x.in")).toBeNull();
  });
});

describe("slugs", () => {
  it("surfaces format and reserved problems before the server does", () => {
    expect(slugIssue("")).toBeNull();
    expect(slugIssue("about-us")).toBeNull();
    expect(slugIssue("cart")).toBe("reserved");
    expect(slugIssue("blog")).toBe("reserved");
    expect(slugIssue("About")).toBe("invalid");
    expect(slugIssue("a--b")).toBe("invalid");
    expect(slugIssue("x".repeat(81))).toBe("invalid");
  });

  it("cleans input while typing and builds slugs from titles", () => {
    expect(cleanSlugInput("Size Guide!!")).toBe("size-guide-");
    expect(slugify("Shipping & Returns")).toBe("shipping-and-returns");
    expect(slugify("எங்களைப் பற்றி")).toBe("");
  });
});

describe("money and links", () => {
  it("converts rupees and paise", () => {
    expect(rupeesToPaise("1,249.50")).toBe(124950);
    expect(rupeesToPaise("")).toBeNull();
    expect(paiseToInput(0)).toBe("");
    expect(paiseToInput(500000)).toBe("5000");
    expect(compactINR(12_900_00)).toBe("₹12.9K");
    expect(compactINR(4_20_000_00)).toBe("₹4.2L");
  });

  it("builds storefront URLs from the template", () => {
    expect(storeUrlFor("anbu", "/", "http://{slug}.localhost:3003")).toBe("http://anbu.localhost:3003/");
    expect(storeUrlFor("anbu", "/about", "https://{slug}.rbms.in/")).toBe("https://anbu.rbms.in/about");
    expect(storeUrlFor("anbu", "blog/x", "https://shop.in")).toBe("https://shop.in/blog/x");
  });
});

describe("permissions", () => {
  it("grants with *, the exact key or the module wildcard; no list defers to the server", () => {
    expect(permits(["*"], "cms.manage")).toBe(true);
    expect(permits(["cms.manage"], "cms.manage")).toBe(true);
    expect(permits(["cms.*"], "cms.manage")).toBe(true);
    expect(permits(["reviews.manage"], "cms.manage")).toBe(false);
    expect(permits([], "reports.view")).toBe(false);
    expect(permits(["*.view"], "reports.view")).toBe(true); // like the server's permissionMatches
    expect(permits(["*.view"], "cms.manage")).toBe(false);
    expect(permits(undefined, "reports.view")).toBe(true);
  });
});
