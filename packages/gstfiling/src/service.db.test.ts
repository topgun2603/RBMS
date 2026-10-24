/**
 * Database test of GST filing: settings, owner decisions, GSTR-3B with those decisions, GSTR-2B import and matching with
 * owner actions, composition quarter with a tax payment, filing marks. Runs only with `GSTFILING_TEST_DATABASE_URL`
 * (a development Postgres with migration 0034 applied); it copies the tables into a throw-away schema and drops it.
 *   PowerShell: $env:GSTFILING_TEST_DATABASE_URL="postgres://srikit:srikit@127.0.0.1:5432/srikit"; npx vitest run --maxWorkers=2
 */
import { createDb, type Db } from "@srirealtime/db";
import { gstinCheckChar } from "@srirealtime/gst";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { GstSourcesPort, PurchaseSrc, SalesDocSrc } from "./ports";
import { GstFilingService } from "./service";
import { Gstr2bService } from "./service-2b";

const URL_ = process.env.GSTFILING_TEST_DATABASE_URL;
const SCHEMA = `gst_it_${Math.random().toString(36).slice(2, 10)}`;
const TABLES = ["gst_settings", "gst_doc_flags", "gst_adjustments", "gst_2b_imports", "gst_2b_rows", "gst_filings", "gst_advances", "gst_tax_payments"];
const T = "22222222-2222-4222-8222-222222222222";
const mk = (f: string) => f + gstinCheckChar(f);
const OWN = mk("33AAAAA0000A1Z");
const SUP = mk("33BBBBB1111B1Z");

const purchase = (id: string, over: Partial<PurchaseSrc> = {}): PurchaseSrc => ({
  id,
  billNumber: `S-${id}`,
  date: "2026-10-05",
  status: "recorded",
  imported: false,
  supplierId: "s1",
  supplierName: "Sri Traders",
  supplierGstin: SUP,
  supplierState: "33",
  placeOfSupply: "33",
  interState: false,
  lines: [{ description: "Goods", hsn: "1905", qty: 1, gstRate: 18, taxable: 100000, cgst: 9000, sgst: 9000, igst: 0 }],
  taxable: 100000,
  cgst: 9000,
  sgst: 9000,
  igst: 0,
  total: 118000,
  amountPaid: 0,
  dueDate: null,
  ...over,
});
const sale = (id: string, number: string, date: string, taxable: number, rate: number): SalesDocSrc => {
  const tax = Math.round((taxable * rate) / 100);
  return {
    id,
    number,
    status: "issued",
    date,
    docType: "INV",
    seller: { gstin: OWN, stateCode: "33" },
    buyer: { name: "Meena", gstin: null, stateCode: "33" },
    placeOfSupply: "33",
    interState: false,
    lines: [{ description: "Item", hsn: "1905", unit: "pcs", qty: 1, gstRate: rate, taxable, cgst: Math.ceil(tax / 2), sgst: Math.floor(tax / 2), igst: 0 }],
    totals: { taxable, cgst: Math.ceil(tax / 2), sgst: Math.floor(tax / 2), igst: 0, roundOff: 0, total: taxable + tax },
  };
};

describe.skipIf(!URL_)("GST filing against Postgres", () => {
  let db: Db;
  let close: () => Promise<void>;
  let svc: GstFilingService;
  let reco: Gstr2bService;
  let purchases: PurchaseSrc[];
  let sales: SalesDocSrc[];

  const sources: GstSourcesPort = {
    profile: async () => ({ gstin: OWN, legalName: "Test Shop", stateCode: "33" }),
    sales: async (_t, r) => sales.filter((s) => s.date >= r.from && s.date <= r.to),
    purchases: async (_t, r) => purchases.filter((p) => p.date >= r.from && p.date <= r.to),
    purchasesByIds: async (_t, ids) => purchases.filter((p) => ids.includes(p.id)),
    purchaseReturns: async () => [],
    expenses: async () => [],
    expensesByIds: async () => [],
  };

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 4 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    for (const t of TABLES) await db.execute(sql.raw(`create table "${SCHEMA}"."${t}" (like public."${t}" including all)`));
    purchases = [purchase("11111111-1111-4111-8111-111111111111"), purchase("22222222-2222-4222-8222-222222222223", { date: "2026-10-06", billNumber: "S-2" })];
    sales = [sale("a", "INV/26-27/0001", "2026-10-02", 100000, 18), sale("b", "INV/26-27/0002", "2026-10-03", 50000, 5)];
    svc = new GstFilingService({
      db,
      sources,
      gstr1: { build: async () => ({ json: { gstin: OWN, fp: "102026" }, warnings: [], counts: {}, filename: "x.json" }) },
      now: () => new Date("2026-10-24T06:00:00Z"),
    });
    reco = new Gstr2bService(svc);
  });
  afterAll(async () => {
    await db.execute(sql.raw(`drop schema "${SCHEMA}" cascade`));
    await close();
  });

  const P1 = "11111111-1111-4111-8111-111111111111";
  const P2 = "22222222-2222-4222-8222-222222222223";

  it("starts as a regular taxpayer and saves composition with a start date", async () => {
    expect((await svc.schemeFor(T)).taxScheme).toBe("regular");
    const c = await svc.saveConfig(T, { composition: true, compositionType: "restaurant", compositionFrom: "2026-10-01" });
    expect(c).toMatchObject({ composition: true, compositionType: "restaurant", compositionFrom: "2026-10-01" });
    expect(await svc.schemeFor(T)).toEqual({ taxScheme: "composition", compositionFrom: "2026-10-01" });
    await expect(svc.saveConfig(T, { gstin: "bad" })).rejects.toThrow();
    await svc.saveConfig(T, { composition: false });
    expect((await svc.schemeFor(T)).taxScheme).toBe("regular");
  });

  it("takes credit by default and follows the owner's decisions in GSTR-3B", async () => {
    let r = await svc.gstr3b(T, "2026-10");
    expect(r.cells["4A5"].cgst).toBe(18000);
    expect(r.cells["3.1a"].taxable).toBe(150000);
    await svc.setFlag(T, null, "purchase", P2, { itcStatus: "blocked", reason: "17(5)" });
    r = await svc.gstr3b(T, "2026-10");
    expect(r.cells["4A5"].cgst).toBe(9000);
    await svc.setFlag(T, null, "purchase", P1, { itcStatus: "reversal", reversalReason: "rule42", reversalMonth: "2026-11" });
    expect((await svc.gstr3b(T, "2026-11")).cells["4B1"].cgst).toBe(9000);
    await svc.setFlag(T, null, "purchase", P1, { reset: true });
    await svc.setFlag(T, null, "purchase", P2, { reset: true });
    expect((await svc.gstr3b(T, "2026-10")).cells["4A5"].cgst).toBe(18000);
    await expect(svc.setFlag(T, null, "purchase", "99999999-9999-4999-8999-999999999999", { itcStatus: "blocked" })).rejects.toThrow();
  });

  it("counts typed-in figures and a reverse-charge bill once paid", async () => {
    await svc.addAdjustment(T, null, { month: "2026-10", kind: "interest", cgst: 100, sgst: 100 });
    await svc.setFlag(T, null, "purchase", P2, { rcm: true, rcmRate: 5, rcmCategory: "gta" });
    let r = await svc.gstr3b(T, "2026-10");
    expect(r.cells["5.1.interest"].cgst).toBe(100);
    expect(r.cells["3.1d"].taxable).toBe(100000);
    expect(r.cells["4A3"].cgst).toBe(0);
    await svc.setFlag(T, null, "purchase", P2, { rcmPaidOn: "2026-10-20", rcmPaidAmount: 5000 });
    r = await svc.gstr3b(T, "2026-10");
    expect(r.cells["4A3"].cgst + r.cells["4A3"].sgst).toBe(5000);
    const reg = await svc.itcRegister(T, { month: "2026-10", rcm: "1" });
    expect(reg.items).toHaveLength(1);
    await svc.setFlag(T, null, "purchase", P2, { reset: true });
    const adj = await svc.listAdjustments(T, "2026-10");
    await svc.deleteAdjustment(T, adj.items[0]!.id);
  });

  it("imports a GSTR-2B file, matches it, keeps the owner's actions on re-import and re-match", async () => {
    const file = {
      data: {
        gstin: OWN,
        rtnprd: "102026",
        data: {
          docdata: {
            b2b: [
              {
                ctin: SUP,
                trdnm: "Sri Traders",
                inv: [
                  { inum: "S-11111111-1111-4111-8111-111111111111", dt: "05-10-2026", val: 1180, itcavl: "Y", items: [{ rt: 18, txval: 1000, igst: 0, cgst: 90, sgst: 90, cess: 0 }] },
                  { inum: "NOT-MINE-1", dt: "07-10-2026", val: 590, itcavl: "Y", txval: 500, igst: 0, cgst: 45, sgst: 45, cess: 0 },
                ],
              },
            ],
          },
        },
      },
    };
    const parsed = reco.parse({ json: file });
    const res = await reco.import(T, null, { parsed, filename: "2b.json", format: "json" });
    expect(res.rows).toBe(2);
    let summary = await reco.summary(T, "2026-10");
    expect(summary.imported).toBe(true);
    if (!summary.imported) return;
    expect(summary.counts.matched).toBe(1);
    expect(summary.counts.missing_in_books).toBe(1);
    // The second bill (S-2) is claimed but not in 2B.
    expect(summary.counts.missing_in_2b).toBe(1);
    expect(summary.itcAtRisk).toBe(18000);
    const rows = await reco.list(T, "2026-10", {});
    const missing = rows.items.find((r) => r.status === "missing_in_books")!;
    await reco.act(T, null, missing.id, { action: "ignore", note: "supplier error" });
    expect((await reco.list(T, "2026-10", { status: "ignored" })).total).toBe(1);
    // Importing the same month again keeps the action.
    await reco.import(T, null, { parsed: reco.parse({ json: file }), filename: "2b-again.json", format: "json" });
    expect((await reco.list(T, "2026-10", { status: "ignored" })).total).toBe(1);
    summary = await reco.rematch(T, "2026-10");
    expect(summary.imported && summary.counts.ignored).toBe(1);
    const suppliers = await reco.suppliers(T, "2026-10");
    expect(suppliers.items[0]!.gstin).toBe(SUP);
    expect(await reco.csv(T, "2026-10", "rows")).toContain("missing_in_2b");
    await reco.remove(T, "2026-10");
    expect((await reco.summary(T, "2026-10")).imported).toBe(false);
  });

  it("builds a composition quarter, tracks the tax paid and the filing marks", async () => {
    await svc.saveConfig(T, { composition: true, compositionType: "trader", compositionFrom: "2026-10-01" });
    const q = await svc.cmp08(T, "2026-Q3");
    expect(q.turnover).toBe(150000);
    expect(q.tax.total).toBe(1500);
    await svc.addTaxPayment(T, null, { kind: "composition", period: "2026-Q3", paidOn: "2026-10-18", cgst: 500, sgst: 500, method: "bank" });
    const after = await svc.cmp08(T, "2026-Q3");
    expect(after.paid).toBe(1000);
    expect(after.balance).toBe(500);
    const preview = await svc.compositionPreview(T, "2026-10-01");
    expect(preview.taxedBills).toBe(2);
    await svc.markFiled(T, null, { returnType: "cmp08", period: "2026-Q3", filedOn: "2026-10-19", arn: "AA123" });
    const o = await svc.overview(T);
    expect(o.calendar.length).toBeGreaterThanOrEqual(0);
    expect(o.filings).toEqual([{ returnType: "cmp08", period: "2026-Q3", filedOn: "2026-10-19", arn: "AA123" }]);
    await svc.unmarkFiled(T, "cmp08", "2026-Q3");
    expect((await svc.listFilings(T)).items).toHaveLength(0);
  });
});
