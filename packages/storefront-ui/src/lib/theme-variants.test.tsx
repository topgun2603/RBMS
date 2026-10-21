import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StoreFooter } from "../components/footer";
import { themeView } from "../server/api";
import type { Category, HomeSection, StoreConfig } from "../types";
import { cardBadges, freshIds, hoverEffects, stockOf } from "./cards";
import { navCategories, opensWithFullBleedHero } from "./chrome";
import { en, ta, translatorFor } from "./messages";
import { themeEn, themeTa } from "./messages-theme";

const t = translatorFor("en");
const DAY = 86_400_000;
const now = Date.parse("2026-10-20T00:00:00Z");
const iso = (daysAgo: number) => new Date(now - daysAgo * DAY).toISOString();

describe("theme view", () => {
  it("fills every newer option with today's look when the API sends an older theme", () => {
    expect(themeView({ header: "bold" })).toMatchObject({
      header: "bold",
      headerStyle: "glass",
      sticky: "always",
      megaMenu: "images",
      announcement: "dismissible",
      footer: "columns",
      cardHover: "rich",
      cardButton: "hover",
      productLayout: "thumbs-side",
      productDetails: "accordion",
      stickyBuy: "on",
      productTrust: "on",
      related: "rail",
    });
  });
});

describe("card badges", () => {
  it("'New' only for recent products, and not when most of the list is new", () => {
    const list = [
      { id: "a", createdAt: iso(3) },
      { id: "b", createdAt: iso(90) },
      { id: "c", createdAt: iso(200) },
      { id: "d" },
    ];
    expect([...freshIds(list, now)]).toEqual(["a"]);
    expect(freshIds([{ id: "a", createdAt: iso(1) }, { id: "b", createdAt: iso(2) }, { id: "c", createdAt: iso(90) }], now).size).toBe(0);
  });

  it("stock from the variants: sold out only when every variant is, few left when none has plenty", () => {
    const m = new Map([
      ["v1", { inStock: false, lowStock: false }],
      ["v2", { inStock: true, lowStock: true }],
      ["v3", { inStock: true, lowStock: false }],
    ]);
    expect(stockOf(["v1"], m)).toBe("out");
    expect(stockOf(["v1", "v2"], m)).toBe("low");
    expect(stockOf(["v2", "v3"], m)).toBe("in");
    expect(stockOf(["zz"], m)).toBeNull();
    expect(stockOf(undefined, m)).toBeNull();
  });

  it("orders badges and lets sold out stand alone", () => {
    expect(cardBadges({ pct: 20, fresh: true, stock: "low" }, t).map((b) => b.kind)).toEqual(["sale", "low"]);
    expect(cardBadges({ pct: 0, fresh: true, stock: "in" }, t)).toEqual([{ kind: "new", label: "New" }]);
    expect(cardBadges({ pct: 30, fresh: true, stock: "out" }, t)).toEqual([{ kind: "out", label: "Out of stock" }]);
    expect(cardBadges({ pct: 25, fresh: false, stock: null }, t)[0]!.label).toContain("25");
  });

  it("hover effects per option; swap falls back to zoom without a second photo", () => {
    expect(hoverEffects("rich", true)).toEqual({ lift: true, zoom: true, swap: true });
    expect(hoverEffects("rich", false)).toEqual({ lift: true, zoom: true, swap: false });
    expect(hoverEffects("swap", true)).toEqual({ lift: false, zoom: false, swap: true });
    expect(hoverEffects("swap", false)).toEqual({ lift: false, zoom: true, swap: false });
    expect(hoverEffects("none", true)).toEqual({ lift: false, zoom: false, swap: false });
  });
});

describe("header helpers", () => {
  const hero = (style?: HomeSection["style"]): HomeSection => ({ type: "hero", slides: [{ imageUrl: null, heading: "Hi" }], ...(style ? { style } : {}) });
  const theme = themeView({});

  it("the clear header needs a full-width banner first", () => {
    expect(opensWithFullBleedHero([hero()], theme)).toBe(true);
    expect(opensWithFullBleedHero([hero({ animation: "fade", padding: "normal" })], theme)).toBe(true);
    expect(opensWithFullBleedHero([hero()], themeView({ hero: "split" }))).toBe(false);
    expect(opensWithFullBleedHero([hero({ background: "brand" })], theme)).toBe(false);
    expect(opensWithFullBleedHero([hero({ padding: "spacious" })], theme)).toBe(false);
    expect(opensWithFullBleedHero([{ type: "text", markdown: "x" }, hero()], theme)).toBe(false);
    expect(opensWithFullBleedHero([], theme)).toBe(false);
  });

  it("menu categories carry their sub-categories", () => {
    const c = (id: string, parentId: string | null): Category => ({ id, parentId, name: id.toUpperCase(), slug: id, description: null, imageUrl: null, sort: 0, seo: null });
    const nav = navCategories([c("sarees", null), c("silk", "sarees"), c("cotton", "sarees"), c("kurtis", null)]);
    expect(nav.map((n) => n.slug)).toEqual(["sarees", "kurtis"]);
    expect(nav[0]!.children?.map((x) => x.slug)).toEqual(["silk", "cotton"]);
    expect(nav[1]).not.toHaveProperty("children");
  });
});

describe("footer variants", () => {
  const config = {
    shop: { name: "Anbu Textiles", logoUrl: null, contactPhone: "9876543210", contactEmail: "hi@anbu.in", social: { instagram: "https://instagram.com/anbu" } },
    policies: { returns: "7 days", shipping: "" },
    codEnabled: true,
  } as unknown as StoreConfig;
  const menu = [{ label: "Sarees", type: "link", href: "/c/sarees" }];
  const html = (variant: "centered" | "minimal") => renderToStaticMarkup(<StoreFooter config={config} menu={menu} t={t} variant={variant} />);

  it("minimal: one line with policies, socials, payments and back to top", () => {
    const out = html("minimal");
    expect(out).toContain('data-footer="minimal"');
    expect(out).toContain('href="/policies/returns"');
    expect(out).toContain('aria-label="Instagram"');
    expect(out).toContain('href="#top"');
    expect(out).toContain("UPI");
    expect(out).not.toContain("kolam");
  });

  it("centered: name, one links row (menu + policies), socials, contact", () => {
    const out = html("centered");
    expect(out).toContain('data-footer="centered"');
    expect(out).toContain('href="/c/sarees"');
    expect(out).toContain("Anbu Textiles");
    expect(out).toContain("tel:9876543210");
    expect(out).toContain('href="#top"');
  });
});

describe("theme strings", () => {
  it("every new string has a Tamil version and is merged into both locales", () => {
    expect(Object.keys(themeTa).sort()).toEqual(Object.keys(themeEn).sort());
    for (const k of Object.keys(themeEn)) {
      expect(en[k], k).toBe(themeEn[k]);
      expect(ta[k], k).toBe(themeTa[k]);
    }
  });
});
