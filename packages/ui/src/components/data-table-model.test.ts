import { describe, expect, it } from "vitest";
import {
  ariaSort,
  cardSlots,
  clampPage,
  columnLabel,
  columnSortKey,
  hasCardLayout,
  initialVisibility,
  matchPreset,
  nextSort,
  pageWindow,
  presetDateRange,
  rangeInfo,
  readVisibility,
  sortFromParam,
  sortToParam,
  visibilityStorageKey,
  writeVisibility,
  type KeyValueStore,
} from "./data-table-model";

const memoryStore = (init: Record<string, string> = {}): KeyValueStore & { data: Record<string, string> } => {
  const data = { ...init };
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) };
};

describe("columns", () => {
  it("resolves sort keys and labels", () => {
    expect(columnSortKey({ id: "total", sortable: true })).toBe("total");
    expect(columnSortKey({ id: "customer", sortable: "customerName" })).toBe("customerName");
    expect(columnSortKey({ id: "actions" })).toBeNull();
    expect(columnLabel({ id: "total", header: "Total" })).toBe("Total");
    expect(columnLabel({ id: "total", header: { el: 1 }, label: "Amount" })).toBe("Amount");
    expect(columnLabel({ id: "total", header: { el: 1 } })).toBe("total");
  });

  it("groups card slots in declaration order", () => {
    const cols = [
      { id: "number", card: "subtitle" as const },
      { id: "customer", card: "title" as const },
      { id: "total", card: "right" as const },
      { id: "status", card: "right" as const },
      { id: "date", card: "meta" as const },
      { id: "branch" },
    ];
    const s = cardSlots(cols);
    expect(s.title.map((c) => c.id)).toEqual(["customer"]);
    expect(s.subtitle.map((c) => c.id)).toEqual(["number"]);
    expect(s.right.map((c) => c.id)).toEqual(["total", "status"]);
    expect(s.meta.map((c) => c.id)).toEqual(["date"]);
    expect(hasCardLayout(cols)).toBe(true);
    expect(hasCardLayout([{ id: "x" }, { id: "y", card: false as const }])).toBe(false);
  });
});

describe("sorting", () => {
  it("cycles asc → desc → default", () => {
    expect(nextSort(null, "total")).toEqual({ id: "total", desc: false });
    expect(nextSort({ id: "total", desc: false }, "total")).toEqual({ id: "total", desc: true });
    expect(nextSort({ id: "total", desc: true }, "total")).toBeNull();
    expect(nextSort({ id: "date", desc: true }, "total")).toEqual({ id: "total", desc: false });
  });
  it("starts descending for descFirst columns", () => {
    expect(nextSort(null, "date", true)).toEqual({ id: "date", desc: true });
    expect(nextSort({ id: "date", desc: true }, "date", true)).toEqual({ id: "date", desc: false });
    expect(nextSort({ id: "date", desc: false }, "date", true)).toBeNull();
  });
  it("reports aria-sort", () => {
    expect(ariaSort({ id: "total", desc: true }, "total")).toBe("descending");
    expect(ariaSort({ id: "total", desc: false }, "total")).toBe("ascending");
    expect(ariaSort({ id: "date", desc: false }, "total")).toBe("none");
    expect(ariaSort(null, null)).toBeUndefined();
  });
  it("round-trips the URL form", () => {
    expect(sortToParam({ id: "date", desc: true })).toBe("-date");
    expect(sortToParam(null)).toBeUndefined();
    expect(sortFromParam("-date")).toEqual({ id: "date", desc: true });
    expect(sortFromParam("total", ["total"])).toEqual({ id: "total", desc: false });
    expect(sortFromParam("secret", ["total"])).toBeNull();
    expect(sortFromParam("-")).toBeNull();
  });
});

describe("paging", () => {
  it("computes the visible range", () => {
    expect(rangeInfo(0, 25, 25, 1234)).toEqual({ from: 1, to: 25, total: 1234, pageCount: 50 });
    expect(rangeInfo(49, 25, 9, 1234)).toEqual({ from: 1226, to: 1234, total: 1234, pageCount: 50 });
    expect(rangeInfo(0, 25, 0, 0)).toEqual({ from: 0, to: 0, total: 0, pageCount: 1 });
    expect(rangeInfo(2, 10, 10)).toMatchObject({ from: 21, to: 30, pageCount: undefined });
  });
  it("windows page numbers with gaps", () => {
    expect(pageWindow(0, 1)).toEqual([0]);
    expect(pageWindow(2, 5)).toEqual([0, 1, 2, 3, 4]);
    expect(pageWindow(0, 20)).toEqual([0, 1, 2, 3, 4, "…", 19]);
    expect(pageWindow(9, 20)).toEqual([0, "…", 8, 9, 10, "…", 19]);
    expect(pageWindow(19, 20)).toEqual([0, "…", 15, 16, 17, 18, 19]);
    expect(pageWindow(3, 20)).toEqual([0, 1, 2, 3, 4, "…", 19]);
    expect(pageWindow(4, 20)).toEqual([0, "…", 3, 4, 5, "…", 19]);
    expect(pageWindow(2, 20)).toEqual([0, 1, 2, 3, 4, "…", 19]);
    for (let p = 0; p < 40; p++) expect(pageWindow(p, 40).length).toBeLessThanOrEqual(7);
    expect(pageWindow(0, 0)).toEqual([]);
  });
  it("clamps a page past the end", () => {
    expect(clampPage(9, 25, 30)).toBe(1);
    expect(clampPage(-1, 25, 30)).toBe(0);
    expect(clampPage(3, 25, undefined)).toBe(3);
    expect(clampPage(3, 25, 0)).toBe(0);
  });
});

describe("column visibility", () => {
  const cols = [{ id: "number", hideable: false }, { id: "branch", defaultHidden: true }, { id: "total" }];
  it("starts from defaults, then the saved choice", () => {
    expect(initialVisibility(cols, null)).toEqual({ branch: false });
    expect(initialVisibility(cols, { branch: true, total: false, number: false, gone: false })).toEqual({ branch: true, total: false });
  });
  it("reads and writes storage, surviving bad data and throwing stores", () => {
    const store = memoryStore();
    writeVisibility(store, "billing.invoices", { total: false });
    expect(store.data[visibilityStorageKey("billing.invoices")]).toBe('{"total":false}');
    expect(readVisibility(store, "billing.invoices")).toEqual({ total: false });
    expect(readVisibility(memoryStore({ [visibilityStorageKey("x")]: "{oops" }), "x")).toBeNull();
    expect(readVisibility(memoryStore({ [visibilityStorageKey("x")]: "[1]" }), "x")).toBeNull();
    expect(readVisibility(memoryStore({ [visibilityStorageKey("x")]: '{"a":1,"b":true}' }), "x")).toEqual({ b: true });
    const throwing: KeyValueStore = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("quota");
      },
    };
    expect(readVisibility(throwing, "x")).toBeNull();
    expect(() => writeVisibility(throwing, "x", {})).not.toThrow();
    expect(readVisibility(null, "x")).toBeNull();
  });
});

describe("date presets", () => {
  it("builds IST calendar ranges", () => {
    const today = "2026-03-15";
    expect(presetDateRange("today", today)).toEqual({ from: today, to: today });
    expect(presetDateRange("yesterday", today)).toEqual({ from: "2026-03-14", to: "2026-03-14" });
    expect(presetDateRange("last7", today)).toEqual({ from: "2026-03-09", to: today });
    expect(presetDateRange("last30", today)).toEqual({ from: "2026-02-14", to: today });
    expect(presetDateRange("thisMonth", today)).toEqual({ from: "2026-03-01", to: today });
    expect(presetDateRange("lastMonth", today)).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(presetDateRange("lastMonth", "2026-01-10")).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    expect(presetDateRange("thisFY", today)).toEqual({ from: "2025-04-01", to: today });
    expect(presetDateRange("thisFY", "2026-04-01")).toEqual({ from: "2026-04-01", to: "2026-04-01" });
  });
  it("recognises a preset range", () => {
    expect(matchPreset({ from: "2026-03-09", to: "2026-03-15" }, "2026-03-15")).toBe("last7");
    expect(matchPreset({ from: "2026-03-02", to: "2026-03-15" }, "2026-03-15")).toBeNull();
    expect(matchPreset({ from: "2026-03-02" }, "2026-03-15")).toBeNull();
  });
});
