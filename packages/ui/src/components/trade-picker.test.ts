import { describe, expect, it } from "vitest";
import { filterTradeGroups, TRADE_NOT_LISTED, type TradeGroup } from "./trade-picker";

const groups: TradeGroup[] = [
  { key: "food", label: "Food & drink", options: [{ value: "bakery", label: "Bakery & sweets", hint: "Cakes by weight", keywords: "பேக்கரி" }, { value: "tea_stall", label: "Tea stall", keywords: "டீக்கடை chai" }] },
  { key: "services", label: "Services", options: [{ value: "laundry", label: "Laundry & dry cleaning", keywords: "dhobi சலவை" }] },
];

describe("filterTradeGroups", () => {
  it("returns every group for an empty search", () => {
    expect(filterTradeGroups(groups, "")).toEqual(groups);
    expect(filterTradeGroups(groups, "   ")).toEqual(groups);
  });
  it("matches the name, hint, keywords (either language) and group heading, case-insensitively", () => {
    expect(filterTradeGroups(groups, "BAKERY").map((g) => g.options.map((o) => o.value))).toEqual([["bakery"]]);
    expect(filterTradeGroups(groups, "by weight").flatMap((g) => g.options.map((o) => o.value))).toEqual(["bakery"]);
    expect(filterTradeGroups(groups, "chai").flatMap((g) => g.options.map((o) => o.value))).toEqual(["tea_stall"]);
    expect(filterTradeGroups(groups, "சலவை").flatMap((g) => g.options.map((o) => o.value))).toEqual(["laundry"]);
    expect(filterTradeGroups(groups, "services").flatMap((g) => g.options.map((o) => o.value))).toEqual(["laundry"]);
  });
  it("needs every word, drops empty groups and returns nothing when nothing matches", () => {
    expect(filterTradeGroups(groups, "dry cleaning").map((g) => g.key)).toEqual(["services"]);
    expect(filterTradeGroups(groups, "dry bakery")).toEqual([]);
    expect(filterTradeGroups(groups, "lodge")).toEqual([]);
  });
  it("keeps a sentinel for the 'Not listed' option that no trade id can collide with", () => {
    expect(TRADE_NOT_LISTED.startsWith("__")).toBe(true);
  });
});
