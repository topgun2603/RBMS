import { AppError } from "@srirealtime/core";
import { describe, expect, it } from "vitest";
import { z, ZodError } from "zod";
import { TtlCache } from "./cache";
import { applyPatch, mergeLayers, pickKeys, resolveSettings, splitPatch } from "./merge";
import { validatePatch } from "./validate";

const schema = z.object({
  currency: z.string().length(3),
  taxRate: z.number().min(0).max(1),
  theme: z.enum(["light", "dark"]),
  address: z.object({ city: z.string(), pin: z.string() }),
});
const defaults = { currency: "INR", taxRate: 0.18, theme: "light" as const, address: { city: "Chennai", pin: "600001" } };

describe("mergeLayers", () => {
  it("later layers win per key and null/undefined do not override", () => {
    expect(mergeLayers(defaults, { taxRate: 0.05 }, { theme: "dark", taxRate: null }, undefined, null)).toEqual({
      ...defaults,
      taxRate: 0.05,
      theme: "dark",
    });
  });

  it("is shallow: nested objects are replaced, not deep-merged", () => {
    const out = mergeLayers(defaults, { address: { city: "Madurai" } });
    expect(out.address).toEqual({ city: "Madurai" });
  });
});

describe("applyPatch", () => {
  it("sets values and removes keys patched to null", () => {
    expect(applyPatch({ a: 1, b: 2 }, { b: null, c: 3 })).toEqual({ a: 1, c: 3 });
  });
  it("handles a missing existing layer and does not mutate input", () => {
    const existing = { a: 1 };
    expect(applyPatch(null, { a: 1 })).toEqual({ a: 1 });
    applyPatch(existing, { a: null });
    expect(existing).toEqual({ a: 1 });
  });
});

describe("pickKeys / splitPatch", () => {
  it("picks only the given keys", () => {
    expect(pickKeys({ a: 1, b: 2 }, ["b", "z"])).toEqual({ b: 2 });
    expect(pickKeys({ a: 1 }, undefined)).toEqual({ a: 1 });
    expect(pickKeys(null, ["a"])).toEqual({});
  });
  it("splits set and cleared keys", () => {
    expect(splitPatch({ a: 1, b: null, c: undefined })).toEqual({ set: { a: 1 }, cleared: ["b"] });
  });
});

describe("resolveSettings", () => {
  it("returns the validated merge of all layers", () => {
    expect(resolveSettings(schema, defaults, [{ taxRate: 0.12 }, { theme: "dark" }])).toEqual({
      ...defaults,
      taxRate: 0.12,
      theme: "dark",
    });
  });
  it("falls back to defaults for stored keys that no longer validate", () => {
    expect(resolveSettings(schema, defaults, [{ taxRate: 5, theme: "dark" }])).toEqual({ ...defaults, theme: "dark" });
  });
  it("drops unknown stored keys via the schema", () => {
    expect(resolveSettings(schema, defaults, [{ legacy: true }])).toEqual(defaults);
  });
});

describe("validatePatch", () => {
  it("parses a valid partial patch and keeps null clears", () => {
    expect(validatePatch(schema, { taxRate: 0.05, theme: null })).toEqual({ taxRate: 0.05, theme: null });
  });
  it("rejects unknown keys (strict)", () => {
    expect(() => validatePatch(schema, { nope: 1 })).toThrow(ZodError);
    expect(() => validatePatch(schema, { nope: null })).toThrow(AppError);
  });
  it("rejects invalid values", () => {
    expect(() => validatePatch(schema, { taxRate: 2 })).toThrow(ZodError);
  });
  it("rejects non-object patches", () => {
    expect(() => validatePatch(schema, [1])).toThrow(AppError);
    expect(() => validatePatch(schema, "x")).toThrow(AppError);
  });
  it("enforces userOverridable keys", () => {
    expect(validatePatch(schema, { theme: "dark" }, ["theme"])).toEqual({ theme: "dark" });
    try {
      validatePatch(schema, { taxRate: 0.1 }, ["theme"]);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).status).toBe(400);
    }
    expect(() => validatePatch(schema, { taxRate: null }, ["theme"])).toThrow(AppError);
  });
});

describe("TtlCache", () => {
  it("expires entries and invalidates by prefix", () => {
    let now = 0;
    const cache = new TtlCache<number>(100, () => now);
    cache.set("ns|t1|", 1);
    cache.set("ns|t1|u1", 2);
    cache.set("ns|t2|", 3);
    cache.deletePrefix("ns|t1|");
    expect(cache.get("ns|t1|")).toBeUndefined();
    expect(cache.get("ns|t1|u1")).toBeUndefined();
    expect(cache.get("ns|t2|")).toBe(3);
    now = 100;
    expect(cache.get("ns|t2|")).toBeUndefined();
  });
});
