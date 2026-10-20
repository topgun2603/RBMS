import { AppError } from "@srirealtime/core";
import { createDb } from "@srirealtime/db";
import { afterAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { createScales } from "./index";
import { scaleItems } from "./schema";
import { priceListInput, SCALE_ITEM_SORT, ScalesService, scaleItemInput, scaleItemListQuery } from "./service";

// Never connects: only renders SQL (and lets calls fail fast).
const { db, close } = createDb("postgres://u:p@127.0.0.1:1/none", { max: 1 });
afterAll(() => close());

const T = "11111111-1111-4111-8111-111111111111";
const catalog = { variants: async () => [], setPrice: async () => {} };
const svc = new ScalesService({ db, catalog });

const where = (q: Record<string, unknown>, withSoldBy = true) =>
  db.select().from(scaleItems).where(svc.listConditions(T, scaleItemListQuery.parse(q), withSoldBy)).toSQL();

describe("scale item list", () => {
  it("parses filters and limits", () => {
    expect(scaleItemListQuery.parse({}).limit).toBe(50);
    expect(scaleItemListQuery.parse({ soldBy: "weight,piece", active: "true" })).toMatchObject({ soldBy: ["weight", "piece"], active: true });
    expect(() => scaleItemListQuery.parse({ soldBy: "litre" })).toThrow(ZodError);
    expect(() => scaleItemListQuery.parse({ limit: "501" })).toThrow(ZodError);
  });
  it("always filters by tenant and searches name or PLU", () => {
    const plain = where({});
    expect(plain.sql).toContain('"tenant_id" = $1');
    expect(plain.params).toEqual([T]);
    const byPlu = where({ q: "42" });
    expect(byPlu.sql).toMatch(/"plu" = \$2 or .*"name" ilike/);
    expect(byPlu.params).toEqual([T, 42, "%42%"]);
    expect(where({ q: "tom" }).sql).not.toContain('"plu" =');
  });
  it("drops soldBy for its facet", () => {
    expect(where({ soldBy: "piece" }).sql).toContain('"sold_by" in');
    expect(where({ soldBy: "piece" }, false).sql.split(" where ")[1]).not.toContain('"sold_by"');
  });
  it("sorts by known keys only", () => {
    expect(SCALE_ITEM_SORT.keys).toEqual(expect.arrayContaining(["plu", "name", "updated", "priced"]));
    expect(() => SCALE_ITEM_SORT.orderBy("price")).toThrow(AppError);
  });
});

describe("inputs", () => {
  it("validates item and price bodies", () => {
    expect(scaleItemInput.parse({})).toEqual({ soldBy: "weight", tareGrams: 0, active: true });
    expect(() => scaleItemInput.parse({ plu: 100_000 })).toThrow(ZodError);
    expect(() => scaleItemInput.parse({ tareGrams: -1 })).toThrow(ZodError);
    expect(() => scaleItemInput.parse({ extra: 1 })).toThrow(ZodError);
    expect(() => priceListInput.parse({ items: [] })).toThrow(ZodError);
    expect(() => priceListInput.parse({ items: [{ itemId: T, price: 1.5 }] })).toThrow(ZodError);
  });
});

describe("resolveCode and settings", () => {
  it("returns null for codes that aren't scale labels, without touching the database", async () => {
    expect(await svc.resolveCode(T, "8901234567890")).toBeNull();
    expect(await svc.resolveCode(T, "2100042012508")).toBeNull();
    expect(await svc.resolveCode(T, "")).toBeNull();
  });
  it("never throws when the lookup fails", async () => {
    const warned: unknown[] = [];
    const s = new ScalesService({ db, catalog, log: { info() {}, warn: (o) => warned.push(o), error() {} } });
    expect(await s.resolveCode(T, "2100042012509")).toBeNull();
    expect(warned).toHaveLength(1);
  });
  it("uses the shop's format, defaults when settings fail", async () => {
    const s = new ScalesService({ db, catalog, settings: { get: async () => ({ prefixes: ["22"], valueKind: "price" }) } });
    expect(await s.getSettings(T)).toMatchObject({ prefixes: ["22"], valueKind: "price" });
    const broken = new ScalesService({ db, catalog, settings: { get: async () => Promise.reject(new Error("down")) } });
    expect((await broken.getSettings(T)).prefixes).toContain("21");
  });
  it("refuses settings changes without a writable store and bad formats", async () => {
    await expect(svc.updateSettings(T, { pluDigits: 4 })).rejects.toThrow(AppError);
    const s = new ScalesService({ db, catalog, settings: { get: async () => ({}), set: async () => ({}) } });
    await expect(s.updateSettings(T, { pluDigits: 4 })).rejects.toThrow(/add up to 12/);
    await expect(s.updateSettings(T, { colour: "red" })).rejects.toThrow(ZodError);
  });
});

describe("createScales", () => {
  it("declares the module, feature and permission", () => {
    const { module } = createScales({ db, catalog });
    expect(module.id).toBe("scales");
    expect(module.features?.map((f) => f.key)).toEqual(["scales"]);
    expect(module.features?.[0]?.shopToggle).toBe(true);
    expect(module.permissions?.map((p) => p.key)).toEqual(["scales.manage"]);
  });
});
