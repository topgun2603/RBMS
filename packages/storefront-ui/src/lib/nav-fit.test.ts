import { describe, expect, it } from "vitest";
import type { MenuItem } from "../types";
import { navFitCount, navLeadFolds, overflowLinks } from "./nav-fit";

describe("desktop menu fit", () => {
  // bytefix: "Shop" mega button + 7 items (Laptops, Desktops, Components, Peripherals, Repairs, Book service, Track repair).
  const widths = [96, 100, 124, 112, 96, 118, 120];
  const shop = 92;

  it("shows everything when it fits", () => {
    expect(navFitCount(2000, shop, widths, 80, 2)).toBe(7);
    expect(navFitCount(0, 0, [], 80)).toBe(0);
  });

  it("keeps room for More and drops items from the end when they don't", () => {
    // A split header's third at 1440 (~400px): Shop + two items + More.
    const n = navFitCount(400, shop, widths, 80, 2);
    expect(n).toBe(2);
    const used = shop + widths.slice(0, n).reduce((a, b) => a + b, 0) + 80 + 2 * (n + 1);
    expect(used).toBeLessThanOrEqual(400);
    expect(navFitCount(100, shop, widths, 80, 2)).toBe(0);
  });

  it("folds the lead into More when not even the lead and More fit (Tamil at 1024 px beside the search box)", () => {
    // Ezhuthaani, Tamil, 1024 px: 170 px for the menu, "வாங்க" mega button 90 px, "மேலும்" 86 px.
    expect(navLeadFolds(170, 90, [120, 140], 86, 2)).toBe(true);
    expect(navFitCount(170, 0, [120, 140], 86, 2)).toBe(0);
    // Room for the lead and More: no folding; everything fits: no folding; no lead: nothing to fold.
    expect(navLeadFolds(400, shop, widths, 80, 2)).toBe(false);
    expect(navLeadFolds(2000, shop, widths, 80, 2)).toBe(false);
    expect(navLeadFolds(50, 0, widths, 80, 2)).toBe(false);
  });

  it("the More menu lists one link per overflowed item (a group without a page lists its children)", () => {
    const items: MenuItem[] = [
      { label: "Repairs", type: "page", href: "/repair-services", children: [{ label: "Laptop screen", type: "product", href: "/p/laptop-screen-replacement" }] },
      { label: "Book service", type: "url", href: "/book" },
      { label: "Desktops", type: "category", href: null, children: [{ label: "Gaming builds", type: "collection", href: "/collections/gaming" }, { label: "x", type: "url", href: null }] },
    ];
    expect(overflowLinks(items).map((m) => m.href)).toEqual(["/repair-services", "/book", "/collections/gaming"]);
  });
});
