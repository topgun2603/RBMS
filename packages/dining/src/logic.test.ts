import { describe, expect, it } from "vitest";
import { canMoveKot, groupByStation, mergeLines, minutesSince, orderAmount, splitLines } from "./logic";

describe("orderAmount", () => {
  it("sums qty × rate in paise", () => {
    expect(orderAmount([{ qty: 2, rate: 9000 }, { qty: 0.5, rate: 18001 }])).toBe(27001);
  });
});

describe("groupByStation", () => {
  it("keeps line order inside each station and treats blank as kitchen", () => {
    const g = groupByStation([
      { id: "a", station: "kitchen" },
      { id: "b", station: "bar" },
      { id: "c", station: " " },
    ]);
    expect([...g.keys()]).toEqual(["kitchen", "bar"]);
    expect(g.get("kitchen")!.map((l) => l.id)).toEqual(["a", "c"]);
  });
});

describe("canMoveKot", () => {
  it("allows the kitchen flow and one-step undo, never out of cancelled", () => {
    expect(canMoveKot("new", "preparing")).toBe(true);
    expect(canMoveKot("preparing", "ready")).toBe(true);
    expect(canMoveKot("ready", "served")).toBe(true);
    expect(canMoveKot("served", "ready")).toBe(true);
    expect(canMoveKot("ready", "new")).toBe(false);
    expect(canMoveKot("cancelled", "new")).toBe(false);
  });
});

describe("splitLines", () => {
  const lines = [{ id: "1" }, { id: "2" }, { id: "3" }];
  it("puts unlisted lines on a last bill", () => {
    expect(splitLines(lines, [["2"]]).bills.map((b) => b.map((l) => l.id))).toEqual([["2"], ["1", "3"]]);
  });
  it("rejects unknown and duplicated lines", () => {
    expect(splitLines(lines, [["9"]]).error).toBe("unknown_line");
    expect(splitLines(lines, [["1"], ["1"]]).error).toBe("line_in_two_bills");
  });
});

describe("mergeLines", () => {
  it("merges identical items and keeps different notes apart", () => {
    const m = mergeLines([
      { itemId: "dosa", name: "Dosa", rate: 9000, note: null, qty: 1 },
      { itemId: "dosa", name: "Dosa", rate: 9000, note: null, qty: 2 },
      { itemId: "dosa", name: "Dosa", rate: 9000, note: "crispy", qty: 1 },
    ]);
    expect(m.map((l) => [l.note, l.qty])).toEqual([
      [null, 3],
      ["crispy", 1],
    ]);
  });
});

describe("minutesSince", () => {
  it("floors and never goes negative", () => {
    const t = new Date("2026-10-20T10:00:00Z");
    expect(minutesSince(t, new Date("2026-10-20T10:07:59Z"))).toBe(7);
    expect(minutesSince(t, new Date("2026-10-20T09:00:00Z"))).toBe(0);
  });
});
