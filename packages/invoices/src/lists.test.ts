import { AppError } from "@srirealtime/core";
import { createDb } from "@srirealtime/db";
import { afterAll, describe, expect, it } from "vitest";
import { ZodError } from "zod";
import { CREDIT_NOTE_SORT, creditNoteListQuerySchema } from "./credit-notes";
import { billingItems, creditNotes } from "./schema";
import {
  creditBookQuerySchema,
  customerListQuerySchema,
  InvoicesService,
  itemListQuerySchema,
  LOCAL_ITEM_SORT,
} from "./service";

// Never connects: only renders SQL.
const { db, close } = createDb("postgres://u:p@127.0.0.1:1/none", { max: 1 });
afterAll(() => close());

const T = "11111111-1111-4111-8111-111111111111";
const C1 = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const svc = new InvoicesService({
  db,
  seller: { get: async () => ({ legalName: "Sri", stateCode: "33" }) },
  branding: { get: async () => ({ appName: null, logoUrl: null, css: "" }) },
  publicBaseUrl: "https://bill.example.com",
  now: () => new Date("2026-10-17T06:00:00Z"),
} as unknown as ConstructorParameters<typeof InvoicesService>[0]);

describe("customer list", () => {
  const render = (q: Record<string, unknown>, withBalance = true) => {
    const cq = svc.customerQuery(T);
    const p = customerListQuerySchema.parse(q);
    return cq
      .rows()
      .where(svc.customerListConditions(cq, p, withBalance))
      .orderBy(...svc.customerSort(cq).orderBy(p.sort))
      .toSQL();
  };

  it("keeps the picker limits and parses the filters", () => {
    expect(customerListQuerySchema.parse({}).limit).toBe(50);
    expect(customerListQuerySchema.parse({ limit: "8" }).limit).toBe(8);
    expect(() => customerListQuerySchema.parse({ limit: "201" })).toThrow(ZodError);
    const p = customerListQuerySchema.parse({ balance: "due,advance", overLimit: "true" });
    expect(p.balance).toEqual(["due", "advance"]);
    expect(p.overLimit).toBe(true);
    expect(() => customerListQuerySchema.parse({ balance: "owed" })).toThrow(ZodError);
  });

  it("searches name, phone and GSTIN and filters by balance kind and credit limit", () => {
    const q = render({ q: "meena", balance: "due", overLimit: "true" });
    expect(q.sql).toContain('"billing_customers"."gstin" ilike');
    expect(q.sql).toContain("then 'due' when");
    expect(q.sql).toContain('"billing_customers"."credit_limit" is not null and');
    expect(q.params).toEqual(expect.arrayContaining([T, "%meena%", "due"]));
  });

  it("drops the balance filter for its facet counts", () => {
    const q = render({ balance: "settled" }, false);
    expect(q.params).not.toContain("settled");
  });

  it("sorts by name, balance, last bill and total billed only", () => {
    expect(render({}).sql).toContain('order by lower("billing_customers"."name") asc nulls last, "billing_customers"."id" asc');
    expect(render({ sort: "-balance" }).sql).toMatch(/order by \("billing_customers"\."opening_balance" \+ .* desc nulls last/);
    expect(render({ sort: "-lastBill" }).sql).toContain('order by "cq_last_invoice" desc nulls last');
    expect(render({ sort: "billed" }).sql).toContain('order by (coalesce("cq_billed", 0) - coalesce("cq_credited", 0)) asc');
    expect(() => render({ sort: "phone" })).toThrow(AppError);
  });
});

describe("credit book", () => {
  const render = (q: Record<string, unknown>, withAge = true) => {
    const cq = svc.customerQuery(T);
    const p = creditBookQuerySchema.parse(q);
    return cq
      .rows()
      .where(svc.creditBookConditions(cq, p, withAge))
      .orderBy(...svc.creditBookSort(cq).orderBy(p.sort))
      .toSQL();
  };

  it("keeps filter=due/advance/all and the 100 / 500 limits", () => {
    expect(creditBookQuerySchema.parse({}).filter).toBe("all");
    expect(creditBookQuerySchema.parse({}).limit).toBe(100);
    expect(creditBookQuerySchema.parse({ limit: "500" }).limit).toBe(500);
    expect(creditBookQuerySchema.parse({ age: "31-60,90+" }).age).toEqual(["31-60", "90+"]);
    expect(() => creditBookQuerySchema.parse({ age: "120+" })).toThrow(ZodError);
  });

  it("buckets customers by days their oldest open bill is past due", () => {
    const q = render({ filter: "due", age: "61-90" });
    expect(q.sql).toContain('min(coalesce("due_date", "date")) filter (where');
    expect(q.sql).toContain("then '61-90'");
    expect(q.params).toEqual(expect.arrayContaining(["2026-10-17", "61-90"]));
    expect(render({ age: "61-90" }, false).params).not.toContain("61-90");
  });

  it("sorts by dues (default, biggest first), oldest due, last payment and name", () => {
    expect(render({}).sql).toMatch(/order by \("billing_customers"\."opening_balance" .* desc nulls last, "billing_customers"\."id" desc/);
    expect(render({ sort: "oldestDue" }).sql).toContain('order by "cq_oldest_due" asc nulls last');
    expect(render({ sort: "-lastPayment" }).sql).toContain('order by greatest("cq_last_payment", "cq_last_receipt") desc nulls last');
    expect(() => render({ sort: "balance" })).toThrow(AppError);
  });
});

describe("item list", () => {
  it("parses category, stock, GST rate and active", () => {
    const p = itemListQuerySchema.parse({ category: C1, stock: "low,out", gstRate: "5,0.25", active: "false" });
    expect(p).toMatchObject({ category: [C1], stock: ["low", "out"], gstRate: ["5", "0.25"], active: false });
    expect(itemListQuerySchema.parse({}).limit).toBe(50);
    expect(itemListQuerySchema.parse({ limit: "200" }).limit).toBe(200);
    expect(() => itemListQuerySchema.parse({ gstRate: "7" })).toThrow(ZodError);
    expect(() => itemListQuerySchema.parse({ stock: "some" })).toThrow(ZodError);
  });

  it("filters the built-in items by GST rate and sorts by name / price / GST", () => {
    const where = svc.localItemConditions(T, itemListQuerySchema.parse({ q: "silk", gstRate: "5,12" }));
    const q = db.select().from(billingItems).where(where).orderBy(...LOCAL_ITEM_SORT.orderBy("-price")).toSQL();
    expect(q.sql).toContain('"billing_items"."gst_rate" in ($');
    expect(q.sql).toContain('order by "billing_items"."rate" desc nulls last');
    expect(q.params).toEqual(expect.arrayContaining([T, "%silk%", 5, 12]));
    expect(LOCAL_ITEM_SORT.keys).toEqual(["name", "price", "stock", "gstRate"]);
    expect(() => LOCAL_ITEM_SORT.orderBy("hsn")).toThrow(AppError);
  });

  it("hands sort and filters to the item source", async () => {
    let seen: unknown;
    const withSource = new InvoicesService({
      db,
      seller: { get: async () => ({}) },
      branding: { get: async () => ({ appName: null, logoUrl: null, css: "" }) },
      publicBaseUrl: "https://bill.example.com",
      items: {
        list: async (_t: string, q: unknown) => {
          seen = q;
          return { items: [], total: 0, facets: { stock: { low: 2 } }, categories: [{ id: C1, name: "Sarees" }] };
        },
      },
    } as unknown as ConstructorParameters<typeof InvoicesService>[0]);
    // Raw query-string values, as the route passes them through: listItems parses them.
    const raw = { sort: "-stock", stock: "low", gstRate: "5", category: C1, active: "true", limit: "25" };
    const r = await withSource.listItems(T, raw as unknown as Parameters<typeof withSource.listItems>[1]);
    expect(seen).toEqual({ q: undefined, limit: 25, offset: 0, sort: "-stock", category: [C1], stock: ["low"], gstRate: [5], active: true });
    expect(r).toMatchObject({ total: 0, limit: 25, offset: 0, facets: { stock: { low: 2 } }, categories: [{ id: C1, name: "Sarees" }] });
    await expect(withSource.listItems(T, { sort: "secret" })).rejects.toThrow(AppError);
  });
});

describe("credit note list", () => {
  const where = (q: Record<string, unknown>, without?: "status" | "reason" | "refundMode") =>
    db.select().from(creditNotes).where(svc.creditNotes.listConditions(T, creditNoteListQuerySchema.parse(q), without)).toSQL();

  it("keeps the 50 / 200 limits and takes comma lists", () => {
    expect(creditNoteListQuerySchema.parse({}).limit).toBe(50);
    expect(creditNoteListQuerySchema.parse({ limit: "200" }).limit).toBe(200);
    const p = creditNoteListQuerySchema.parse({ status: "issued", reason: "return,discount", refundMode: "cash,upi" });
    expect(p).toMatchObject({ status: ["issued"], reason: ["return", "discount"], refundMode: ["cash", "upi"] });
    expect(() => creditNoteListQuerySchema.parse({ reason: "broken" })).toThrow(ZodError);
    expect(() => creditNoteListQuerySchema.parse({ from: "2026-10-02", to: "2026-10-01" })).toThrow(ZodError);
  });

  it("filters reason, refund mode, status and dates and searches number, bill number and customer", () => {
    const q = where({ reason: "return", refundMode: "upi", status: "issued", from: "2026-10-01", to: "2026-10-31", q: "CN_1" });
    expect(q.sql).toContain('"credit_notes"."reason" in ($');
    expect(q.sql).toContain('"credit_notes"."refund_mode" in ($');
    expect(q.sql).toContain('"credit_notes"."invoice_number" ilike');
    expect(q.params).toEqual(expect.arrayContaining([T, "return", "upi", "issued", "2026-10-01", "2026-10-31", "%CN\\_1%"]));
    expect(where({ reason: "return", status: "issued" }, "reason").params).not.toContain("return");
  });

  it("sorts by number, date (default), total and refund", () => {
    const render = (s?: string) => db.select().from(creditNotes).orderBy(...CREDIT_NOTE_SORT.orderBy(s)).toSQL().sql;
    expect(render()).toContain('order by "credit_notes"."date" desc nulls last, "credit_notes"."issued_at" desc, "credit_notes"."id" desc');
    expect(render("number")).toContain('order by ("credit_notes"."fy", "credit_notes"."seq") asc');
    expect(render("-refund")).toContain('order by "credit_notes"."refund_amount" desc');
    expect(() => render("reason")).toThrow(AppError);
  });
});
