/**
 * Item-wise profit in base units (docs/valuation-reports.md, docs/price-lists-units.md): a line in boxes and a line in
 * pieces of one item are one row with the quantity in pieces; the SQL base quantity matches `baseQtyOf`. The SQL part
 * runs only with `API_TEST_DATABASE_URL` set (it only evaluates expressions, no tables).
 */
import { createDb, sql } from "@srirealtime/db";
import { baseQtyOf } from "@srirealtime/gst";
import { describe, expect, it } from "vitest";
import { aggregateProfit, baseQtySql, expensesByBranch, type ProfitLineRow } from "./kit-valuation";

const OIL = "dddddddd-0000-4000-8000-000000000002";
const line = (p: Partial<ProfitLineRow>): ProfitLineRow => ({
  kind: "invoice",
  item_id: OIL,
  description: "Oil 1 l",
  base_qty: "1",
  sales: "0",
  cogs: "0",
  cost_source: "stock",
  category: "Oils",
  brand: "Idhayam",
  staff: "Anitha",
  branch: "",
  date: "2026-10-10",
  ...p,
});

describe("item-wise profit in base units", () => {
  it("counts boxes and pieces of one item in pieces, one row, with returns and cost netted", () => {
    const r = aggregateProfit(
      [
        // 2 boxes of 12 (24 pieces) and 5 loose pieces; cost from the sale movements (always pieces).
        line({ description: "Oil 1 l", base_qty: "24", sales: "480000", cogs: "360000" }),
        line({ description: "Oil 1 l", base_qty: "5", sales: "105000", cogs: "75000" }),
        // A credit note returning half a box (6 pieces): sales and cost back.
        line({ kind: "credit_note", base_qty: "6", sales: "-120000", cogs: "-90000" }),
      ],
      [{ itemId: OIL, date: "2026-10-12", value: 2000, name: "Oil 1 l", category: "Oils", brand: "Idhayam" }],
      "item",
      10,
    );
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0]).toMatchObject({ qty: 23, sales: 585000, returns: 120000, netSales: 465000, cogs: 347000, grossProfit: 118000, margin: 25.4, flag: null });
    expect(r.landedOnSold).toBe(2000);
    const byBrand = aggregateProfit([line({ base_qty: "24", sales: "1000", cogs: "1200" })], [], "brand", 10);
    expect(byBrand.rows[0]).toMatchObject({ label: "Idhayam", grossProfit: -200, flag: "negative" });
  });

  const URL_ = process.env.API_TEST_DATABASE_URL;
  it.skipIf(!URL_)("the SQL base quantity equals baseQtyOf", async () => {
    const { db, close } = createDb(URL_!, { max: 1 });
    try {
      const cases = [{ qty: 2, unitFactor: 12 }, { qty: 3 }, { qty: 1.5, unitFactor: 0.25 }, { qty: 0.333, unitFactor: 3 }, { qty: 4, unitFactor: 1 }, { qty: 2, unitFactor: null }];
      for (const c of cases) {
        const r = (await db.execute(sql`SELECT ${baseQtySql(sql`${JSON.stringify(c)}::jsonb`)} AS q`)) as unknown as { rows?: { q: string }[] } & { q: string }[];
        const q = Number((r.rows ?? r)[0]!.q);
        expect(q).toBe(baseQtyOf(c));
      }
    } finally {
      await close();
    }
  });
});

describe("branch report: expenses by branch", () => {
  it("puts each branch's expenses in its column and the rest (no branch, or a deleted one) shop-wide", () => {
    const A = "aaaaaaaa-0000-4000-8000-000000000001";
    const B = "bbbbbbbb-0000-4000-8000-000000000002";
    const GONE = "cccccccc-0000-4000-8000-000000000003";
    const m = expensesByBranch(
      [
        { branch_id: A, v: "250000" },
        { branch_id: null, v: "40000" },
        { branch_id: GONE, v: "1000" },
        { branch_id: B, v: 7000 },
      ],
      [A, B],
    );
    expect([...m.entries()]).toEqual([
      [A, 250_000],
      [null, 41_000],
      [B, 7_000],
    ]);
    const total = [...m.values()].reduce((s, x) => s + x, 0);
    expect(total).toBe(298_000);
  });
});
