import { AppError } from "@rbms/core";
import { createDb } from "@rbms/db";
import { afterAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { jewelleryExchanges, jewelleryPieces } from "./schema";
import {
  EXCHANGE_SORT,
  exchangeInput,
  exchangeListQuery,
  JewelleryService,
  PIECE_SORT,
  pieceInput,
  pieceListQuery,
  piecePatch,
  ratesInput,
} from "./service";

// Never connects: only renders SQL.
const { db, close } = createDb("postgres://u:p@127.0.0.1:1/none", { max: 1 });
afterAll(() => close());

const T = "11111111-1111-4111-8111-111111111111";
const ITEM = "22222222-2222-4222-8222-222222222222";
const svc = new JewelleryService({ db });

describe("piece list", () => {
  it("parses comma lists and refuses unknown values", () => {
    expect(pieceListQuery.parse({}).limit).toBe(25);
    expect(pieceListQuery.parse({ metal: "gold,silver", purity: "22K" })).toMatchObject({ metal: ["gold", "silver"], purity: ["22K"] });
    expect(() => pieceListQuery.parse({ status: "lost" })).toThrow(ZodError);
    expect(() => pieceListQuery.parse({ purity: "21K" })).toThrow(ZodError);
  });

  it("filters by tenant, metal, status and searches name, tag and HUID", () => {
    const s = db.select().from(jewelleryPieces).where(svc.pieceConditions(T, pieceListQuery.parse({ metal: "gold", status: "in_stock", q: "AB12" }))).toSQL();
    expect(s.sql).toContain('"jewellery_pieces"."tenant_id" = $1');
    expect(s.sql).toContain('"jewellery_pieces"."metal" in');
    expect(s.sql).toContain('"jewellery_pieces"."status" in');
    expect(s.sql).toContain('"jewellery_pieces"."huid"');
    expect(s.sql).toContain("ilike");
    expect(s.params).toEqual(expect.arrayContaining([T, "gold", "in_stock", "%AB12%"]));
    const facet = db.select().from(jewelleryPieces).where(svc.pieceConditions(T, pieceListQuery.parse({ metal: "gold", status: "sold" }), "status")).toSQL();
    expect(facet.sql).not.toContain('"status" in');
    expect(facet.sql).toContain('"metal" in');
  });

  it("sorts by known keys only", () => {
    expect(PIECE_SORT.keys).toEqual(expect.arrayContaining(["name", "tag", "gross", "net", "price", "updated"]));
    expect(() => PIECE_SORT.orderBy("itemId")).toThrow(AppError);
  });
});

describe("exchange list", () => {
  it("filters by status, dates and searches customer and OG number", () => {
    const s = db
      .select()
      .from(jewelleryExchanges)
      .where(svc.exchangeConditions(T, exchangeListQuery.parse({ status: "open", from: "2026-10-01", to: "2026-10-31", q: "OG-0003" })))
      .toSQL();
    expect(s.sql).toContain('"jewellery_exchanges"."tenant_id" = $1');
    expect(s.sql).toContain("lpad(");
    expect(s.params).toEqual(expect.arrayContaining([T, "open", "2026-10-01", "2026-10-31", "%OG-0003%"]));
    expect(() => exchangeListQuery.parse({ from: "2026-10-31", to: "2026-10-01" })).toThrow(ZodError);
    expect(EXCHANGE_SORT.keys).toEqual(expect.arrayContaining(["number", "date", "customer", "total", "status"]));
  });
});

describe("inputs", () => {
  it("validates rates: purity of the metal, no repeats", () => {
    expect(ratesInput.parse({ rates: [{ metal: "gold", purity: "24K", ratePerGram: 720000 }] }).rates).toHaveLength(1);
    expect(() => ratesInput.parse({ rates: [{ metal: "silver", purity: "22K", ratePerGram: 9000 }] })).toThrow(ZodError);
    expect(() => ratesInput.parse({ rates: [] })).toThrow(ZodError);
    expect(() =>
      ratesInput.parse({
        rates: [
          { metal: "gold", purity: "24K", ratePerGram: 1 },
          { metal: "gold", purity: "24K", ratePerGram: 2 },
        ],
      }),
    ).toThrow(ZodError);
    expect(() => ratesInput.parse({ rates: [{ metal: "gold", purity: "24K", ratePerGram: 7200.5 }] })).toThrow(ZodError);
  });

  it("validates pieces: HUID, weights, purity", () => {
    const ok = pieceInput.parse({ itemId: ITEM, metal: "gold", purity: "22K", grossWeight: 10.1234, huid: " ab12cd ", tagNo: "" });
    expect(ok).toMatchObject({ grossWeight: 10.123, huid: "AB12CD", tagNo: null });
    expect(() => pieceInput.parse({ itemId: ITEM, metal: "gold", purity: "22K", grossWeight: 10, huid: "AB12" })).toThrow(ZodError);
    expect(() => pieceInput.parse({ itemId: ITEM, metal: "gold", purity: "925", grossWeight: 10 })).toThrow(ZodError);
    expect(() => pieceInput.parse({ itemId: ITEM, metal: "gold", purity: "22K", grossWeight: 0 })).toThrow(ZodError);
    expect(() => pieceInput.parse({ itemId: ITEM, metal: "gold", purity: "22K", grossWeight: 1, makingType: "weird" })).toThrow(ZodError);
    expect(piecePatch.parse({ huid: null })).toEqual({ huid: null });
    expect(() => piecePatch.parse({ itemId: ITEM })).toThrow(ZodError);
  });

  it("validates exchanges", () => {
    const b = exchangeInput.parse({ customer: { name: "Meena" }, lines: [{ metal: "gold", purity: "22K", grossWeight: 12.5, deductionPct: 3 }] });
    expect(b.customer.phone).toBeNull();
    expect(() => exchangeInput.parse({ customer: { name: "Meena" }, lines: [] })).toThrow(ZodError);
    expect(() => exchangeInput.parse({ customer: { name: "" }, lines: [{ metal: "gold", purity: "22K", grossWeight: 1 }] })).toThrow(ZodError);
    expect(() => exchangeInput.parse({ customer: { name: "A" }, lines: [{ metal: "gold", purity: "22K", grossWeight: 1, deductionPct: 101 }] })).toThrow(ZodError);
  });
});
