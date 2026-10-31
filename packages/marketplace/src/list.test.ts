import { AppError } from "@rbms/core";
import { createDb } from "@rbms/db";
import { afterAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { vendorLedger, vendorOrders, vendorPayouts, vendorProductReviews, vendors } from "./schema";
import {
  LEDGER_SORT,
  ledgerListQuery,
  MarketplaceService,
  PAYOUT_SORT,
  payoutListQuery,
  REVIEW_SORT,
  reviewListQuery,
  VENDOR_ORDER_SORT,
  VENDOR_SORT,
  vendorListQuery,
  vendorOrderListQuery,
  vendorSalesSql,
  vendorSort,
} from "./service";
import { MARKETPLACE_SETTINGS_DEFAULTS } from "./settings";

// Never connects: only renders SQL.
const { db, close } = createDb("postgres://u:p@127.0.0.1:1/none", { max: 1 });
afterAll(() => close());

const T = "11111111-1111-4111-8111-111111111111";
const V1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const V2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const svc = new MarketplaceService({
  db,
  config: { encryptionKey: "k", allowMock: true },
  settings: { get: async () => MARKETPLACE_SETTINGS_DEFAULTS },
});

describe("list query schemas", () => {
  it("keep the 50 / 500 limits and split comma lists", () => {
    expect(vendorListQuery.parse({}).limit).toBe(50);
    expect(vendorOrderListQuery.parse({ limit: "500" }).limit).toBe(500);
    expect(() => payoutListQuery.parse({ limit: "501" })).toThrow(ZodError);
    expect(reviewListQuery.parse({ limit: "200" }).limit).toBe(200);
    expect(vendorListQuery.parse({ status: "pending,active", kycStatus: "verified" })).toMatchObject({ status: ["pending", "active"], kycStatus: ["verified"] });
    expect(vendorOrderListQuery.parse({ vendorId: V1, step: "to_pack,to_ship" })).toMatchObject({ vendorId: [V1], step: ["to_pack", "to_ship"] });
    expect(payoutListQuery.parse({ vendorId: `${V1},${V2}` }).vendorId).toEqual([V1, V2]);
    expect(reviewListQuery.parse({ productIds: `${V1},${V2}`, kind: "changed" })).toMatchObject({ productIds: [V1, V2], kind: ["changed"] });
  });

  it("reject bad values and reversed ranges", () => {
    expect(() => vendorListQuery.parse({ status: "gone" })).toThrow(ZodError);
    expect(() => vendorOrderListQuery.parse({ step: "lost" })).toThrow(ZodError);
    expect(() => ledgerListQuery.parse({ type: "gift" })).toThrow(ZodError);
    expect(() => ledgerListQuery.parse({ vendorId: `${V1},${V2}` })).toThrow(ZodError);
    expect(() => payoutListQuery.parse({ from: "2026-10-02", to: "2026-10-01" })).toThrow(ZodError);
    expect(() => reviewListQuery.parse({ productIds: "x" })).toThrow(ZodError);
  });
});

describe("seller list", () => {
  const where = (q: Record<string, unknown>, omit?: "status" | "kycStatus") =>
    db.select().from(vendors).where(svc.vendorConditions(T, vendorListQuery.parse(q), omit)).toSQL();

  it("filters status and KYC and searches name, contacts and GSTIN (escaped)", () => {
    const q = where({ status: "active", kycStatus: "verified,pending", q: "50%" });
    expect(q.sql).toContain('"vendors"."status" in ($');
    expect(q.sql).toContain('"vendors"."kyc_status" in ($');
    expect(q.sql).toContain('"vendors"."gstin" ilike');
    expect(q.sql).toContain('"vendors"."contact_email" ilike');
    expect(q.params).toEqual(expect.arrayContaining([T, "active", "verified", "pending", "%50\\%%"]));
  });

  it("drops one filter for its facet", () => {
    expect(where({ status: "active", kycStatus: "verified" }, "status").params).not.toContain("active");
    expect(where({ status: "active", kycStatus: "verified" }, "kycStatus").params).not.toContain("verified");
  });

  it("sorts by name, sales, effective commission and joined", () => {
    const render = (s?: string, bps = 1000) => db.select().from(vendors).orderBy(...vendorSort(bps).orderBy(s)).toSQL().sql;
    expect(render()).toContain('order by "vendors"."created_at" desc nulls last, "vendors"."id" desc');
    expect(render("name")).toContain('lower("vendors"."name") asc nulls last');
    expect(render("-sales")).toContain(`(select coalesce(sum(vl.amount), 0) from "vendor_ledger" vl where vl.tenant_id = "vendors".tenant_id and vl.vendor_id = "vendors".id and vl.type = 'sale') desc nulls last`);
    expect(render("commission", 1250)).toContain('coalesce("vendors"."commission_bps", 1250) asc');
    expect(() => render("-secret")).toThrow(AppError);
    expect(VENDOR_SORT.keys).toEqual(["name", "sales", "commission", "joined", "status"]);
    // In a select list too, the subquery still ties the ledger to the outer seller row.
    expect(db.select({ sales: vendorSalesSql }).from(vendors).toSQL().sql).toContain('vl.vendor_id = "vendors".id');
  });
});

describe("seller orders list", () => {
  const where = (q: Record<string, unknown>, omit?: "status" | "step") =>
    db.select().from(vendorOrders).where(svc.vendorOrderConditions(T, vendorOrderListQuery.parse(q), omit)).toSQL();

  it("filters sellers, status, fulfilment step and placed dates (IST)", () => {
    const q = where({ vendorId: V1, status: "placed,confirmed", step: "to_confirm,to_pack", from: "2026-10-01", to: "2026-10-31", q: "SO-12" });
    expect(q.sql).toContain('"vendor_orders"."vendor_id" in ($');
    expect(q.sql).toContain('"vendor_orders"."status" in ($');
    expect(q.sql).toMatch(/\(case\s+when "vendor_orders"\."status" in \('cancelled', 'returned'\) then 'closed'[\s\S]*end\) in \(\$/);
    expect(q.sql).toContain('"vendor_orders"."placed_at" >= $');
    expect(q.sql).toContain('"vendor_orders"."placed_at" < $');
    expect(q.sql).toContain('"vendor_orders"."order_number" ilike');
    // 1 Oct 00:00 IST = 30 Sep 18:30 UTC; the end is the next day's midnight.
    expect(q.params).toEqual(expect.arrayContaining([T, V1, "placed", "confirmed", "to_confirm", "to_pack", "%SO-12%"]));
    expect(q.params.map(String)).toEqual(expect.arrayContaining([expect.stringContaining("2026-09-30T18:30:00.000Z"), expect.stringContaining("2026-10-31T18:30:00.000Z")]));
  });

  it("drops one filter for its facet", () => {
    expect(where({ status: "shipped", step: "shipped" }, "status").params).toEqual([T, "shipped"]);
    expect(where({ status: "shipped", step: "done" }, "step").params).not.toContain("done");
  });

  it("sorts by date, number, sale total, net and status", () => {
    const render = (s?: string) => db.select().from(vendorOrders).orderBy(...VENDOR_ORDER_SORT.orderBy(s)).toSQL().sql;
    expect(render()).toContain('order by "vendor_orders"."placed_at" desc nulls last, "vendor_orders"."id" desc');
    expect(render("total")).toContain('("vendor_orders"."subtotal" - "vendor_orders"."discount" + "vendor_orders"."shipping_share") asc');
    expect(render("-net")).toContain('"vendor_orders"."net" desc');
    expect(() => render("lines")).toThrow(AppError);
  });
});

describe("payouts list", () => {
  const where = (q: Record<string, unknown>, omit = false) =>
    db.select().from(vendorPayouts).where(svc.payoutConditions(T, payoutListQuery.parse(q), omit)).toSQL();

  it("filters status, sellers, dates and searches reference / seller name", () => {
    const q = where({ status: "paid,failed", vendorId: `${V1},${V2}`, from: "2026-10-01", q: "utr" });
    expect(q.sql).toContain('"vendor_payouts"."status" in ($');
    expect(q.sql).toContain('"vendor_payouts"."vendor_id" in ($');
    expect(q.sql).toContain('"vendor_payouts"."created_at" >= $');
    expect(q.sql).toContain('"vendor_payouts"."provider_ref" ilike');
    expect(q.sql).toContain('(select vn.name from "vendors" vn where vn.id = "vendor_payouts".vendor_id) ilike');
    expect(q.params).toEqual(expect.arrayContaining([T, "paid", "failed", V1, V2, "%utr%"]));
    expect(where({ status: "paid" }, true).params).toEqual([T]);
  });

  it("sorts by date, amount, status and paid date", () => {
    const render = (s?: string) => db.select().from(vendorPayouts).orderBy(...PAYOUT_SORT.orderBy(s)).toSQL().sql;
    expect(render()).toContain('order by "vendor_payouts"."created_at" desc nulls last, "vendor_payouts"."id" desc');
    expect(render("amount")).toContain('"vendor_payouts"."amount" asc nulls last');
    expect(render("-paid")).toContain('"vendor_payouts"."paid_at" desc nulls last');
    expect(() => render("provider")).toThrow(AppError);
    expect(PAYOUT_SORT.keys).toEqual(["date", "amount", "status", "paid"]);
  });
});

describe("ledger list", () => {
  const where = (q: Record<string, unknown>, omit = false) =>
    db.select().from(vendorLedger).where(svc.ledgerConditions(T, ledgerListQuery.parse(q), omit)).toSQL();

  it("filters one seller, types, dates and the note", () => {
    const q = where({ vendorId: V1, type: "sale,refund", to: "2026-10-31", q: "lamp" });
    expect(q.sql).toContain('"vendor_ledger"."vendor_id" = $');
    expect(q.sql).toContain('"vendor_ledger"."type" in ($');
    expect(q.sql).toContain('"vendor_ledger"."created_at" < $');
    expect(q.sql).toContain('"vendor_ledger"."note" ilike');
    expect(q.params).toEqual(expect.arrayContaining([T, V1, "sale", "refund", "%lamp%"]));
    expect(where({ type: "sale" }, true).params).toEqual([T]);
  });

  it("sorts by date (default newest first), amount and type", () => {
    const render = (s?: string) => db.select().from(vendorLedger).orderBy(...LEDGER_SORT.orderBy(s)).toSQL().sql;
    expect(render()).toContain('order by "vendor_ledger"."created_at" desc nulls last, "vendor_ledger"."id" desc');
    expect(render("date")).toContain('"vendor_ledger"."created_at" asc nulls last, "vendor_ledger"."id" asc');
    expect(() => render("note")).toThrow(AppError);
  });
});

describe("product review list", () => {
  const where = (q: Record<string, unknown>, omit?: "status" | "kind") =>
    db.select().from(vendorProductReviews).where(svc.reviewConditions(T, reviewListQuery.parse(q), omit)).toSQL();

  it("filters status, first review vs re-review, sellers and products", () => {
    const q = where({ status: "pending", kind: "changed", vendorId: V1, productIds: V2, q: "pot" });
    expect(q.sql).toContain('"vendor_product_reviews"."status" in ($');
    expect(q.sql).toContain('"vendor_product_reviews"."changed_after_approval" = $');
    expect(q.sql).toContain('"vendor_product_reviews"."vendor_id" in ($');
    expect(q.sql).toContain('"vendor_product_reviews"."product_id" in ($');
    expect(q.sql).toContain('"vendor_product_reviews"."product_name" ilike');
    expect(q.params).toEqual(expect.arrayContaining([T, "pending", true, V1, V2, "%pot%"]));
    expect(where({ kind: "new" }).params).toEqual([T, false]);
    // Both kinds = no kind filter.
    expect(where({ kind: "new,changed" }).sql.split(" where ")[1]).toBe('"vendor_product_reviews"."tenant_id" = $1');
    expect(where({ status: "pending", kind: "new" }, "kind").params).toEqual([T, "pending"]);
    expect(where({ status: "pending", kind: "new" }, "status").params).toEqual([T, false]);
  });

  it("sorts the queue oldest first by default", () => {
    const render = (s?: string) => db.select().from(vendorProductReviews).orderBy(...REVIEW_SORT.orderBy(s)).toSQL().sql;
    expect(render()).toContain('order by "vendor_product_reviews"."submitted_at" asc nulls last, "vendor_product_reviews"."id" asc');
    expect(render("-submitted")).toContain('"vendor_product_reviews"."submitted_at" desc');
    expect(render("product")).toContain('lower("vendor_product_reviews"."product_name") asc');
    expect(() => render("reason")).toThrow(AppError);
    expect(REVIEW_SORT.keys).toEqual(["submitted", "product", "reviewed", "status"]);
  });

  it("a bad sort is a 400 before any query runs", async () => {
    await expect(svc.listProductReviews(T, { sort: "-nope" })).rejects.toMatchObject({ status: 400 });
    await expect(svc.listVendors(T, { sort: "rank" })).rejects.toMatchObject({ status: 400 });
  });
});
