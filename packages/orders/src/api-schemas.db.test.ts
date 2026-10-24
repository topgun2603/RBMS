/**
 * Database test of the API document shapes (routes.ts): runs the order routes the mobile app uses (list with filters,
 * summary, manual order, get, every status step and cancel, notes, payments, refunds, fulfillment, invoice retry)
 * against Postgres and checks every JSON answer with its response schema, so the schemas can't drift from what the
 * routes really return. Runs only with `ORDERS_TEST_DATABASE_URL` set (a development Postgres with the orders tables
 * migrated); it copies them into a throw-away schema and drops it afterwards. Catalogue and invoicing are fakes.
 *   PowerShell: $env:ORDERS_TEST_DATABASE_URL="postgres://srikit:srikit@localhost:5433/srikit"; pnpm test
 */
import { emptyContext, type RequestContext } from "@srirealtime/core";
import { createDb, type Db } from "@srirealtime/db";
import { sql } from "drizzle-orm";
import Fastify, { type FastifyInstance, type RouteOptions } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ZodError, type ZodTypeAny } from "zod";
import type { CatalogItem } from "./ports";
import { orderListSchema, orderSchema, ordersRoutes, ordersSummarySchema } from "./routes";
import { OrdersService } from "./service";

const URL_ = process.env.ORDERS_TEST_DATABASE_URL;
const SCHEMA = `orders_it_${Math.random().toString(36).slice(2, 10)}`;
const TABLES = ["orders", "order_events", "order_series"];
const tenant = { id: "11111111-1111-4111-8111-111111111111", slug: "sri", planId: "pro", appId: "BL" };
const user = { id: "22222222-2222-4222-8222-222222222222", sessionId: "s1", platformRoles: [], tenantRoles: ["staff"] };
const ITEMS: CatalogItem[] = [
  {
    id: "33333333-3333-4333-8333-333333333333",
    productId: "44444444-4444-4444-8444-444444444444",
    name: "Saree – Red",
    sku: "SAR-RED",
    barcode: null,
    hsn: "5007",
    unit: "pcs",
    rate: 95143,
    price: 99_900,
    taxInclusive: true,
    gstRate: 5,
    image: "https://img.example/saree.jpg",
    categoryId: null,
  },
  {
    id: "55555555-5555-4555-8555-555555555555",
    productId: "66666666-6666-4666-8666-666666666666",
    name: "Rice 1kg",
    sku: null,
    barcode: "8901000000011",
    hsn: "1006",
    unit: "kg",
    rate: 6000,
    price: 6000,
    taxInclusive: false,
    gstRate: 5,
    image: null,
  },
];
const [SAREE, RICE] = ITEMS.map((i) => i.id) as [string, string];

describe.skipIf(!URL_)("orders API shapes against Postgres", () => {
  let db: Db;
  let close: () => Promise<void>;
  let app: FastifyInstance;
  let invoiceFails = true;

  async function call<T extends ZodTypeAny>(schema: T, method: "GET" | "POST", url: string, payload?: object) {
    const res = await app.inject({ method, url, ...(payload ? { payload } : {}) });
    expect(res.statusCode, res.body).toBe(200);
    const json = res.json();
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new Error(`${method} ${url}: ${parsed.error.message}`);
    // zod strips unknown keys, so equality also catches fields the schema doesn't document.
    expect(parsed.data, `${method} ${url}: undocumented fields`).toEqual(json);
    return parsed.data as ReturnType<T["parse"]>;
  }

  beforeAll(async () => {
    const u = new URL(URL_!);
    u.searchParams.set("search_path", SCHEMA);
    ({ db, close } = createDb(u.toString(), { max: 5 }));
    await db.execute(sql.raw(`create schema "${SCHEMA}"`));
    for (const t of TABLES) await db.execute(sql.raw(`create table "${SCHEMA}"."${t}" (like public."${t}" including all)`));
    const service = new OrdersService({
      db,
      catalog: { getVariants: async (_t, ids) => ITEMS.filter((i) => ids.includes(i.id)) },
      seller: { get: async () => ({ stateCode: "33", legalName: "Sri Stores" }) },
      settings: { get: async () => ({ prefix: "ORD", invoiceOn: "delivered", allowBackorder: true, autoConfirm: false }) },
      invoicing: {
        createFromOrder: async () => {
          if (invoiceFails) throw new Error("billing is down");
          return { invoiceId: "77777777-7777-4777-8777-777777777777", number: "INV/26-27/0001" };
        },
        cancelInvoice: async () => {},
      },
    });
    app = Fastify();
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (req) => {
      req.ctx = { ...emptyContext(), tenant, user } as RequestContext;
    });
    app.setErrorHandler((err: { status?: number; statusCode?: number; message: string }, _req, reply) => {
      reply.status(err.status ?? (err instanceof ZodError ? 400 : (err.statusCode ?? 500))).send({ error: err.message });
    });
    await app.register(ordersRoutes(service), { prefix: "/v1/orders" });
  });
  afterAll(async () => {
    await app?.close();
    if (db) await db.execute(sql.raw(`drop schema if exists "${SCHEMA}" cascade`));
    await close?.();
  });

  it("orders, their status flow and money match their response schemas", async () => {
    const address = { name: "Meena", phone: "9876543210", line1: "1 Car St", city: "Madurai", stateCode: "33", pincode: "625001" };
    const order = await call(orderSchema, "POST", "/v1/orders", {
      customer: { name: "Meena", phone: "9876543210", email: "meena@example.com" },
      shippingAddress: address,
      lines: [
        { variantId: SAREE, qty: 1 },
        { variantId: RICE, qty: 2.5 },
      ],
      shipping: 5000,
      paymentMethod: "cod",
      notes: "Gift wrap",
      customerNote: "Call before coming",
    });
    expect(order).toMatchObject({ status: "placed", channel: "manual" });
    expect(order.totals.shippingLine).not.toBeNull();
    expect(await call(orderSchema, "GET", `/v1/orders/${order.id}`)).toEqual(order);

    // Status steps the app offers (with a fulfillment on ship), notes, money and tracking.
    await call(orderSchema, "POST", `/v1/orders/${order.id}/status`, { status: "confirmed", note: "Stock checked" });
    await call(orderSchema, "POST", `/v1/orders/${order.id}/status`, { status: "packed" });
    const shipped = await call(orderSchema, "POST", `/v1/orders/${order.id}/status`, {
      status: "shipped",
      fulfillment: { carrier: "India Post", trackingNumber: "EE123456789IN", trackingUrl: "https://track.example/EE123456789IN" },
    });
    expect(shipped.fulfillment.carrier).toBe("India Post");
    await call(orderSchema, "POST", `/v1/orders/${order.id}/notes`, { message: "Customer asked for evening delivery" });
    await call(orderSchema, "POST", `/v1/orders/${order.id}/fulfillment`, { carrier: "India Post", shipmentId: "SH-1" });
    // Part paid by UPI before delivery (delivery collects the COD balance).
    const paid = await call(orderSchema, "POST", `/v1/orders/${order.id}/payments`, { amount: 10_000, method: "upi", reference: "UPI-9" });
    expect(paid.paid).toBeGreaterThan(0);
    // Delivered: the invoice effect fails (billing down) without failing the request; the retry route makes it.
    const delivered = await call(orderSchema, "POST", `/v1/orders/${order.id}/status`, { status: "delivered" });
    expect(delivered.deliveredAt).not.toBeNull();
    const refunded = await call(orderSchema, "POST", `/v1/orders/${order.id}/refunds`, { amount: 2000, reason: "Late", method: "upi" });
    expect(refunded.refunded).toBe(2000);
    invoiceFails = false;
    const invoiced = await call(orderSchema, "POST", `/v1/orders/${order.id}/invoice`);
    expect(invoiced.invoiceNumber).toBe("INV/26-27/0001");
    expect(invoiced.events.length).toBeGreaterThan(5);

    // A counter order paid now, then cancelled.
    const counter = await call(orderSchema, "POST", "/v1/orders", {
      channel: "pos",
      customer: { name: "Walk-in" },
      lines: [{ variantId: RICE, qty: 1, price: 5500 }],
      paymentMethod: "cash",
      markPaid: true,
    });
    const cancelled = await call(orderSchema, "POST", `/v1/orders/${counter.id}/status`, { status: "cancelled", note: "Wrong item" });
    expect(cancelled.cancelledAt).not.toBeNull();

    // Lists and the dashboard.
    const list = await call(orderListSchema, "GET", "/v1/orders?limit=10&sort=-placed");
    expect(list.total).toBe(2);
    expect(list.counts).toMatchObject({ delivered: 1, cancelled: 1, placed: 0 });
    await call(orderListSchema, "GET", "/v1/orders?status=delivered,shipped&paymentStatus=paid,cod,unpaid&channel=manual&q=meena");
    await call(ordersSummarySchema, "GET", "/v1/orders/summary");
  });
});

describe("orders API document config", () => {
  it("documented routes keep their feature config", async () => {
    const seen = new Map<string, RouteOptions>();
    const app = Fastify();
    app.decorateRequest("ctx", null as never);
    app.addHook("onRoute", (r) => {
      seen.set(`${r.method} ${r.url}`, r);
    });
    await app.register(ordersRoutes({} as OrdersService), { prefix: "/v1/orders" });
    const status = seen.get("POST /v1/orders/:id([0-9a-fA-F-]{36})/status")!;
    expect(status.config).toMatchObject({ feature: "orders" });
    expect(status.config?.schema?.body).toBeTruthy();
    expect(seen.get("GET /v1/orders")!.config?.schema?.query).toBeTruthy();
    await app.close();
  });
});
