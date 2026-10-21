import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { footerColumns, StoreFooter } from "../components/footer";
import { NewsletterForm } from "../client/carousel";
import { CategoriesSectionView } from "../pages/home-categories";
import type { HomeSectionOf, MenuItem, StoreConfig } from "../types";
import { translatorFor } from "./messages";

const t = translatorFor("en");
const html = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>);

// The form only needs the translator from the store context.
vi.mock("../client/store-context", async (orig) => ({ ...(await orig<typeof import("../client/store-context")>()), useStore: () => ({ t }) }));

const config = {
  shop: { name: "Anbu Textiles", logoUrl: null, contactPhone: "9876543210", contactEmail: "hi@anbu.in", social: {}, businessType: "textiles" },
  policies: { returns: "7 days" },
  codEnabled: true,
} as unknown as StoreConfig;

/** anbu's footer menu: its own "Help" group plus a loose link. */
const anbuMenu: MenuItem[] = [
  { label: "Help", type: "url", href: null, children: [{ label: "Track your order", type: "url", href: "/track" }, { label: "Contact us", type: "url", href: "tel:+919876500003" }] },
  { label: "About us", type: "url", href: "/pages/about" },
];

describe("footer help column", () => {
  it("folds the help centre into the shop's own Help group instead of a second Help column", () => {
    const { groups, extraHelp } = footerColumns(anbuMenu, true, t);
    expect(extraHelp).toBe(false);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.children!.map((c) => c.href)).toEqual(["/track", "tel:+919876500003", "/help"]);
    const out = html(<StoreFooter config={config} menu={anbuMenu} t={t} help variant="columns" />);
    expect(out.match(/>Help<\/p>/g)).toHaveLength(1);
    expect(out.match(/href="\/help"/g)?.length).toBeGreaterThanOrEqual(1);
  });

  it("matches the group by title alone (adds tracking) and keeps our column when the shop has an unrelated group", () => {
    const byTitle = footerColumns([{ label: " help ", type: "url", href: null, children: [{ label: "FAQ", type: "url", href: "/pages/faq" }] }], true, t);
    expect(byTitle.extraHelp).toBe(false);
    expect(byTitle.groups[0]!.children!.map((c) => c.href)).toEqual(["/pages/faq", "/help", "/track"]);
    const other = footerColumns([{ label: "Company", type: "url", href: null, children: [{ label: "About", type: "url", href: "/pages/about" }] }], true, t);
    expect(other.extraHelp).toBe(true);
    expect(other.groups[0]!.children).toHaveLength(1);
    // Help centre off: no /help link is invented.
    expect(footerColumns(anbuMenu, false, t).groups[0]!.children!.map((c) => c.href)).not.toContain("/help");
  });

  it("centered footer lists tracking once when the menu already links it", () => {
    const out = html(<StoreFooter config={config} menu={anbuMenu} t={t} help variant="centered" />);
    expect(out.match(/href="\/track"/g)).toHaveLength(1);
    expect(out.match(/href="\/help"/g)).toHaveLength(1);
  });

  it("marks the footer signup so a page with its own newsletter section can drop it", () => {
    expect(html(<StoreFooter config={config} menu={[]} t={t} variant="newsletter" />)).toContain('data-footer-signup="band"');
    expect(html(<StoreFooter config={config} menu={[]} t={t} variant="columns" />)).toContain('data-footer-signup="card"');
  });
});

describe("styles", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

  it("hides the footer signup on a page that has a newsletter section", () => {
    expect(css).toMatch(/\.sf-root:has\(\[data-section-type="newsletter"\]\) \[data-footer-signup\] \{\s*display: none;/);
  });

  it("category tints and story rings stay in an analogous band (no olive / sage on gold brands)", () => {
    const shifts = [...css.matchAll(/oklch\(from var\(--primary\)[^;]*?calc\(h ([+-]) (\d+)\)\)/g)].map((m) => (m[1] === "+" ? 1 : -1) * Number(m[2]));
    expect(shifts.length).toBeGreaterThanOrEqual(7);
    for (const d of shifts) {
      expect(d).toBeLessThanOrEqual(8);
      expect(d).toBeGreaterThanOrEqual(-24);
    }
    // Temple gold (oklch hue ≈ 85): every tone stays short of yellow-green (≈ 105+).
    for (const d of shifts) expect(85 + d).toBeLessThan(100);
  });
});

describe("newsletter form on phones", () => {
  it("stacks a full-width field over the button; the field only flexes in the row", () => {
    const out = html(<NewsletterForm />);
    expect(out).toContain("flex-col");
    const input = out.match(/<input[^>]*class="([^"]*)"/)![1]!;
    expect(input.split(" ")).toEqual(expect.arrayContaining(["w-full", "shrink-0", "sm:flex-1"]));
    expect(input.split(" ")).not.toContain("flex-1");
    expect(out).toMatch(/<button[^>]*class="[^"]*w-full[^"]*sm:w-auto/);
  });
});

describe("category counts", () => {
  const s: HomeSectionOf<"categories"> = {
    type: "categories",
    title: "Shop by category",
    layout: "tiles",
    showCounts: true,
    categories: [
      { id: "c1", name: "Rings", slug: "rings", image: null },
      { id: "c2", name: "Bangles", slug: "bangles", image: null },
    ],
  };

  it("says 'Coming soon' for a category without products (facets only list categories that have some)", () => {
    const out = html(<CategoriesSectionView s={s} t={t} counts={new Map([["c1", 3]])} />);
    expect(out).toContain("3 products");
    expect(out).toContain("Coming soon");
    // A shop with products but none filed under a category: every tile says so rather than nothing.
    expect(html(<CategoriesSectionView s={s} t={t} counts={new Map()} />).match(/Coming soon/g)).toHaveLength(2);
    expect(html(<CategoriesSectionView s={{ ...s, layout: "pills" }} t={t} counts={new Map()} />)).toContain("Coming soon");
  });

  it("shows nothing when counts are off or could not load", () => {
    expect(html(<CategoriesSectionView s={{ ...s, showCounts: false }} t={t} counts={new Map()} />)).not.toContain("Coming soon");
    expect(html(<CategoriesSectionView s={s} t={t} />)).not.toContain("Coming soon");
  });
});
