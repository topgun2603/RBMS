import { describe, expect, it } from "vitest";
import {
  buildOptions,
  DEFAULT_RATE,
  findOption,
  matchZone,
  needsState,
  quoteFromRules,
  rateAmount,
  type QuoteInput,
  type RateRule,
  type ZoneRule,
} from "./zones";

const zone = (id: string, over: Partial<ZoneRule> = {}): ZoneRule => ({
  id,
  name: id,
  states: [],
  pincodePrefixes: [],
  pincodes: [],
  active: true,
  sort: 0,
  ...over,
});

const rate = (id: string, zoneId: string, over: Partial<RateRule> = {}): RateRule => ({
  id,
  zoneId,
  name: id,
  type: "flat",
  amount: 5000,
  freeAbove: null,
  weightSlabs: [],
  etaMinDays: 2,
  etaMaxDays: 5,
  codAllowed: true,
  codFee: 0,
  active: true,
  sort: 0,
  ...over,
});

const input = (over: Partial<QuoteInput> = {}): QuoteInput => ({ pincode: "600001", weightGrams: 500, subtotal: 50_000, cod: false, ...over });

describe("matchZone", () => {
  const zones = [
    zone("rest"),
    zone("tn", { states: ["33"] }),
    zone("chennai", { pincodePrefixes: ["600"] }),
    zone("chennai-central", { pincodePrefixes: ["6000"] }),
    zone("gpo", { pincodes: ["600001"] }),
  ];

  it("prefers an exact pincode", () => {
    expect(matchZone(zones, "600001", "33")).toMatchObject({ zone: { id: "gpo" }, by: "pincode" });
  });

  it("then the longest prefix", () => {
    expect(matchZone(zones, "600002", "33")).toMatchObject({ zone: { id: "chennai-central" }, by: "prefix" });
    expect(matchZone(zones, "600100", "33")).toMatchObject({ zone: { id: "chennai" }, by: "prefix" });
  });

  it("then the state, then the zone without rules", () => {
    expect(matchZone(zones, "641001", "33")).toMatchObject({ zone: { id: "tn" }, by: "state" });
    expect(matchZone(zones, "560001", "29")).toMatchObject({ zone: { id: "rest" }, by: "rest" });
    expect(matchZone(zones, "641001", null)).toMatchObject({ zone: { id: "rest" }, by: "rest" });
  });

  it("returns null when nothing matches and there is no rest-of-India zone", () => {
    expect(matchZone([zone("tn", { states: ["33"] })], "560001", "29")).toBeNull();
  });

  it("ignores inactive zones and invalid pincodes", () => {
    expect(matchZone([zone("gpo", { pincodes: ["600001"], active: false }), zone("rest")], "600001")).toMatchObject({ zone: { id: "rest" } });
    expect(matchZone(zones, "060001", "33")).toBeNull();
    expect(matchZone(zones, "60001", "33")).toBeNull();
  });

  it("breaks ties by sort, then name", () => {
    const tied = [zone("b", { states: ["33"], sort: 1 }), zone("a", { states: ["33"], sort: 1 }), zone("z", { states: ["33"], sort: 5 })];
    expect(matchZone(tied, "600001", "33")!.zone.id).toBe("a");
    const sorted = [zone("b", { states: ["33"], sort: 0 }), zone("a", { states: ["33"], sort: 1 })];
    expect(matchZone(sorted, "600001", "33")!.zone.id).toBe("b");
  });

  it("knows when the state is needed", () => {
    expect(needsState(zones, "641001")).toBe(true);
    expect(needsState(zones, "600123")).toBe(false);
    expect(needsState([zone("rest")], "641001")).toBe(false);
  });
});

describe("rateAmount", () => {
  it("flat", () => {
    expect(rateAmount(rate("r", "z"), { weightGrams: 0, subtotal: 0 })).toBe(5000);
  });

  it("free_above gives 0 at and above the threshold", () => {
    const r = rate("r", "z", { type: "free_above", amount: 4900, freeAbove: 99_900 });
    expect(rateAmount(r, { weightGrams: 0, subtotal: 99_899 })).toBe(4900);
    expect(rateAmount(r, { weightGrams: 0, subtotal: 99_900 })).toBe(0);
    expect(rateAmount(r, { weightGrams: 0, subtotal: 200_000 })).toBe(0);
  });

  it("weight slabs pick the first slab that fits (inclusive), unsorted input ok", () => {
    const r = rate("r", "z", {
      type: "weight",
      weightSlabs: [
        { upToGrams: 2000, amount: 9000 },
        { upToGrams: 500, amount: 4000 },
        { upToGrams: 1000, amount: 6000 },
      ],
    });
    expect(rateAmount(r, { weightGrams: 0, subtotal: 0 })).toBe(4000);
    expect(rateAmount(r, { weightGrams: 500, subtotal: 0 })).toBe(4000);
    expect(rateAmount(r, { weightGrams: 500.2, subtotal: 0 })).toBe(6000);
    expect(rateAmount(r, { weightGrams: 2000, subtotal: 0 })).toBe(9000);
    expect(rateAmount(r, { weightGrams: 2001, subtotal: 0 })).toBeNull();
  });

  it("freeAbove also applies to weight rates; inactive rates never apply", () => {
    const r = rate("r", "z", { type: "weight", freeAbove: 100_000, weightSlabs: [{ upToGrams: 1000, amount: 6000 }] });
    expect(rateAmount(r, { weightGrams: 900, subtotal: 100_000 })).toBe(0);
    expect(rateAmount(r, { weightGrams: 5000, subtotal: 100_000 })).toBeNull();
    expect(rateAmount(rate("r", "z", { active: false }), { weightGrams: 0, subtotal: 0 })).toBeNull();
  });
});

describe("buildOptions", () => {
  const rates = [
    rate("express", "z", { amount: 12_000, sort: 1, etaMinDays: 1, etaMaxDays: 2, codAllowed: false, codFee: 5000 }),
    rate("standard", "z", { amount: 6000, sort: 0, codFee: 3000 }),
    rate("cheap", "z", { amount: 3000, sort: 0, etaMinDays: 6, etaMaxDays: 4 }),
  ];

  it("orders by sort then price and reports eta + COD", () => {
    const opts = buildOptions(rates, input());
    expect(opts.map((o) => o.id)).toEqual(["cheap", "standard", "express"]);
    expect(opts[1]).toEqual({ id: "standard", name: "standard", amount: 6000, etaDays: [2, 5], codAllowed: true, codFee: 3000 });
    expect(opts[0]!.etaDays).toEqual([6, 6]); // max never below min
    expect(opts[2]!.codFee).toBe(0); // no COD → no fee
  });

  it("drops non-COD rates for COD quotes", () => {
    expect(buildOptions(rates, input({ cod: true })).map((o) => o.id)).toEqual(["cheap", "standard"]);
  });
});

describe("quoteFromRules", () => {
  it("implicit All India ₹0 when the tenant has no zones", () => {
    const q = quoteFromRules([], [], input());
    expect(q).toEqual({
      serviceable: true,
      zone: { id: "default", name: "All India" },
      options: [{ id: "default", name: DEFAULT_RATE.name, amount: 0, etaDays: [2, 7], codAllowed: true, codFee: 0 }],
    });
    expect(quoteFromRules([], [], input({ cod: true })).options).toHaveLength(1);
  });

  it("implicit default also while every zone is inactive", () => {
    expect(quoteFromRules([zone("x", { active: false })], [rate("r", "x")], input()).zone!.id).toBe("default");
  });

  it("uses only the matched zone's rates", () => {
    const zones = [zone("tn", { states: ["33"] }), zone("rest")];
    const rates = [rate("tn-std", "tn", { amount: 4000 }), rate("rest-std", "rest", { amount: 8000 })];
    const tn = quoteFromRules(zones, rates, input({ stateCode: "33" }));
    expect(tn.zone).toEqual({ id: "tn", name: "tn" });
    expect(tn.options.map((o) => o.id)).toEqual(["tn-std"]);
    const ka = quoteFromRules(zones, rates, input({ pincode: "560001", stateCode: "29" }));
    expect(ka.options.map((o) => o.amount)).toEqual([8000]);
  });

  it("is not serviceable without a match, without usable rates, or for a bad pincode", () => {
    const zones = [zone("tn", { states: ["33"] })];
    expect(quoteFromRules(zones, [rate("r", "tn")], input({ pincode: "560001", stateCode: "29" }))).toEqual({
      serviceable: false,
      options: [],
      zone: null,
    });
    const noRates = quoteFromRules(zones, [rate("r", "tn", { active: false })], input({ stateCode: "33" }));
    expect(noRates.serviceable).toBe(false);
    expect(noRates.zone).toEqual({ id: "tn", name: "tn" });
    expect(quoteFromRules([], [], input({ pincode: "abc" })).serviceable).toBe(false);
    const heavy = quoteFromRules(
      zones,
      [rate("w", "tn", { type: "weight", weightSlabs: [{ upToGrams: 1000, amount: 5000 }] })],
      input({ stateCode: "33", weightGrams: 5000 }),
    );
    expect(heavy.serviceable).toBe(false);
  });

  it("finds a chosen option", () => {
    const q = quoteFromRules([], [], input());
    expect(findOption(q, "default")?.amount).toBe(0);
    expect(findOption(q, "nope")).toBeNull();
  });
});
