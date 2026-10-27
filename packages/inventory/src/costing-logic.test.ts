import { describe, expect, it } from "vitest";
import {
  allocateCharges,
  basisWeights,
  chargeCost,
  drawValue,
  fyStartOf,
  incomingCost,
  methodAt,
  outgoingCost,
  planDraw,
  replayHistory,
  splitLanded,
  switchProblem,
  type OpenLayer,
  type ReplayMovement,
} from "./costing-logic";

const layer = (id: string, at: number, milli: number, value: number, extra: Partial<OpenLayer> = {}): OpenLayer => ({ id, at, seq: at, batchId: null, refKey: null, milli, value, ...extra });

describe("FIFO draws", () => {
  it("takes the oldest layer first and values each part at its own cost", () => {
    const plan = planDraw([layer("b", 2, 10_000, 12_000), layer("a", 1, 5_000, 5_000)], 8_000);
    expect(plan.parts).toEqual([
      { layerId: "a", milli: 5_000, value: 5_000 },
      { layerId: "b", milli: 3_000, value: 3_600 },
    ]);
    expect(plan.shortMilli).toBe(0);
  });

  it("never loses a paisa: the last units of a layer take what is left", () => {
    expect(drawValue({ milli: 3_000, value: 1_000 }, 1_000)).toBe(333);
    expect(drawValue({ milli: 2_000, value: 667 }, 2_000)).toBe(667);
  });

  it("prefers the document's own layers (purchase cancelled / returned) and the batches sold", () => {
    const layers = [layer("old", 1, 5_000, 5_000), layer("own", 2, 5_000, 7_000, { refKey: "purchase:P2" }), layer("b1", 3, 5_000, 9_000, { batchId: "B1" })];
    expect(planDraw(layers, 2_000, { refKeys: ["purchase:P2"] }).parts).toEqual([{ layerId: "own", milli: 2_000, value: 2_800 }]);
    expect(planDraw(layers, 2_000, { batches: [{ batchId: "B1", milli: 2_000 }] }).parts).toEqual([{ layerId: "b1", milli: 2_000, value: 3_600 }]);
    // Unbatched stock comes from unbatched layers before batch layers.
    expect(planDraw([layer("b1", 1, 5_000, 9_000, { batchId: "B1" }), layer("u", 2, 5_000, 5_000)], 1_000).parts[0]!.layerId).toBe("u");
  });

  it("reports what no layer covers (stock going below zero) and values it at the average", () => {
    const plan = planDraw([layer("a", 1, 1_000, 1_000)], 3_000);
    expect(plan.shortMilli).toBe(2_000);
    expect(outgoingCost(3_000, 1_500, plan)).toEqual({ costAvg: -4_500, costFifo: -(1_000 + 3_000), shortValue: 3_000 });
  });
});

describe("incoming cost", () => {
  it("purchases come in at their cost; returns at the cost they went out with", () => {
    expect(incomingCost({ deltaMilli: 2_000, beforeMilli: 0, unitCost: 1_200, avgBefore: 1_000, counterpart: null })).toEqual({ costAvg: 2_400, costFifo: 2_400, layerMilli: 2_000, layerValue: 2_400 });
    // A credit note returning 1 of 4 sold for 4,000 (avg) / 3,600 (FIFO).
    expect(incomingCost({ deltaMilli: 1_000, beforeMilli: 5_000, unitCost: null, avgBefore: 1_500, counterpart: { milli: 4_000, avg: 4_000, fifo: 3_600 } })).toEqual({ costAvg: 1_000, costFifo: 900, layerMilli: 1_000, layerValue: 900 });
  });

  it("first covers stock that went below zero", () => {
    const c = incomingCost({ deltaMilli: 5_000, beforeMilli: -2_000, unitCost: 1_000, avgBefore: null, counterpart: null });
    expect(c.layerMilli).toBe(3_000);
    expect(c.layerValue).toBe(3_000);
    expect(c.costFifo).toBe(5_000);
  });
});

describe("landed charges", () => {
  const lines = [
    { taxable: 60_000, milli: 10_000, weightGrams: 500 },
    { taxable: 40_000, milli: 30_000, weightGrams: 1_000 },
  ];
  it("spreads by value, quantity or weight (value when no item has a weight)", () => {
    expect(allocateCharges(lines, [{ amount: 10_000, gst: 0, claimable: true, basis: "value" }])).toEqual([6_000, 4_000]);
    expect(allocateCharges(lines, [{ amount: 10_000, gst: 0, claimable: true, basis: "qty" }])).toEqual([2_500, 7_500]);
    // 10 x 500 g vs 30 x 1,000 g
    expect(allocateCharges(lines, [{ amount: 7_000, gst: 0, claimable: true, basis: "weight" }])).toEqual([1_000, 6_000]);
    expect(basisWeights(lines.map((l) => ({ ...l, weightGrams: null })), "weight")).toEqual([60_000, 40_000]);
  });
  it("adds GST that can't be claimed to the cost; claimable GST stays out", () => {
    expect(chargeCost({ amount: 1_000, gst: 180, claimable: true })).toBe(1_000);
    expect(chargeCost({ amount: 1_000, gst: 180, claimable: false })).toBe(1_180);
    expect(allocateCharges(lines, [{ amount: 1_000, gst: 180, claimable: false, basis: "value" }], 500)).toEqual([300 + 708, 200 + 472]);
  });
  it("a later voucher goes to stock for what is left and to cost of goods for what was sold", () => {
    expect(splitLanded(10_000, [{ ...lines[0]!, remainingMilli: 2_500 }, { ...lines[1]!, remainingMilli: 30_000 }], "value")).toEqual([
      { share: 6_000, toStock: 1_500, toSold: 4_500 },
      { share: 4_000, toStock: 4_000, toSold: 0 },
    ]);
  });
});

describe("valuation method", () => {
  const history = [{ method: "fifo" as const, from: "2027-04-01" }];
  it("is weighted average until a switch, then the switched method", () => {
    expect(methodAt([], "2026-10-01")).toBe("average");
    expect(methodAt(history, "2027-03-31")).toBe("average");
    expect(methodAt(history, "2027-04-01")).toBe("fifo");
    expect(fyStartOf("2027-03-31")).toBe("2026-04-01");
    expect(fyStartOf("2027-04-01")).toBe("2027-04-01");
  });
  it("switches only from an unlocked financial year start, this year or next", () => {
    const base = { method: "fifo" as const, today: "2026-10-27", lockedThrough: null, history: [] };
    expect(switchProblem({ ...base, from: "2026-04-01" })).toBeNull();
    expect(switchProblem({ ...base, from: "2027-04-01" })).toBeNull();
    expect(switchProblem({ ...base, from: "2026-10-01" })).toMatch(/1 April/);
    expect(switchProblem({ ...base, from: "2028-04-01" })).toMatch(/next one/);
    expect(switchProblem({ ...base, from: "2026-04-01", lockedThrough: "2026-06-30" })).toMatch(/locked/);
    expect(switchProblem({ ...base, method: "average", from: "2026-04-01" })).toMatch(/already/);
    expect(switchProblem({ ...base, method: "average", from: "2026-04-01", history })).toMatch(/already changed/);
  });
});

describe("history replay", () => {
  let id = 0;
  const m = (p: Partial<ReplayMovement> & Pick<ReplayMovement, "deltaMilli" | "reason">): ReplayMovement => ({ id: `m${++id}`, itemId: "I", locationId: p.locationId ?? "L1", refType: null, refId: null, unitCost: null, at: id, ...p });

  it("builds layers, FIFO draws and both costs; returns and transfers carry the cost they left with; audit write-offs draw oldest", () => {
    const moves = [
      m({ deltaMilli: 10_000, reason: "purchase", refType: "purchase", refId: "P1", unitCost: 1_000 }),
      m({ deltaMilli: 10_000, reason: "purchase", refType: "purchase", refId: "P2", unitCost: 2_000 }),
      m({ deltaMilli: -12_000, reason: "sale", refType: "invoice", refId: "INV1" }),
      m({ deltaMilli: 2_000, reason: "sale_return", refType: "credit_note", refId: "CN1" }),
      m({ deltaMilli: -3_000, reason: "transfer_out", refType: "transfer", refId: "T1" }),
      m({ deltaMilli: 3_000, reason: "transfer_in", refType: "transfer", refId: "T1", locationId: "L2", unitCost: 1_500 }),
      m({ deltaMilli: -1_000, reason: "audit", refType: "audit", refId: "A1" }),
    ];
    const r = replayHistory(moves, [], new Map([["CN1", "INV1"]]), (() => { let k = 0; return () => `l${++k}`; })());
    // Sale of 12: 10 @ 10 + 2 @ 20 = 140 (FIFO); average 15 x 12 = 180.
    expect(r.costs.get(moves[2]!.id)).toEqual({ costAvg: -18_000, costFifo: -14_000 });
    // Return of 2 of the 12: back at the sale's cost (avg 1,500/unit, FIFO 1,167/unit).
    expect(r.costs.get(moves[3]!.id)).toEqual({ costAvg: 3_000, costFifo: 2_333 });
    // Transfer out of 3 takes the oldest layer left (8 @ 20 from P2), and comes in at the other location at that cost.
    expect(r.costs.get(moves[4]!.id)!.costFifo).toBe(-6_000);
    expect(r.costs.get(moves[5]!.id)!.costFifo).toBe(6_000);
    // Audit write-off of 1 at L1: next oldest (P2 layer, 20).
    expect(r.costs.get(moves[6]!.id)!.costFifo).toBe(-2_000);
    const left = (loc: string) => r.layers.filter((l) => l.locationId === loc).reduce((s, l) => s + l.remainingMilli, 0);
    expect(left("L1")).toBe(6_000);
    expect(left("L2")).toBe(3_000);
    const value = r.layers.reduce((s, l) => s + l.remainingValue, 0);
    // L1: 4 @ 20 (P2) + 2 returned @ 1,167 + L2: 3 @ 20.
    expect(value).toBe(8_000 + 2_333 + 6_000);
  });

  it("follows the batches recorded on the batch ledger", () => {
    const moves = [m({ deltaMilli: 10_000, reason: "purchase", refType: "purchase", refId: "PB", unitCost: 1_000 }), m({ deltaMilli: -4_000, reason: "sale", refType: "invoice", refId: "IB" })];
    const r = replayHistory(
      moves,
      [
        { refType: "purchase", refId: "PB", itemId: "I", locationId: "L1", batchId: "B1", deltaMilli: 6_000, reason: "receive" },
        { refType: "invoice", refId: "IB", itemId: "I", locationId: "L1", batchId: "B1", deltaMilli: -4_000, reason: "sale" },
      ],
      new Map(),
      (() => { let k = 0; return () => `x${++k}`; })(),
    );
    const b1 = r.layers.find((l) => l.batchId === "B1")!;
    expect(b1.milli).toBe(6_000);
    expect(b1.remainingMilli).toBe(2_000);
    expect(r.layers.find((l) => l.batchId === null)!.remainingMilli).toBe(4_000);
  });
});
