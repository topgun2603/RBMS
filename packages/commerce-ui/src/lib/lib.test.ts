import { describe, expect, it } from "vitest";
import { buildTree, flattenTree, subtreeIds, totalProducts } from "./categories";
import { cleanQty, discountPct, formatQty, money, orNull, paiseToInput, parseQty, priceRange } from "./format";
import { moveItem } from "../components/sortable";
import type { Category } from "./types";

const cat = (id: string, name: string, parentId: string | null, sort = 0, productCount = 0): Category => ({
  id,
  parentId,
  name,
  slug: name.toLowerCase(),
  description: null,
  imageUrl: null,
  sort,
  active: true,
  seo: null,
  productCount,
  createdAt: "2026-11-01T00:00:00Z",
  updatedAt: "2026-11-01T00:00:00Z",
});

describe("catalogue money", () => {
  it("shows a price or a price range from the cheapest to the dearest variant", () => {
    expect(money(49_900)).toBe("₹499.00");
    expect(money(null)).toBe("₹0.00");
    expect(priceRange(49_900, 49_900)).toBe("₹499.00");
    expect(priceRange(49_900, 89_900)).toBe("₹499.00 – ₹899.00");
  });

  it("works out the percentage off MRP, only when the price is really lower", () => {
    expect(discountPct(80_000, 100_000)).toBe(20);
    expect(discountPct(66_700, 100_000)).toBe(33);
    expect(discountPct(100_000, 100_000)).toBeNull();
    expect(discountPct(120_000, 100_000)).toBeNull();
    expect(discountPct(80_000, null)).toBeNull();
    expect(discountPct(80_000, 0)).toBeNull();
  });

  it("shows paise in an input and reads quantities with up to three decimals", () => {
    expect(paiseToInput(129_950)).toBe("1299.5");
    expect(paiseToInput(49_900)).toBe("499");
    expect(paiseToInput(null)).toBe("");
    expect(parseQty("2.125")).toBe(2.125);
    expect(parseQty("2.1255")).toBeNull();
    expect(cleanQty("1.2.3x4")).toBe("1.234");
    expect(cleanQty("0.12345")).toBe("0.123");
    expect(formatQty(1234.5)).toBe("1,234.5");
  });

  it("trims optional text and turns empty into null", () => {
    expect(orNull("  x ")).toBe("x");
    expect(orNull("   ")).toBeNull();
    expect(orNull(undefined)).toBeNull();
  });
});

describe("category tree", () => {
  const flat = [
    cat("men", "Men", null, 2, 1),
    cat("women", "Women", null, 1, 2),
    cat("sarees", "Sarees", "women", 2, 10),
    cat("kurtas", "Kurtas", "women", 1, 5),
    cat("silk", "Silk", "sarees", 0, 3),
    cat("lost", "Lost", "deleted-parent", 5, 4),
  ];

  it("orders siblings by sort then name, and puts a category with a missing parent at the top level", () => {
    const tree = buildTree(flat);
    expect(tree.map((n) => n.id)).toEqual(["women", "men", "lost"]);
    expect(tree[0]!.children.map((n) => n.id)).toEqual(["kurtas", "sarees"]);
    expect(tree[0]!.children[1]!.children.map((n) => n.id)).toEqual(["silk"]);
  });

  it("breaks a sort tie by name", () => {
    const tree = buildTree([cat("b", "Bags", null, 0), cat("a", "Anklets", null, 0)]);
    expect(tree.map((n) => n.name)).toEqual(["Anklets", "Bags"]);
  });

  it("flattens depth first with a breadcrumb path", () => {
    const out = flattenTree(buildTree(flat));
    expect(out.map((c) => [c.id, c.depth, c.path, c.hasChildren])).toEqual([
      ["women", 0, "Women", true],
      ["kurtas", 1, "Women › Kurtas", false],
      ["sarees", 1, "Women › Sarees", true],
      ["silk", 2, "Women › Sarees › Silk", false],
      ["men", 0, "Men", false],
      ["lost", 0, "Lost", false],
    ]);
  });

  it("finds a category and everything below it, so a category can't be moved into itself", () => {
    expect([...subtreeIds(flat, "women")].sort()).toEqual(["kurtas", "sarees", "silk", "women"]);
    expect([...subtreeIds(flat, "silk")]).toEqual(["silk"]);
    // Children listed before their parent are still found.
    expect([...subtreeIds([cat("c", "C", "b"), cat("b", "B", "a"), cat("a", "A", null)], "a")].sort()).toEqual(["a", "b", "c"]);
  });

  it("counts a category's products with all its subcategories", () => {
    const women = buildTree(flat)[0]!;
    expect(totalProducts(women)).toBe(2 + 5 + 10 + 3);
  });
});

describe("reordering", () => {
  it("moves an item and leaves the original list alone", () => {
    const list = ["a", "b", "c", "d"];
    expect(moveItem(list, 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(list, 3, 1)).toEqual(["a", "d", "b", "c"]);
    expect(list).toEqual(["a", "b", "c", "d"]);
  });

  it("does nothing for an out-of-range or same-place move", () => {
    expect(moveItem(["a", "b"], 0, 2)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], -1, 1)).toEqual(["a", "b"]);
    expect(moveItem(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });
});
