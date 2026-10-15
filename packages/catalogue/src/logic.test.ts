import { exclusiveOf } from "@srirealtime/gst";
import { describe, expect, it } from "vitest";
import {
  buildTree,
  cartesian,
  descendantIds,
  inclusiveOf,
  itemName,
  mergeOptions,
  pickDefault,
  planVariants,
  priceRange,
  shortId,
  slugify,
  toPublicProduct,
  toPublicSummary,
  toSummary,
  todayIST,
  uniqueSlug,
  variantTitle,
  wouldCycle,
} from "./logic";
import type { Category, Product, Variant } from "./types";

describe("slugify", () => {
  it("lowercases ASCII and joins words with hyphens", () => {
    expect(slugify("Cotton Saree")).toBe("cotton-saree");
    expect(slugify("  Men's  Shirt -- XL!! ")).toBe("mens-shirt-xl");
    expect(slugify("Salt & Pepper")).toBe("salt-and-pepper");
    expect(slugify("Café Crème")).toBe("cafe-creme");
    expect(slugify("A4 Paper (500 sheets)")).toBe("a4-paper-500-sheets");
  });
  it("keeps the ASCII part of mixed names", () => {
    expect(slugify("பட்டு Silk Saree")).toBe("silk-saree");
  });
  it("falls back to p-<6 char id> for Tamil-only names", () => {
    expect(slugify("பட்டுப் புடவை", "p", () => "abc123")).toBe("p-abc123");
    expect(slugify("!!!", "c", () => "zzzzzz")).toBe("c-zzzzzz");
    expect(slugify("பட்டு")).toMatch(/^p-[a-z0-9]{6}$/);
  });
  it("caps the length without a trailing hyphen", () => {
    const s = slugify(`${"a".repeat(79)} b`);
    expect(s.length).toBeLessThanOrEqual(80);
    expect(s.endsWith("-")).toBe(false);
  });
  it("short ids are 6 lowercase base-36 characters", () => {
    for (let i = 0; i < 20; i++) expect(shortId()).toMatch(/^[a-z0-9]{6}$/);
  });
});

describe("uniqueSlug", () => {
  it("adds the first free numeric suffix", () => {
    expect(uniqueSlug("saree", new Set())).toBe("saree");
    expect(uniqueSlug("saree", new Set(["saree"]))).toBe("saree-2");
    expect(uniqueSlug("saree", new Set(["saree", "saree-2", "saree-3"]))).toBe("saree-4");
  });
});

describe("variants", () => {
  const size = { name: "Size", values: ["S", "M"] };
  const colour = { name: "Colour", values: ["Red", "Blue", "Green"] };

  it("titles variants in option order", () => {
    expect(variantTitle({ Colour: "Red", Size: "M" }, [size, colour])).toBe("M / Red");
    expect(variantTitle({}, [size])).toBe("");
    expect(itemName("Shirt", "M / Red")).toBe("Shirt – M / Red");
    expect(itemName("Shirt", "")).toBe("Shirt");
  });

  it("builds the cartesian product, first option slowest", () => {
    expect(cartesian([size, colour])).toEqual([
      { Size: "S", Colour: "Red" },
      { Size: "S", Colour: "Blue" },
      { Size: "S", Colour: "Green" },
      { Size: "M", Colour: "Red" },
      { Size: "M", Colour: "Blue" },
      { Size: "M", Colour: "Green" },
    ]);
    expect(cartesian([])).toEqual([]);
    expect(cartesian([{ name: "Size", values: [] }])).toEqual([]);
  });

  it("merges options case-insensitively", () => {
    expect(mergeOptions([size], [{ name: "size", values: ["m", "L"] }, colour])).toEqual([
      { name: "Size", values: ["S", "M", "L"] },
      colour,
    ]);
  });

  it("turns a simple product's default variant into the first combination (keeps its id)", () => {
    const plan = planVariants([{ id: "v0", optionValues: {} }], [], [size]);
    expect(plan.options).toEqual([size]);
    expect(plan.assign).toEqual([{ id: "v0", optionValues: { Size: "S" }, title: "S" }]);
    expect(plan.create).toEqual([{ optionValues: { Size: "M" }, title: "M" }]);
  });

  it("keeps existing variants and only creates missing combinations", () => {
    const plan = planVariants(
      [
        { id: "a", optionValues: { Size: "M" } },
        { id: "b", optionValues: { Size: "S" } },
      ],
      [size],
      [{ name: "Size", values: ["L"] }],
    );
    expect(plan.assign).toEqual([]);
    expect(plan.create).toEqual([{ optionValues: { Size: "L" }, title: "L" }]);
  });

  it("extends existing variants when a new option is added", () => {
    const plan = planVariants([{ id: "a", optionValues: { Size: "M" } }], [size], [{ name: "Colour", values: ["Red", "Blue"] }]);
    expect(plan.assign).toEqual([{ id: "a", optionValues: { Size: "M", Colour: "Red" }, title: "M / Red" }]);
    expect(plan.create.map((c) => c.title)).toEqual(["S / Red", "S / Blue", "M / Blue"]);
  });

  it("lets exact matches win over partial ones", () => {
    const plan = planVariants(
      [
        { id: "blank", optionValues: {} },
        { id: "s", optionValues: { Size: "S" } },
      ],
      [],
      [size],
    );
    expect(plan.assign).toEqual([{ id: "blank", optionValues: { Size: "M" }, title: "M" }]);
    expect(plan.create).toEqual([]);
  });

  it("picks the default variant", () => {
    const list = [
      { id: "a", isDefault: false, position: 2 },
      { id: "b", isDefault: false, position: 1 },
    ];
    expect(pickDefault(list)).toBe("b");
    expect(pickDefault(list, "a")).toBe("a");
    expect(pickDefault(list, "zzz")).toBe("b");
    expect(pickDefault([{ id: "c", isDefault: true, position: 5 }, ...list])).toBe("c");
    expect(pickDefault([])).toBeNull();
  });
});

describe("prices", () => {
  it("exclusiveOf takes GST out of tax-inclusive prices only", () => {
    expect(exclusiveOf(105000, 5, true)).toBe(100000);
    expect(exclusiveOf(105000, 5, false)).toBe(105000);
    expect(exclusiveOf(999, 12, true)).toBe(892);
    expect(exclusiveOf(500, 0, true)).toBe(500);
  });
  it("inclusiveOf grosses a rate up again", () => {
    expect(inclusiveOf(100000, 5, true)).toBe(105000);
    expect(inclusiveOf(100000, 5, false)).toBe(100000);
  });
  it("summarises the price range", () => {
    expect(priceRange([{ price: 500 }, { price: 200 }, { price: 900 }])).toEqual({ priceMin: 200, priceMax: 900 });
    expect(priceRange([{ price: 700 }])).toEqual({ priceMin: 700, priceMax: 700 });
    expect(priceRange([])).toEqual({ priceMin: 0, priceMax: 0 });
  });
});

const variant = (patch: Partial<Variant>): Variant => ({
  id: "v1",
  productId: "p1",
  sku: "SKU-1",
  barcode: null,
  title: "",
  optionValues: {},
  price: 1000,
  mrp: 1200,
  cost: 600,
  weightGrams: null,
  position: 0,
  isDefault: true,
  ...patch,
});

const product: Product = {
  id: "p1",
  name: "Shirt",
  slug: "shirt",
  description: null,
  brand: null,
  categoryId: "c1",
  hsn: "6205",
  gstRate: 12,
  unit: "pcs",
  taxInclusive: true,
  status: "active",
  channels: ["store", "billing"],
  tags: [],
  attributes: { Fabric: "Cotton" },
  options: [{ name: "Size", values: ["S", "M"] }],
  images: [{ url: "https://img/1.jpg", alt: null }],
  seo: null,
  variants: [variant({ id: "v1", title: "S", price: 1500, mrp: 2000 }), variant({ id: "v2", title: "M", price: 1000, mrp: 1100, isDefault: false, position: 1 })],
  createdAt: new Date("2026-10-01T00:00:00Z"),
  updatedAt: new Date("2026-10-02T00:00:00Z"),
};

describe("output shapes", () => {
  it("summarises a product for lists", () => {
    const { variants, ...base } = product;
    expect(toSummary(base, variants, "Shirts")).toEqual({
      id: "p1",
      name: "Shirt",
      slug: "shirt",
      status: "active",
      categoryId: "c1",
      categoryName: "Shirts",
      image: "https://img/1.jpg",
      priceMin: 1000,
      priceMax: 1500,
      variantCount: 2,
      channels: ["store", "billing"],
      updatedAt: product.updatedAt,
    });
    expect(toPublicSummary(base, variants, null)).toMatchObject({ priceMin: 1000, priceMax: 1500, mrp: 1100, taxInclusive: true });
  });

  it("never exposes cost prices (or status/channels) publicly", () => {
    const pub = toPublicProduct(product, { name: "Shirts", slug: "shirts" });
    expect(JSON.stringify(pub)).not.toContain('"cost"');
    expect(pub.variants[0]).not.toHaveProperty("cost");
    expect(pub).not.toHaveProperty("status");
    expect(pub).not.toHaveProperty("channels");
    expect(pub).toMatchObject({ categoryName: "Shirts", categorySlug: "shirts", priceMin: 1000, priceMax: 1500 });
    expect(pub.variants.map((v) => v.price)).toEqual([1500, 1000]);
    // The source object is untouched.
    expect(product.variants[0]!.cost).toBe(600);
  });
});

describe("categories", () => {
  const cat = (id: string, parentId: string | null, sort = 0, name = id): Category => ({
    id,
    parentId,
    name,
    slug: id,
    description: null,
    imageUrl: null,
    sort,
    active: true,
    seo: null,
    productCount: 0,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
  const list = [cat("men", null, 1), cat("women", null, 0), cat("shirts", "men"), cat("formal", "shirts"), cat("orphan", "gone")];

  it("builds a sorted tree; orphans become roots", () => {
    const tree = buildTree(list);
    expect(tree.map((n) => n.id)).toEqual(["orphan", "women", "men"]);
    expect(tree[2]!.children[0]!.children[0]!.id).toBe("formal");
  });
  it("finds descendants and cycles", () => {
    expect(descendantIds(list, "men")).toEqual(["men", "shirts", "formal"]);
    expect(wouldCycle(list, "men", "formal")).toBe(true);
    expect(wouldCycle(list, "formal", "men")).toBe(false);
  });
});

it("todayIST uses the IST calendar date", () => {
  expect(todayIST(new Date("2026-10-14T19:00:00Z"))).toBe("2026-10-15");
  expect(todayIST(new Date("2026-10-14T18:00:00Z"))).toBe("2026-10-14");
});
