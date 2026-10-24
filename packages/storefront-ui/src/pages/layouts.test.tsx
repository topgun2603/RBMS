import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { finderQuery } from "../lib/finder";
import { apiSearchQuery } from "../lib/url";
import { en, ta, translatorFor } from "../lib/messages";
import { layoutsEn, layoutsTa } from "../lib/messages-layouts";
import { themeView } from "../server/api";
import type { HomeSectionOf, ProductSummary } from "../types";
import { CategoryRail, railPage, SideNav, TabBar } from "../client/page-shell";
import { ComparisonSection, FinderSection, FlashSaleSection, flashSaleOutside, CategoryShelfSection, SizeFinderSection, StickyStorySection, StoriesSection, tileHref, TilesSection } from "./home-layouts";
import { footCmFor, sizeForFoot } from "../lib/shoe-size";
import { pairHalves } from "./home";

/* Layout features: the flash sale, finder, stories, category shelf, sticky story and comparison sections, half-width
   pairs and the page layouts (rail, side menu, magazine, phone tab bar). */

const t = translatorFor("en");
let path = "/";
vi.mock("next/navigation", () => ({ usePathname: () => path, useRouter: () => ({ push: () => {} }) }));
vi.mock("../client/store-context", async (orig) => ({
  ...(await orig<typeof import("../client/store-context")>()),
  useStore: () => ({
    t,
    locale: "en",
    shell: { theme: themeView({}), open: true, name: "Ezhuthaani", logoUrl: null, features: [], businessType: "stationery" },
    cart: { count: 3, setMiniOpen: () => {} },
    auth: { token: null, user: null },
  }),
}));
// Product tiles are client islands with their own queries (wishlist); names are enough here.
vi.mock("../components/product-card", () => ({
  ProductCard: ({ product }: { product: ProductSummary }) => <li>{product.name}</li>,
  ProductGrid: ({ products }: { products: ProductSummary[] }) => <ul>{products.map((p) => <li key={p.id}>{p.name}</li>)}</ul>,
}));
vi.mock("../client/carousel", async (orig) => ({
  ...(await orig<typeof import("../client/carousel")>()),
  Carousel: ({ children, className }: { children: React.ReactNode; className?: string }) => <ul className={className}>{children}</ul>,
}));

const html = (node: React.ReactNode) => renderToStaticMarkup(<>{node}</>);
const product = (id: string, name = "Long notebook", mrp: number | null = null): ProductSummary => ({
  id,
  name,
  slug: name.toLowerCase().replace(/\s+/g, "-"),
  categoryId: null,
  categoryName: null,
  image: null,
  priceMin: 4900,
  priceMax: 4900,
  mrp,
  variantCount: 1,
  taxInclusive: true,
});
const ratings = new Map();
const ENDS = new Date(Date.now() + 3_600_000).toISOString();

describe("messages", () => {
  it("every layout string has a Tamil translation and both are merged in", () => {
    expect(Object.keys(layoutsTa).sort()).toEqual(Object.keys(layoutsEn).sort());
    for (const k of Object.keys(layoutsEn)) {
      expect(en[k], k).toBeDefined();
      expect(ta[k], k).toBeDefined();
    }
  });
});

describe("flash sale", () => {
  const s: HomeSectionOf<"flash-sale"> = { type: "flash-sale", endsAt: ENDS, source: "pick", layout: "grid", limit: 8, products: [product("p1", "Gel pen", 6000), product("p2")] };
  it("draws the countdown band, the real best discount and the products", () => {
    const out = html(<FlashSaleSection s={s} t={t} products={s.products} ratings={ratings} index={3} />);
    expect(out).toContain('data-testid="flash-sale"');
    expect(out).toContain("Flash sale");
    expect(out).toContain("Ends in");
    expect(out).toContain("Up to 18% off");
    expect(out).toContain("Gel pen");
  });
  it("shows nothing without products, and only inside its window", () => {
    expect(html(<FlashSaleSection s={s} t={t} products={[]} ratings={ratings} index={0} />)).toBe("");
    const now = Date.now();
    expect(flashSaleOutside(s, now)).toBe(false);
    expect(flashSaleOutside({ ...s, endsAt: new Date(now - 1000).toISOString() }, now)).toBe(true);
    expect(flashSaleOutside({ ...s, startsAt: new Date(now + 60_000).toISOString() }, now)).toBe(true);
    expect(flashSaleOutside({ type: "text", markdown: "x" }, now)).toBe(false);
  });
});

describe("finder", () => {
  it("combines answers into the search query and the listing link", () => {
    const q = finderQuery([
      { label: "Class 1–5", tag: "Class-1-5", categoryId: "c1" },
      { label: "Under ₹500", priceMax: 50000 },
      { label: "Size 8", filterName: "Size", filterValue: "8" },
      null,
    ]);
    expect(q.api).toBe("categoryId=c1&tag=class-1-5&priceMax=50000&opt.Size=8");
    expect(q.href).toBe("/search?cat=c1&tag=class-1-5&max=500&opt.Size=8");
    expect(q.filters).toBe(4);
    expect(finderQuery([]).href).toBe("/search");
    // Two answers for the same option add up; the narrower price range wins.
    expect(finderQuery([{ label: "a", filterName: "Size", filterValue: "7", priceMax: 90000 }, { label: "b", filterName: "Size", filterValue: "8", priceMax: 50000, priceMin: 10000 }]).api).toBe(
      "priceMin=10000&priceMax=50000&opt.Size=7&opt.Size=8",
    );
  });
  it("two tag questions combine (AND: board × class), not the last tag winning", () => {
    const q = finderQuery([{ label: "State board", tag: "state-board" }, { label: "Class 1–5", tag: "Class-1-5" }, { label: "again", tag: "state-board" }]);
    expect(q.api).toBe("tag=state-board&tag=class-1-5");
    expect(q.href).toBe("/search?tag=state-board&tag=class-1-5");
    expect(q.filters).toBe(2);
    // The listing forwards every tag to the search API.
    expect(apiSearchQuery({ tag: ["state-board", "Class-1-5"] }).tag).toEqual(["state-board", "class-1-5"]);
    expect(apiSearchQuery({ tag: "a,b" }).tag).toEqual(["a", "b"]);
    expect(apiSearchQuery({}).tag).toBeUndefined();
  });
  it("renders the first question as answer tiles (wizard) or every question as chips", () => {
    const s: HomeSectionOf<"finder"> = {
      type: "finder",
      layout: "wizard",
      limit: 8,
      questions: [
        { label: "Which class?", options: [{ label: "LKG–UKG", tag: "lkg-ukg" }, { label: "Class 1–5", tag: "class-1-5" }] },
        { label: "What do you need?", options: [{ label: "Notebooks" }, { label: "Bags" }] },
      ],
    };
    const wizard = html(<FinderSection s={s} t={t} index={0} />);
    expect(wizard).toContain('data-layout="wizard"');
    expect(wizard).toContain("Step 1 of 2");
    expect(wizard).toContain("Which class?");
    expect(wizard).not.toContain("What do you need?");
    expect(wizard).toContain('aria-pressed="false"');
    const chips = html(<FinderSection s={{ ...s, layout: "chips" }} t={t} index={0} />);
    expect(chips).toContain("What do you need?");
    expect(chips).toContain('role="group"');
  });
});

describe("stories, category shelf, sticky story, comparison", () => {
  it("stories open a viewer from buttons with their title", () => {
    const out = html(<StoriesSection s={{ type: "stories", layout: "reels", title: "New in", items: [{ imageUrl: "/a.jpg", videoUrl: "/a.mp4", title: "Drape it" }] }} t={t} />);
    expect(out).toContain('aria-label="Open story: Drape it"');
    expect(out).toContain("aspect-[9/16]");
    expect(out).toContain("<video");
  });

  it("the category shelf lists only categories with products, as tabs", () => {
    const s: HomeSectionOf<"category-shelf"> = {
      type: "category-shelf",
      title: "Shop by aisle",
      showImages: true,
      limit: 8,
      categories: [
        { id: "c1", name: "Notebooks", slug: "notebooks", image: null },
        { id: "c2", name: "Empty", slug: "empty", image: null },
      ],
    };
    const out = html(<CategoryShelfSection s={s} t={t} shelves={[{ categoryId: "c1", items: [product("p1")] }, { categoryId: "c2", items: [] }]} ratings={ratings} index={1} />);
    expect(out).toContain('role="tablist"');
    expect(out).toContain('aria-orientation="vertical"');
    expect(out).toContain("Notebooks");
    expect(out).not.toContain(">Empty<");
    expect(out).toContain("View all in Notebooks");
    expect(html(<CategoryShelfSection s={s} t={t} shelves={[]} ratings={ratings} index={1} />)).toBe("");
  });

  it("the sticky story stacks one picture per chapter beside numbered chapters", () => {
    const out = html(<StickyStorySection s={{ type: "sticky-story", imageSide: "right", chapters: [{ heading: "Yarn", markdown: "Pure *silk*", imageUrl: "/1.jpg", alt: "" }, { heading: "Loom", markdown: "", imageUrl: "/2.jpg", alt: "" }] }} index={0} />);
    expect(out).toContain('data-active="0"');
    expect(out).toContain('data-story-img="1"');
    expect(out).toContain('data-story-chapter="1"');
    expect(out).toContain(">02<");
  });

  it("the comparison is a real table with the highlighted column badged", () => {
    const s: HomeSectionOf<"comparison"> = {
      type: "comparison",
      showRating: true,
      highlightId: "p2",
      rows: [{ label: "Pages", values: ["100", "200"] }],
      products: [product("p1", "Small notebook"), product("p2", "Long notebook")],
    };
    const out = html(<ComparisonSection s={s} t={t} ratings={ratings} />);
    expect(out).toContain("<table");
    expect(out).toContain('scope="row"');
    expect(out).toContain("Best pick");
    expect(out).toContain("200");
    expect(out).toContain("No reviews yet");
  });
});

describe("half-width sections pair up", () => {
  const half = { style: { span: "half" } };
  it("two neighbouring halves share a row; a lone half takes the whole row", () => {
    expect(pairHalves([half, half, {}, half, {}]).map((r) => r.map((x) => x.i))).toEqual([[0, 1], [2], [3], [4]]);
    expect(pairHalves([half, half, half]).map((r) => r.length)).toEqual([2, 1]);
  });
});

describe("page layouts", () => {
  const categories = [
    { id: "c1", name: "Notebooks", slug: "notebooks", imageUrl: null, children: [{ id: "c11", name: "Long size", slug: "long-size" }] },
    { id: "c2", name: "Art & craft", slug: "art-craft", imageUrl: null },
  ];
  it("theme defaults keep the standard layout and no tab bar", () => {
    expect(themeView({})).toMatchObject({ pageLayout: "standard", mobileNav: "off" });
  });
  it("the rail lists categories on shopping pages, with the open category's sub-categories", () => {
    path = "/c/notebooks";
    const out = html(<CategoryRail categories={categories} />);
    expect(out).toContain('data-testid="category-rail"');
    expect(out).toContain('aria-current="page"');
    expect(out).toContain("Long size");
    expect(out).toContain("All products");
    path = "/checkout";
    expect(html(<CategoryRail categories={categories} />)).toBe("");
    expect(railPage("/p/gel-pen")).toBe(true);
    expect(railPage("/account")).toBe(false);
  });
  it("the side menu carries the menu, categories, search, cart and account", () => {
    path = "/";
    const out = html(<SideNav menu={[{ label: "School lists", type: "url", href: "/pages/school-lists" }]} categories={categories} />);
    expect(out).toContain('data-testid="side-nav"');
    expect(out).toContain('role="search"');
    expect(out).toContain("School lists");
    expect(out).toContain("Art &amp; craft");
    expect(out).toContain("Cart (3 items)");
  });
  it("the tab bar has five tabs and hides at checkout", () => {
    path = "/";
    const out = html(<TabBar categories={categories} />);
    for (const label of ["Home", "Categories", "Search", "Account"]) expect(out).toContain(label);
    expect(out).toContain('aria-current="page"');
    path = "/checkout";
    expect(html(<TabBar categories={categories} />)).toBe("");
  });
  it("styles lay the page out per mode (rail beside, sidebar padding, magazine tiles, tab bar room)", () => {
    const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
    expect(css).toContain('.sf-root[data-sf-page-layout="rail"] .sf-shell');
    expect(css).toMatch(/\.sf-root\[data-sf-page-layout="sidebar"\] \.sf-header \{\s*display: none;/);
    expect(css).toContain('.sf-pgrid:not([data-view="list"]):not([data-cols="2"]) > li:nth-child(6n + 1)');
    expect(css).toContain('.sf-root[data-sf-mobile-nav="tabs"] .fixed[class*="bottom-"]:not(.sf-tabbar)');
    expect(css).toMatch(/html:lang\(ta\) \.sf-root\[data-sf-page-layout="magazine"\] \.sf-home h2\.sf-heading \{[^}]*line-height: 1\.3/);
  });
});

describe("requests: tiles, size finder, finder button", () => {
  it("tiles link to their page, collection or tag and show counts", () => {
    expect(tileHref({ label: "x", href: "/pages/hair" })).toBe("/pages/hair");
    expect(tileHref({ label: "x", collectionSlug: "acne" })).toBe("/collections/acne");
    expect(tileHref({ label: "x", tag: "dry-skin" })).toBe("/search?tag=dry-skin");
    expect(tileHref({ label: "x" })).toBeNull();
    const out = html(<TilesSection s={{ type: "tiles", layout: "grid", showCounts: true, items: [{ label: "Acne & oily skin", note: "Niacinamide", collectionSlug: "acne" }, { label: "Bridal" }] }} t={t} counts={[12, null]} />);
    expect(out).toContain('href="/collections/acne"');
    expect(out).toContain("12 products");
    expect(out).toContain("Niacinamide");
  });
  it("foot length picks the smallest size that fits (adult and children's)", () => {
    expect(footCmFor("UK 7")).toBeCloseTo(25.4, 1);
    expect(footCmFor("10C")).toBeCloseTo(16.9, 1);
    expect(footCmFor("M")).toBeNull();
    expect(sizeForFoot(["UK 6", "UK 7", "UK 8"], 25.1)).toBe("UK 7");
    expect(sizeForFoot(["UK 6", "UK 7", "UK 8"], 28)).toBeNull();
    expect(sizeForFoot(["8C", "9C", "10C"], 15.9)).toBe("9C");
  });
  it("size chips open the listing in that size and category", () => {
    const out = html(<SizeFinderSection s={{ type: "size-finder", optionName: "Size", footLength: true, groups: [{ label: "Men", categoryId: "c1", sizes: ["UK 6", "UK 7"] }, { label: "Kids", sizes: ["10C"] }] }} t={t} index={0} />);
    expect(out).toContain('href="/search?cat=c1&amp;opt.Size=UK+6"');
    expect(out).toContain('role="radiogroup"');
    expect(out).toContain("Foot length");
  });
  it("button results show a quiet button until an answer, and the second button", () => {
    const s: HomeSectionOf<"finder"> = { type: "finder", layout: "chips", results: "button", buttonLabel: "Show my list", cta: { label: "WhatsApp us", href: "https://wa.me/919876500088" }, limit: 8, questions: [{ label: "Class", options: [{ label: "LKG", href: "/collections/class-lkg-ukg" }, { label: "1–5", tag: "class-1-5" }] }] };
    const out = html(<FinderSection s={s} t={t} index={0} />);
    expect(out).toContain("Show my list");
    expect(out).toContain('aria-disabled="true"');
    expect(out).toContain("WhatsApp us");
  });
});
