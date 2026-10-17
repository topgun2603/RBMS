import { AppError } from "@srirealtime/core";
import { createDb } from "@srirealtime/db";
import { afterAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { invoices } from "./schema";
import { INVOICE_SORT, InvoicesService, invoiceListQuerySchema } from "./service";

// Never connects: only renders SQL.
const { db, close } = createDb("postgres://u:p@127.0.0.1:1/none", { max: 1 });
afterAll(() => close());

const T = "11111111-1111-4111-8111-111111111111";
const B1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const B2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const svc = new InvoicesService({
  db,
  seller: { get: async () => ({ legalName: "Sri", stateCode: "33" }) },
  branding: { get: async () => ({ appName: null, logoUrl: null, css: "" }) },
  publicBaseUrl: "https://bill.example.com",
} as unknown as ConstructorParameters<typeof InvoicesService>[0]);

const where = (q: Record<string, unknown>, withStatus = true) =>
  db.select().from(invoices).where(svc.listConditions(T, invoiceListQuerySchema.parse(q), "2026-10-17", withStatus)).toSQL();

describe("bill list query", () => {
  it("keeps the existing limits and accepts comma lists", () => {
    expect(invoiceListQuerySchema.parse({}).limit).toBe(50);
    expect(invoiceListQuerySchema.parse({ limit: "200" }).limit).toBe(200);
    expect(() => invoiceListQuerySchema.parse({ limit: "201" })).toThrow(ZodError);
    const p = invoiceListQuerySchema.parse({ status: "paid,overdue", branchId: `${B1},${B2}`, method: "upi,cash" });
    expect(p.status).toEqual(["paid", "overdue"]);
    expect(p.branchId).toEqual([B1, B2]);
    expect(p.method).toEqual(["upi", "cash"]);
    expect(() => invoiceListQuerySchema.parse({ status: "lost" })).toThrow(ZodError);
    expect(() => invoiceListQuerySchema.parse({ from: "2026-10-02", to: "2026-10-01" })).toThrow(ZodError);
  });

  it("ORs plain statuses with overdue (open and past due)", () => {
    const q = where({ status: "paid,overdue" });
    expect(q.sql).toContain('"invoices"."status" in ($');
    expect(q.sql).toContain('"invoices"."due_date" < $');
    expect(q.sql).toMatch(/ or \(/);
    expect(q.params).toEqual(expect.arrayContaining([T, "paid", "issued", "partially_paid", "2026-10-17"]));
  });

  it("filters branches, dates, payment methods and escapes the search", () => {
    const q = where({ branchId: B1, from: "2026-10-01", to: "2026-10-31", method: "upi", q: "50%" });
    expect(q.sql).toContain('"invoices"."branch_id" in ($');
    expect(q.sql).toContain('exists (select 1 from "invoice_payments"');
    expect(q.sql).toContain(`"invoices"."customer"->>'phone' ilike`);
    expect(q.params).toEqual(expect.arrayContaining([B1, "2026-10-01", "2026-10-31", "upi", "%50\\%%"]));
  });

  it("drops the status filter for the facet counts", () => {
    const q = where({ status: "paid", q: "ravi" }, false);
    expect(q.params).not.toContain("paid");
    expect(q.params).toContain("%ravi%");
  });

  it("sorts by the whitelisted fields only", () => {
    const render = (s?: string) => db.select().from(invoices).orderBy(...INVOICE_SORT.orderBy(s)).toSQL().sql;
    expect(render()).toContain('order by "invoices"."date" desc nulls last, "invoices"."created_at" desc, "invoices"."id" desc');
    expect(render("number")).toContain('order by ("invoices"."fy", "invoices"."seq") asc nulls last');
    expect(render("-balance")).toContain("greatest(");
    expect(render("customer")).toContain(`lower("invoices"."customer"->>'name') asc`);
    expect(() => render("-secret")).toThrow(AppError);
    expect(INVOICE_SORT.keys).toEqual(["number", "date", "customer", "total", "balance", "status"]);
  });
});
