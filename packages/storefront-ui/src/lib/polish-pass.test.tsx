import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { BUSINESS_TYPES } from "@srirealtime/verticals";
import { contrastRatio } from "@srirealtime/branding/color";
import { HeroSlider } from "../client/carousel";
import { footerColumns, minimalLinks, StoreFooter } from "../components/footer";
import type { MenuItem, StoreConfig } from "../types";
import { en, ta, translatorFor } from "./messages";
import { manifestCategories, PACK_CATEGORIES } from "./pwa";
import { alternateSchemeCss, alternateSchemeVariables, isDarkShop, themeScript, withContrast } from "./scheme";

const t = translatorFor("en");
const html = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>);
let hero = "slider";
vi.mock("../client/store-context", async (orig) => ({
  ...(await orig<typeof import("../client/store-context")>()),
  useStore: () => ({ t, shell: { theme: { hero } } }),
}));

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

describe("hero slider text clears the prev / next arrows", () => {
  const slide = { imageUrl: null, heading: "Everything to build", subheading: "Cement, steel" };
  for (const variant of ["slider", "full", "compact"]) {
    it(`${variant}: inline padding past the arrows with 2+ slides (md and lg), none needed for one`, () => {
      hero = variant;
      const two = html(<HeroSlider slides={[slide, slide]} shopName="M" />);
      expect(two).toMatch(/md:px-20 lg:px-20/);
      const one = html(<HeroSlider slides={[slide]} shopName="M" />);
      expect(one).not.toContain("md:px-20");
    });
  }
});

describe("theme button / radius tokens", () => {
  it("reaches shadcn Buttons (their classes contain `[&_svg:not([class*='size-'])]`) but not icon buttons", () => {
    expect(css).toContain(`[data-slot="button"].rounded-full:not([class^="size-"]):not([class*=" size-"])`);
    expect(css).not.toContain(`[data-slot="button"].rounded-full:not([class*="size-"])`);
    expect(css).toMatch(/:is\(a, button, input\)\.rounded-full:is\(\[class\*=" px-5"\]/);
  });
  it("a square theme (--radius: 0) keeps square cards", () => {
    expect(css).toContain("--sf-radius-card: calc(var(--radius) + clamp(0rem, var(--radius) * 100, 0.5rem));");
  });
  it("Tamil display headings get more leading", () => {
    expect(css).toMatch(/html:lang\(ta\) \.sf-root \.text-display \{[^}]*line-height: 1\.24/);
  });
});

describe("minimal footer keeps the footer menu", () => {
  const menu: MenuItem[] = [
    { label: "Help", type: "url", href: null, children: [{ label: "Photo credits", type: "url", href: "/pages/credits" }] },
    { label: "About us", type: "url", href: "/pages/about" },
  ];
  const config = { shop: { name: "Thari", social: {}, businessType: "fashion" }, policies: { returns: "7 days" }, codEnabled: false } as unknown as StoreConfig;
  it("lists every menu link once after Shop all", () => {
    const links = minimalLinks(footerColumns(menu, false, t, [{ label: "Returns", href: "/policies/returns" }]), t);
    expect(links[0]).toEqual({ label: t("nav.shopAll"), href: "/products" });
    expect(links.map((l) => l.href)).toEqual(expect.arrayContaining(["/pages/credits", "/pages/about", "/policies/returns"]));
    expect(new Set(links.map((l) => l.href)).size).toBe(links.length);
    const out = html(<StoreFooter config={config} menu={menu} t={t} variant="minimal" />);
    expect(out).toContain('href="/pages/credits"');
    expect(out).toContain('href="/policies/returns"');
  });
});

describe("Tamil labels that sit in fixed-size buttons and badges", () => {
  it("are short", () => {
    for (const k of ["product.chooseOptions", "rec.choose", "trust.secure", "trust.cod", "trust.returns", "product.outOfStock"]) {
      const v = (ta as Record<string, string>)[k] ?? translatorFor("ta")(k);
      expect(v, k).toBeTruthy();
      expect([...v].length, `${k}: ${v}`).toBeLessThanOrEqual(22);
    }
    expect(translatorFor("ta")("product.chooseOptions")).toBe("தேர்வு செய்");
    expect((en as Record<string, string>)["product.chooseOptions"]).toBeTruthy();
  });
});

describe("PWA manifest categories", () => {
  it("every business pack has its own categories", () => {
    for (const id of BUSINESS_TYPES) expect(PACK_CATEGORIES[id]?.length, id).toBeGreaterThan(0);
    expect(manifestCategories("organic")).toEqual(["food", "shopping", "health"]);
  });
  it("aliases resolve through the pack", () => {
    expect(manifestCategories("chekku")).toEqual(manifestCategories("organic"));
    expect(manifestCategories("Organic")).toEqual(["food", "shopping", "health"]);
    expect(manifestCategories(null)).toEqual(["shopping"]);
  });
});

describe("light / dark switch", () => {
  const light = { mode: "light", colors: { primary: "#7a1f2b", accent: "#fde3ad", background: "#fff8ec", foreground: "#2e1510" } };
  const dark = { mode: "dark", colors: { primary: "#facc15", accent: "#262a30", background: "#121417", foreground: "#eef0f2" } };
  it("tells dark shops from light ones", () => {
    expect(isDarkShop(light)).toBe(false);
    expect(isDarkShop(dark)).toBe(true);
    expect(isDarkShop({ colors: { primary: "#000000", background: "#0a0a0a" } })).toBe(true);
    expect(isDarkShop(null)).toBe(false);
  });
  it("gives a light shop a dark palette under html.dark, and a dark shop a light one under html.sf-light", () => {
    expect(alternateSchemeCss(light)).toMatch(/^html\.dark \{\n  color-scheme: dark;/);
    expect(alternateSchemeCss(dark)).toMatch(/^html\.sf-light \{\n  color-scheme: light;/);
    for (const k of ["--background", "--foreground", "--card", "--muted", "--border", "--primary", "--primary-foreground", "--accent", "--accent-foreground"]) {
      expect(alternateSchemeVariables(light)[k], k).toMatch(/^oklch\(/);
    }
  });
  it("keeps the brand colour readable as text on the switched page", () => {
    // maroon on a near-black page, yellow on a near-white page: both pushed to 4.5:1, already-readable ones untouched.
    const maroon = withContrast("#7a1f2b", "#121314", 4.5, "#ffffff");
    expect(contrastRatio(maroon, "#121314")).toBeGreaterThanOrEqual(4.5);
    const yellow = withContrast("#facc15", "#fffdf7", 4.5, "#000000");
    expect(contrastRatio(yellow, "#fffdf7")).toBeGreaterThanOrEqual(4.5);
    expect(withContrast("#ffffff", "#000000", 4.5, "#ffffff")).toBe("#ffffff");
  });
  it("the head script picks the saved choice, else the shop's own scheme", () => {
    const run = (darkShop: boolean, saved: string | null) => {
      const classes = new Set<string>();
      const d = { classList: { toggle: (c: string, on: boolean) => (on ? classes.add(c) : classes.delete(c)) } };
      new Function("document", "localStorage", themeScript(darkShop))({ documentElement: d }, { getItem: () => saved });
      return [...classes].sort();
    };
    expect(run(false, null)).toEqual([]);
    expect(run(false, "dark")).toEqual(["dark"]);
    expect(run(true, null)).toEqual(["dark"]);
    expect(run(true, "light")).toEqual(["sf-light"]);
    expect(run(true, "bogus")).toEqual(["dark"]);
  });
});
