import { describe, expect, it } from "vitest";
import { closeBlockers, differenceKind } from "./close-check";

const base = { counted: 100_000, expected: 100_000, reason: "", pendingBills: 0, closeAnyway: false };

describe("closeBlockers", () => {
  it("lets a matching count close with nothing pending", () => {
    expect(closeBlockers(base)).toEqual([]);
  });

  it("waits for the expected cash to load", () => {
    expect(closeBlockers({ ...base, expected: null })).toEqual(["no_count"]);
  });

  it("asks for a reason when the count is short or over, and accepts it once typed", () => {
    expect(closeBlockers({ ...base, counted: 99_000 })).toEqual(["reason"]);
    expect(closeBlockers({ ...base, counted: 101_000 })).toEqual(["reason"]);
    expect(closeBlockers({ ...base, counted: 99_000, reason: "  " })).toEqual(["reason"]);
    expect(closeBlockers({ ...base, counted: 99_000, reason: "gave extra change" })).toEqual([]);
  });

  it("holds the Z report while offline bills have not synced, unless the cashier closes anyway", () => {
    expect(closeBlockers({ ...base, pendingBills: 2 })).toEqual(["offline_pending"]);
    expect(closeBlockers({ ...base, pendingBills: 2, closeAnyway: true })).toEqual([]);
  });

  it("lists every blocker", () => {
    expect(closeBlockers({ ...base, counted: 1, pendingBills: 1 })).toEqual(["reason", "offline_pending"]);
  });
});

describe("differenceKind", () => {
  it("names the sign", () => {
    expect([differenceKind(-1), differenceKind(0), differenceKind(5)]).toEqual(["short", "match", "over"]);
  });
});
