import { describe, expect, it } from "vitest";
import { COMPARE_MAX, compareRows, parseCompare, removeCompare, toggleCompare, valuesDiffer, type CompareItem } from "./compare";

const id = (n: number) => `0b6f5f36-0000-4000-8000-${String(n).padStart(12, "0")}`;
const item = (n: number): CompareItem => ({ id: id(n), slug: `p-${n}`, name: `Phone ${n}`, image: null });

describe("compare storage", () => {
  it("parses only clean entries, without duplicates, at most four", () => {
    const raw = JSON.stringify([item(1), item(1), { id: "nope", slug: "x" }, { slug: "no-id" }, null, 7, item(2), item(3), item(4), item(5)]);
    expect(parseCompare(raw).map((x) => x.slug)).toEqual(["p-1", "p-2", "p-3", "p-4"]);
    expect(parseCompare("{not json")).toEqual([]);
    expect(parseCompare(null)).toEqual([]);
    expect(parseCompare('{"a":1}')).toEqual([]);
    expect(parseCompare(JSON.stringify([{ id: id(9), slug: "s" }]))).toEqual([{ id: id(9), slug: "s", name: "s", image: null }]);
  });

  it("toggles: adds at the end, removes when there, refuses a fifth", () => {
    let r = toggleCompare([], item(1));
    expect(r).toEqual({ list: [item(1)], status: "added" });
    r = toggleCompare(r.list, item(2));
    expect(r.list.map((x) => x.slug)).toEqual(["p-1", "p-2"]);
    expect(toggleCompare(r.list, item(1))).toEqual({ list: [item(2)], status: "removed" });
    const full = [1, 2, 3, 4].map(item);
    expect(full).toHaveLength(COMPARE_MAX);
    expect(toggleCompare(full, item(5))).toEqual({ list: full, status: "full" });
    // A full list still lets you take one out.
    expect(toggleCompare(full, item(4)).status).toBe("removed");
    expect(removeCompare(full, id(2)).map((x) => x.slug)).toEqual(["p-1", "p-3", "p-4"]);
  });
});

describe("compare table", () => {
  const base = { brand: null, categoryName: null, options: [], attributes: {}, unit: "pcs" };
  it("builds brand, category, option and attribute rows and flags differences", () => {
    const rows = compareRows(
      [
        { ...base, brand: "Samsung", categoryName: "Mobiles", options: [{ name: "Storage", values: ["128 GB", "256 GB"] }], attributes: { RAM: "8 GB", Battery: "5000 mAh" } },
        { ...base, brand: "samsung ", categoryName: "Mobiles", options: [{ name: "storage", values: ["128 GB"] }], attributes: { RAM: "6 GB" } },
      ],
      { brand: "Brand", category: "Category" },
    );
    expect(rows.map((r) => [r.key, r.differs])).toEqual([
      ["brand", false],
      ["category", false],
      ["opt.Storage", true],
      ["attr.RAM", true],
      ["attr.Battery", true],
    ]);
    expect(rows[2]!.values).toEqual(["128 GB, 256 GB", "128 GB"]);
    expect(rows[4]!.values).toEqual(["5000 mAh", ""]);
  });

  it("skips rows nobody has, and one product never differs", () => {
    expect(compareRows([base, base], { brand: "B", category: "C" })).toEqual([]);
    expect(valuesDiffer(["a"])).toBe(false);
    expect(valuesDiffer(["a", "A "])).toBe(false);
    expect(valuesDiffer(["a", ""])).toBe(true);
  });
});
