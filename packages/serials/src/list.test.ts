import { AppError } from "@rbms/core";
import { createDb } from "@rbms/db";
import { afterAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { serialUnits } from "./schema";
import { receiveUnitsInput, SerialsService, UNIT_SORT, unitListQuery } from "./service";

// Never connects: only renders SQL.
const { db, close } = createDb("postgres://u:p@127.0.0.1:1/none", { max: 1 });
afterAll(() => close());

const T = "11111111-1111-4111-8111-111111111111";
const I = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const svc = new SerialsService({ db });

const where = (q: Record<string, unknown>, withStatus = true) =>
  db.select().from(serialUnits).where(svc.unitConditions(T, unitListQuery.parse(q), withStatus)).toSQL();

describe("unit list query", () => {
  it("parses limits, comma lists and rejects unknown statuses", () => {
    expect(unitListQuery.parse({}).limit).toBe(25);
    expect(() => unitListQuery.parse({ limit: "201" })).toThrow(ZodError);
    expect(unitListQuery.parse({ status: "in_stock,sold" }).status).toEqual(["in_stock", "sold"]);
    expect(() => unitListQuery.parse({ status: "lost" })).toThrow(ZodError);
  });

  it("filters by tenant, status, item and searches serials (normalised) and sale details", () => {
    const q = where({ status: "sold", itemId: I, q: "35 2099" });
    expect(q.sql).toContain('"serial_units"."tenant_id" = $');
    expect(q.sql).toContain('"serial_units"."status" in ($');
    expect(q.sql).toContain('"serial_units"."item_id" in ($');
    expect(q.sql).toContain('"serial_units"."serial2" ilike');
    expect(q.sql).toContain('"serial_units"."customer_name" ilike');
    expect(q.params).toContain("%352099%");
    expect(q.params).toContain("%35 2099%");
    expect(where({ status: "sold" }, false).sql).not.toContain('"status" in');
  });

  it("sorts by known keys only", () => {
    expect(UNIT_SORT.keys).toContain("received");
    expect(() => UNIT_SORT.orderBy("price")).toThrow(AppError);
  });
});

describe("receive input", () => {
  it("needs at least one unit and at most 500", () => {
    expect(() => receiveUnitsInput.parse({ itemId: I, units: [] })).toThrow(ZodError);
    expect(() => receiveUnitsInput.parse({ itemId: I, units: Array.from({ length: 501 }, (_, i) => ({ serial: `SN${i}` })) })).toThrow(ZodError);
    expect(receiveUnitsInput.parse({ itemId: I, units: [{ serial: "SN1", serial2: null }] }).units).toHaveLength(1);
  });
});
