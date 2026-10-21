import { describe, expect, it } from "vitest";
import { ecoSummary, taxTreatment, valueOfSupply } from "./gst";
import { candidateIds, lineNote, resolveLines } from "./mapping";
import type { NormalizedItem } from "./types";

const ID_A = "11111111-1111-4111-8111-aaaaaaaaaaaa";
const ID_B = "22222222-2222-4222-8222-bbbbbbbbbbbb";
const item = (over: Partial<NormalizedItem>): NormalizedItem => ({
  externalId: "x",
  merchantRef: null,
  title: "Item",
  qty: 1,
  unitPrice: 10000,
  total: 10000,
  options: [],
  removed: [],
  note: null,
  ...over,
});

describe("menu mapping", () => {
  it("prefers an explicit mapping, then our own id pushed as the ref, else flags the line", () => {
    const lines = resolveLines(
      [
        item({ externalId: "99002", merchantRef: "UP-NAAN", title: "Garlic Naan" }),
        item({ externalId: "99001", merchantRef: ID_A, title: "Paneer" }),
        item({ externalId: "99003", merchantRef: ID_B, title: "Deleted dish" }),
        item({ externalId: "99004", title: "Mystery" }),
      ],
      new Map([["UP-NAAN", ID_B]]),
      new Set([ID_A]),
    );
    expect(lines.map((l) => [l.title, l.itemId, l.via])).toEqual([
      ["Garlic Naan", ID_B, "mapping"],
      ["Paneer", ID_A, "ref"],
      ["Deleted dish", null, null],
      ["Mystery", null, null],
    ]);
  });

  it("candidate ids are the uuids among refs and ids", () => {
    expect(candidateIds([item({ externalId: "1", merchantRef: ID_A }), item({ externalId: ID_B }), item({ externalId: "z", merchantRef: "SKU" })])).toEqual([ID_A, ID_B]);
  });

  it("writes options, left-outs and the note as one KOT note", () => {
    expect(lineNote({ options: [{ externalId: null, title: "Extra cheese", price: 0, qty: 1 }, { externalId: null, title: "Butter", price: 0, qty: 2 }], removed: ["Onion"], note: "Less spicy" })).toBe(
      "+ Extra cheese · + 2× Butter · − Onion · Less spicy",
    );
    expect(lineNote({ options: [], removed: [], note: null })).toBeNull();
    expect(lineNote({ options: [], removed: [], note: "x".repeat(300) })!.length).toBe(200);
  });
});

describe("GST section 9(5)", () => {
  const order = {
    platform: "zomato" as const,
    totals: { items: 46000, charges: 3000, discount: 5000, tax: 2300, total: 46300 },
    discounts: [
      { title: "WELCOME50", amount: 3000, fundedBy: "merchant" as const },
      { title: "Pro", amount: 2000, fundedBy: "platform" as const },
    ],
  };

  it("value of supply: items + charges − discounts the restaurant funds", () => {
    expect(valueOfSupply(order)).toBe(46000 + 3000 - 3000);
    expect(valueOfSupply({ ...order, discounts: [{ title: "?", amount: 1000, fundedBy: "unknown" }] })).toBe(48000);
  });

  it("eco_9_5: GST payable by the operator, with the note for the record", () => {
    const t = taxTreatment(order, "eco_9_5", "33AAACZ1234A1ZX");
    expect(t).toMatchObject({ mode: "eco_9_5", payableBy: "operator", operator: "Zomato", operatorGstin: "33AAACZ1234A1ZX", valueOfSupply: 46000, gst: 2300 });
    expect(t.note).toBe("GST ₹23.00 collected and paid by Zomato (GSTIN 33AAACZ1234A1ZX) under section 9(5) of the CGST Act; not charged by the restaurant.");
  });

  it("falls back to 5 % when the platform sent no tax; restaurant mode is charged by the shop", () => {
    expect(taxTreatment({ ...order, totals: { ...order.totals, tax: 0 } }, "eco_9_5").gst).toBe(2300);
    expect(taxTreatment(order, "restaurant")).toMatchObject({ payableBy: "restaurant", operator: null });
  });

  it("summarises 9(5) orders per platform and operator GSTIN, leaving restaurant-taxed ones out", () => {
    expect(
      ecoSummary([
        { platform: "zomato", taxMode: "eco_9_5", valueOfSupply: 1000, gst: 50, operatorGstin: null },
        { platform: "zomato", taxMode: "eco_9_5", valueOfSupply: 2000, gst: 100, operatorGstin: null },
        { platform: "swiggy", taxMode: "eco_9_5", valueOfSupply: 500, gst: 25, operatorGstin: "29AAA" },
        { platform: "ondc", taxMode: "restaurant", valueOfSupply: 999, gst: 50, operatorGstin: null },
      ]),
    ).toEqual([
      { platform: "swiggy", operator: "Swiggy", operatorGstin: "29AAA", orders: 1, valueOfSupply: 500, gst: 25 },
      { platform: "zomato", operator: "Zomato", operatorGstin: null, orders: 2, valueOfSupply: 3000, gst: 150 },
    ]);
  });
});
