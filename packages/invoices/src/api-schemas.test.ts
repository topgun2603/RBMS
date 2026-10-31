import { createDb } from "@rbms/db";
import Fastify, { type RouteOptions } from "fastify";
import { afterAll, describe, expect, it } from "vitest";
import { billingItemListSchema, invoicesRoutes, tillReportSchema } from "./routes";
import type { ItemSourcePort } from "./ports";
import { InvoicesService } from "./service";
import { tillReport } from "./till-calc";

// Never connects: the item source below answers instead of the database.
const { db, close } = createDb("postgres://u:p@127.0.0.1:1/none", { max: 1 });
afterAll(() => close());

const T = "11111111-1111-4111-8111-111111111111";

describe("API document shapes (no database)", () => {
  it("the item list over the catalogue (stock, category, facets) matches billingItemListSchema", async () => {
    const svc = new InvoicesService({
      db,
      seller: { get: async () => ({}) },
      branding: { get: async () => ({ appName: null, logoUrl: null, css: "" }) },
      publicBaseUrl: "https://bill.example.com",
      items: {
        list: async () => ({
          items: [
            {
              id: "33333333-3333-4333-8333-333333333333",
              name: "Saree – Red",
              hsn: "5007",
              unit: "pcs",
              rate: 95143,
              gstRate: 5,
              createdAt: new Date("2026-10-01T05:00:00Z"),
              categoryId: null,
              active: true,
              stockQty: 2.5,
              stockStatus: "low" as const,
            },
          ],
          total: 1,
          facets: { stock: { low: 1 } },
          categories: [{ id: "44444444-4444-4444-8444-444444444444", name: "Sarees" }],
        }),
        get: async () => null,
        create: async () => {
          throw new Error("unused");
        },
        update: async () => null,
        remove: async () => false,
      } satisfies ItemSourcePort,
    });
    const json = JSON.parse(JSON.stringify(await svc.listItems(T, { q: "saree", limit: 5 })));
    expect(billingItemListSchema.parse(json)).toEqual(json);
  });

  it("the X report from tillReport matches tillReportSchema", () => {
    const r = tillReport({
      openingCash: 100_000,
      cashEntries: [{ amount: 5000 }, { amount: -2000 }],
      payments: [
        { method: "cash", amount: 30_000, source: "manual" },
        { method: "upi", amount: 12_000, source: "manual" },
        { method: "cash", amount: -1000, source: "refund" },
      ],
      bills: [
        { status: "paid", total: 42_000, balance: 0 },
        { status: "cancelled", total: 500, balance: 0 },
      ],
      creditNotes: [{ total: 1000 }],
    });
    expect(tillReportSchema.parse(r)).toEqual(r);
  });

  it("documented routes keep their feature and audit config", async () => {
    const seen = new Map<string, RouteOptions>();
    const app = Fastify();
    app.decorateRequest("ctx", null as never);
    app.addHook("onRoute", (r) => {
      seen.set(`${r.method} ${r.url}`, r);
    });
    await app.register(invoicesRoutes({} as InvoicesService), { prefix: "/v1/invoices" });
    const open = seen.get("POST /v1/invoices/till/open")!;
    expect(open.config).toMatchObject({ feature: "invoices", audit: { action: "invoices.till.open", entity: "till_session" } });
    expect(open.config?.schema?.body).toBeTruthy();
    const create = seen.get("POST /v1/invoices")!;
    expect(create.config?.feature).toBe("invoices");
    expect(create.config?.schema?.response).toBeTruthy();
    expect(seen.get("POST /v1/invoices/:id([0-9a-fA-F-]{36})/send")!.config?.feature).toBe("invoices.whatsapp");
    const book = seen.get("GET /v1/invoices/credit-book")!;
    expect(book.config).toMatchObject({ feature: "invoices.credit-book" });
    expect(book.config?.schema?.query).toBeTruthy();
    expect(seen.get("POST /v1/invoices/customers/:id/receipts")!.config?.feature).toBe("invoices.credit-book");
    expect(seen.get("POST /v1/invoices/customers/:id/remind")!.config?.feature).toBe("invoices.whatsapp");
    expect(seen.get("PATCH /v1/invoices/customers/:id")!.config?.schema?.response).toBeTruthy();
    await app.close();
  });
});
