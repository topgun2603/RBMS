import { AppError, emptyContext, type RequestContext } from "@srirealtime/core";
import { createDb } from "@srirealtime/db";
import { eq } from "drizzle-orm";
import Fastify from "fastify";
import { afterAll, describe, expect, it, vi } from "vitest";
import { ZodError } from "zod";
import { ordersCsv } from "./csv";
import { createOrders } from "./index";
import type { CatalogItem, CouponPort, StockPort } from "./ports";
import { ordersRoutes } from "./routes";
import {
  addressSchema,
  allocateOrderSeqStatement,
  checkoutSchema,
  listQuerySchema,
  manualOrderSchema,
  OrdersService,
  statusInputSchema,
  summaryColumns,
  type OrderSummary,
} from "./service";
import { orders } from "./schema";

// Never connects: only used to render SQL (and any accidental query fails fast).
const { db, close } = createDb("postgres://u:p@127.0.0.1:1/none", { max: 1 });
afterAll(() => close());

const T = "11111111-1111-4111-8111-111111111111";
const V1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const V2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const address = { line1: "12 Car Street", city: "Madurai", stateCode: "33", pincode: "625001" };

const item = (id: string, patch: Partial<CatalogItem> = {}): CatalogItem => ({
  id,
  productId: `p-${id}`,
  name: "Cotton Saree",
  sku: null,
  barcode: null,
  hsn: "5208",
  unit: "pcs",
  rate: 47524,
  price: 49900,
  taxInclusive: true,
  gstRate: 5,
  image: null,
  ...patch,
});

describe("validation", () => {
  it("checkout never takes client prices and needs a phone and shipping address", () => {
    const c = checkoutSchema.parse({
      customer: { name: "Meena", phone: "9876543210" },
      shippingAddress: address,
      lines: [{ variantId: V1, qty: 1, price: 1 }],
      paymentMethod: "cod",
    });
    expect(c.lines[0]).toEqual({ variantId: V1, qty: 1 });
    expect(c.shipping).toBe(0);
    expect(c.codFee).toBe(0);
    expect(checkoutSchema.parse({ customer: { name: "M", phone: "9876543210" }, shippingAddress: address, lines: [{ variantId: V1, qty: 1 }], paymentMethod: "cod", shipping: 4000, codFee: 3000 })).toMatchObject({ shipping: 4000, codFee: 3000 });
    expect(() => checkoutSchema.parse({ customer: { name: "M", phone: "9876543210" }, shippingAddress: address, lines: [{ variantId: V1, qty: 1 }], paymentMethod: "cod", codFee: -1 })).toThrow(ZodError);
    expect(() => checkoutSchema.parse({ customer: { name: "Meena" }, shippingAddress: address, lines: [{ variantId: V1, qty: 1 }], paymentMethod: "cod" })).toThrow(ZodError);
    expect(() => checkoutSchema.parse({ customer: { name: "M", phone: "9876543210" }, lines: [{ variantId: V1, qty: 1 }], paymentMethod: "cod" })).toThrow(ZodError);
    expect(() =>
      checkoutSchema.parse({ customer: { name: "M", phone: "9876543210" }, shippingAddress: address, lines: [{ variantId: V1, qty: 1 }], paymentMethod: "cash" }),
    ).toThrow(ZodError);
  });
  it("manual orders allow staff prices and default to cash", () => {
    const m = manualOrderSchema.parse({ customer: { name: "Walk-in" }, lines: [{ variantId: V1, qty: 2.5, price: 10000 }] });
    expect(m).toMatchObject({ channel: "manual", paymentMethod: "cash", shipping: 0, lines: [{ variantId: V1, qty: 2.5, price: 10000 }] });
    expect(() => manualOrderSchema.parse({ customer: { name: "x" }, lines: [] })).toThrow(ZodError);
    expect(() => manualOrderSchema.parse({ customer: { name: "x" }, lines: [{ variantId: V1, qty: 1.0005 }] })).toThrow(ZodError);
  });
  it("addresses: state code and PIN", () => {
    expect(addressSchema.parse({ ...address, stateCode: 33 })).toMatchObject({ stateCode: "33", country: "IN" });
    expect(() => addressSchema.parse({ ...address, pincode: "62500" })).toThrow(ZodError);
    expect(() => addressSchema.parse({ ...address, stateCode: "99" })).toThrow(ZodError);
  });
  it("status and list queries", () => {
    expect(() => statusInputSchema.parse({ status: "lost" })).toThrow(ZodError);
    expect(statusInputSchema.parse({ status: "shipped", fulfillment: { carrier: "India Post", trackingUrl: "" } })).toMatchObject({
      fulfillment: { carrier: "India Post", trackingUrl: null },
    });
    expect(() => listQuerySchema.parse({ from: "2026-10-02", to: "2026-10-01" })).toThrow(ZodError);
    expect(listQuerySchema.parse({ limit: "10" }).limit).toBe(10);
  });
});

describe("SQL", () => {
  it("summary binds the IST day/month starts as strings, never raw Dates", () => {
    const q = db.select(summaryColumns(new Date("2026-10-14T18:30:00.000Z"), new Date("2026-09-30T18:30:00.000Z"))).from(orders).where(eq(orders.tenantId, T)).toSQL();
    expect(q.params).toEqual(expect.arrayContaining(["2026-10-14T18:30:00.000Z", "2026-09-30T18:30:00.000Z", T]));
    expect(q.params.some((p) => p instanceof Date)).toBe(false);
    expect(q.sql).toContain("::timestamptz");
  });
  it("allocates order numbers atomically per FY", () => {
    const { sql, params } = allocateOrderSeqStatement(db, { tenantId: "t1", fy: "26-27", prefix: "ORD" }).toSQL();
    expect(sql).toContain('insert into "order_series"');
    expect(sql).toContain('on conflict ("tenant_id","fy") do update set');
    expect(sql).toContain('"next_seq" = "order_series"."next_seq" + 1');
    expect(params).toEqual(expect.arrayContaining(["t1", "26-27", "ORD"]));
  });
  it("filters lists by tenant, IST dates and search; counts ignore the status filter", () => {
    const svc = new OrdersService({ db, catalog: { getVariants: async () => [] }, seller: { get: async () => ({ stateCode: "33" }) }, settings: { get: async () => ({}) } });
    const p = listQuerySchema.parse({ status: "placed", channel: "store", q: "meena", from: "2026-10-01", to: "2026-10-31" });
    const withStatus = db.select().from(orders).where(svc.listConditions(T, p, true)).toSQL();
    expect(withStatus.sql).toContain('"orders"."status" = $');
    expect(withStatus.sql).toContain(`"orders"."customer"->>'phone' ilike`);
    expect(withStatus.params).toEqual(expect.arrayContaining([T, "placed", "store", "%meena%"]));
    expect(withStatus.params).toContain("2026-09-30T18:30:00.000Z");
    const counts = db.select().from(orders).where(svc.listConditions(T, p, false)).toSQL();
    expect(counts.params).not.toContain("placed");
  });
});

describe("placing orders: blocking side effects", () => {
  const build = (patch: { stock?: StockPort; coupons?: CouponPort; items?: CatalogItem[] } = {}) =>
    new OrdersService({
      db,
      catalog: { getVariants: vi.fn(async () => patch.items ?? [item(V1)]) },
      seller: { get: async () => ({ stateCode: "33", legalName: "Sri Lakshmi Silks" }) },
      settings: { get: async () => ({ allowBackorder: false }) },
      stock: patch.stock,
      coupons: patch.coupons,
    });
  const manual = { customer: { name: "Walk-in" }, lines: [{ variantId: V1, qty: 2 }] };

  it("refuses unknown items with 400 invalid_items", async () => {
    const svc = build({ items: [] });
    await expect(svc.create(T, manual)).rejects.toMatchObject({ status: 400, code: "invalid_items", details: { missing: [V1] } });
  });

  it("passes 409 insufficient_stock through and reserves with the order's lines", async () => {
    const short = new AppError(409, "insufficient_stock", "Not enough stock", [{ itemId: V1, available: 1 }]);
    const stock: StockPort = { reserve: vi.fn(async () => Promise.reject(short)), release: vi.fn(async () => undefined), commit: vi.fn(async () => undefined) };
    const svc = build({ stock });
    await expect(svc.create(T, { ...manual, locationId: V2 })).rejects.toBe(short);
    expect(stock.reserve).toHaveBeenCalledWith(T, expect.objectContaining({ refType: "order", locationId: V2, lines: [{ itemId: V1, qty: 2 }], allowBackorder: false }));
    expect(stock.release).not.toHaveBeenCalled();
  });

  it("honours a per-order backorder override", async () => {
    const stock: StockPort = { reserve: vi.fn(async () => Promise.reject(new Error("stop"))), release: vi.fn(), commit: vi.fn() };
    await expect(build({ stock }).create(T, { ...manual, allowBackorder: true })).rejects.toThrow("stop");
    expect(stock.reserve).toHaveBeenCalledWith(T, expect.objectContaining({ allowBackorder: true }));
  });

  it("an invalid coupon refuses the order before stock is touched", async () => {
    const stock: StockPort = { reserve: vi.fn(), release: vi.fn(), commit: vi.fn() };
    const coupons: CouponPort = {
      evaluate: vi.fn(async () => ({ valid: false as const, reason: "expired", message: "This coupon has expired" })),
      redeem: vi.fn(),
      release: vi.fn(),
    };
    await expect(build({ stock, coupons }).create(T, { ...manual, couponCode: "diwali10" })).rejects.toMatchObject({
      status: 400,
      code: "coupon_invalid",
      details: { reason: "expired" },
    });
    expect(coupons.evaluate).toHaveBeenCalledWith(T, "DIWALI10", expect.objectContaining({ channel: "manual", subtotal: 99800, lines: [{ productId: `p-${V1}`, categoryId: null, amount: 99800 }] }));
    expect(stock.reserve).not.toHaveBeenCalled();
  });

  it("a coupon redeem that loses the race releases the reserved stock", async () => {
    const stock: StockPort = { reserve: vi.fn(async () => undefined), release: vi.fn(async () => undefined), commit: vi.fn() };
    const raced = new AppError(409, "coupon_invalid", "This coupon has been fully used", { reason: "usage_limit" });
    const coupons: CouponPort = {
      evaluate: vi.fn(async () => ({ valid: true as const, couponId: "c1", discount: 9980, freeShipping: false, lineDiscounts: [9980] })),
      redeem: vi.fn(async () => Promise.reject(raced)),
      release: vi.fn(async () => undefined),
    };
    await expect(build({ stock, coupons }).create(T, { ...manual, couponCode: "DIWALI10" })).rejects.toBe(raced);
    const reserveCall = (stock.reserve as ReturnType<typeof vi.fn>).mock.calls[0]!;
    const orderId = (reserveCall[1] as { refId: string }).refId;
    expect(coupons.redeem).toHaveBeenCalledWith(T, "DIWALI10", { refType: "order", refId: orderId }, null, 9980);
    expect(stock.release).toHaveBeenCalledWith(T, "order", orderId);
  });

  it("refuses coupons when the coupons module isn't wired", async () => {
    await expect(build().create(T, { ...manual, couponCode: "X10" })).rejects.toMatchObject({ code: "coupon_invalid" });
  });

  it("verified-buyer lookup needs an account and a product uuid (no query otherwise)", async () => {
    const svc = build();
    await expect(svc.deliveredOrderWithProduct(T, "", V1)).resolves.toBeNull();
    await expect(svc.deliveredOrderWithProduct(T, V2, "not-a-uuid")).resolves.toBeNull();
  });

  it("tells the events port about payments, never throws, skips zero amounts", async () => {
    const paymentRecorded = vi.fn(async () => Promise.reject(new Error("listener down")));
    const svc = new OrdersService({
      db,
      catalog: { getVariants: async () => [] },
      seller: { get: async () => ({ stateCode: "33" }) },
      settings: { get: async () => ({}) },
      events: { paymentRecorded },
    });
    const row = { tenantId: T, id: V1, channel: "store", customer: { name: "M", phone: null, email: null, accountId: V2 } };
    const notify = (svc as unknown as { paymentRecorded: (r: typeof row, a: number, s: string) => Promise<void> }).paymentRecorded.bind(svc);
    await expect(notify(row, 5000, "cod")).resolves.toBeUndefined();
    expect(paymentRecorded).toHaveBeenCalledWith({ tenantId: T, orderId: V1, channel: "store", accountId: V2, amount: 5000, source: "cod" });
    await notify(row, 0, "manual");
    expect(paymentRecorded).toHaveBeenCalledTimes(1);
  });

  it("checkout needs the orders feature", async () => {
    const svc = new OrdersService({
      db,
      catalog: { getVariants: async () => [] },
      seller: { get: async () => ({ stateCode: "33" }) },
      settings: { get: async () => ({}) },
      featureGate: { isEnabled: async () => false },
    });
    await expect(svc.createFromCheckout(T, {} as never)).rejects.toMatchObject({ status: 403, code: "feature_disabled" });
  });
});

describe("csv", () => {
  it("writes the order list", () => {
    const row: OrderSummary = {
      id: "o1",
      number: "ORD/26-27/0001",
      channel: "store",
      status: "placed",
      paymentStatus: "cod",
      paymentMethod: "cod",
      customerName: "Meena, R",
      customerPhone: "+919876543210",
      itemCount: 2,
      total: 64900,
      paid: 0,
      placedAt: new Date("2026-10-15T06:00:00Z"),
    };
    const csv = ordersCsv([row]);
    expect(csv.startsWith("﻿Order,Placed (IST),Channel")).toBe(true);
    expect(csv).toContain('ORD/26-27/0001,2026-10-15 11:30,store,"Meena, R",\'+919876543210,2,649.00,0.00,placed,cod,cod\r\n');
  });
});

describe("routes", () => {
  const ctx = (patch: Partial<RequestContext>): RequestContext => ({ ...emptyContext(), ...patch });
  const tenant = { id: T, slug: "sri", planId: "pro", appId: "EC" };
  const staffUser = { id: "u1", sessionId: "s1", platformRoles: [], tenantRoles: ["staff"] };
  const id = "22222222-2222-4222-8222-222222222222";

  async function build(reqCtx: RequestContext) {
    const summary: OrderSummary = {
      id,
      number: "ORD/26-27/0001",
      channel: "manual",
      status: "placed",
      paymentStatus: "unpaid",
      paymentMethod: "cash",
      customerName: "Ravi",
      customerPhone: null,
      itemCount: 1,
      total: 10000,
      paid: 0,
      placedAt: new Date("2026-10-15T06:00:00Z"),
    };
    const service = {
      list: vi.fn(async () => ({ items: [summary], total: 1, counts: {} })),
      summary: vi.fn(async () => ({ today: { count: 0, total: 0 } })),
      create: vi.fn(async () => ({ id })),
      get: vi.fn(async () => ({ id })),
      updateStatus: vi.fn(async () => ({ id })),
      addNote: vi.fn(async () => ({ id })),
      addPayment: vi.fn(async () => ({ id })),
      addRefund: vi.fn(async () => ({ id })),
      updateFulfillment: vi.fn(async () => ({ id })),
      retryInvoice: vi.fn(async () => ({ id })),
    } as unknown as OrdersService;
    const features: unknown[] = [];
    const app = Fastify();
    app.decorateRequest("ctx", null as never);
    app.addHook("onRequest", async (req) => {
      req.ctx = reqCtx;
    });
    app.addHook("preHandler", async (req) => {
      features.push(req.routeOptions.config.feature);
    });
    app.setErrorHandler((err: { status?: number; statusCode?: number }, _req, reply) => {
      const code = (err as { code?: unknown }).code;
      const details = (err as { details?: unknown }).details;
      reply.status(err.status ?? (err instanceof ZodError ? 400 : (err.statusCode ?? 500))).send({ error: typeof code === "string" ? { code, details } : true });
    });
    await app.register(ordersRoutes(service), { prefix: "/v1/orders" });
    return { app, service, features };
  }

  it("needs a staff member of the tenant", async () => {
    expect((await (await build(ctx({ tenant }))).app.inject({ url: "/v1/orders" })).statusCode).toBe(401);
    const member = { ...staffUser, tenantRoles: ["member"] };
    expect((await (await build(ctx({ tenant, user: member }))).app.inject({ url: "/v1/orders" })).statusCode).toBe(403);
  });

  it("wires every route with the orders feature", async () => {
    const { app, service, features } = await build(ctx({ tenant, user: staffUser }));
    expect((await app.inject({ url: "/v1/orders?status=placed" })).statusCode).toBe(200);
    expect(service.list).toHaveBeenCalledWith(T, { status: "placed" });
    await app.inject({ url: "/v1/orders/summary" });
    expect(service.summary).toHaveBeenCalledWith(T);
    expect(service.get).not.toHaveBeenCalled();
    await app.inject({ method: "POST", url: "/v1/orders", payload: { customer: { name: "Ravi" } } });
    expect(service.create).toHaveBeenCalledWith(T, { customer: { name: "Ravi" } }, "u1");
    await app.inject({ url: `/v1/orders/${id}` });
    expect(service.get).toHaveBeenCalledWith(T, id);
    await app.inject({ method: "POST", url: `/v1/orders/${id}/status`, payload: { status: "shipped" } });
    expect(service.updateStatus).toHaveBeenCalledWith(T, id, { status: "shipped" }, "u1");
    await app.inject({ method: "POST", url: `/v1/orders/${id}/notes`, payload: { message: "Call before delivery" } });
    expect(service.addNote).toHaveBeenCalledWith(T, id, { message: "Call before delivery" }, "u1");
    await app.inject({ method: "POST", url: `/v1/orders/${id}/payments`, payload: { amount: 100, method: "upi" } });
    expect(service.addPayment).toHaveBeenCalled();
    await app.inject({ method: "POST", url: `/v1/orders/${id}/refunds`, payload: { amount: 100 } });
    expect(service.addRefund).toHaveBeenCalled();
    await app.inject({ method: "POST", url: `/v1/orders/${id}/fulfillment`, payload: { carrier: "DTDC" } });
    expect(service.updateFulfillment).toHaveBeenCalled();
    await app.inject({ method: "POST", url: `/v1/orders/${id}/invoice` });
    expect(service.retryInvoice).toHaveBeenCalledWith(T, id, "u1");
    expect(new Set(features)).toEqual(new Set(["orders"]));
    expect((await app.inject({ url: "/v1/orders/not-an-id" })).statusCode).toBe(404);
  });

  it("returns CSV on request", async () => {
    const { app, service } = await build(ctx({ tenant, user: staffUser }));
    const res = await app.inject({ url: "/v1/orders?format=csv&from=2026-10-01&to=2026-10-31" });
    expect(res.headers["content-type"]).toBe("text/csv; charset=utf-8");
    expect(res.headers["content-disposition"]).toBe('attachment; filename="orders-2026-10-01-2026-10-31.csv"');
    expect(res.body).toContain("ORD/26-27/0001");
    expect(service.list).toHaveBeenCalledWith(T, { from: "2026-10-01", to: "2026-10-31", limit: 500, offset: 0 });
    expect((await app.inject({ url: "/v1/orders?format=xml" })).statusCode).toBe(400);
  });

  it("checks permissions once the staff module provides them", async () => {
    const delivery = { ...staffUser, permissions: ["orders.manage"] };
    const { app, service } = await build(ctx({ tenant, user: delivery }));
    expect((await app.inject({ method: "POST", url: `/v1/orders/${id}/status`, payload: { status: "delivered" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/v1/orders/${id}/status`, payload: { status: "cancelled" } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/v1/orders/${id}/refunds`, payload: { amount: 1 } })).statusCode).toBe(403);
    expect(service.addRefund).not.toHaveBeenCalled();
    const viewer = await build(ctx({ tenant, user: { ...staffUser, permissions: [] } }));
    expect((await viewer.app.inject({ url: "/v1/orders" })).statusCode).toBe(200);
    expect((await viewer.app.inject({ method: "POST", url: "/v1/orders", payload: {} })).statusCode).toBe(403);
    const owner = await build(ctx({ tenant, user: { ...staffUser, tenantRoles: ["owner"], permissions: ["*"] } }));
    expect((await owner.app.inject({ method: "POST", url: `/v1/orders/${id}/refunds`, payload: { amount: 1 } })).statusCode).toBe(200);
  });

  it("honours permission patterns and the Delivery role's ship/deliver keys", async () => {
    const manager = await build(ctx({ tenant, user: { ...staffUser, permissions: ["*.view", "orders.*"] } }));
    expect((await manager.app.inject({ method: "POST", url: `/v1/orders/${id}/refunds`, payload: { amount: 1 } })).statusCode).toBe(200);
    expect((await manager.app.inject({ method: "POST", url: `/v1/orders/${id}/status`, payload: { status: "cancelled" } })).statusCode).toBe(200);

    const delivery = await build(ctx({ tenant, user: { ...staffUser, permissions: ["orders.view", "orders.ship", "orders.deliver"] } }));
    for (const status of ["shipped", "delivered"]) {
      expect((await delivery.app.inject({ method: "POST", url: `/v1/orders/${id}/status`, payload: { status } })).statusCode).toBe(200);
    }
    const denied = await delivery.app.inject({ method: "POST", url: `/v1/orders/${id}/status`, payload: { status: "confirmed" } });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error).toMatchObject({ code: "permission_denied", details: { permission: "orders.manage" } });
  });
});

describe("createOrders", () => {
  it("returns the module with tables, features and permissions", () => {
    const { module, service } = createOrders({
      db,
      catalog: { getVariants: async () => [] },
      seller: { get: async () => ({ stateCode: "33" }) },
      settings: { get: async () => ({}) },
    });
    expect(module.id).toBe("orders");
    expect(Object.keys(module.tables ?? {}).sort()).toEqual(["orderEvents", "orderSeries", "orders"]);
    expect(module.features?.map((f) => [f.key, f.shopToggle ?? false])).toEqual([
      ["orders", false],
      ["orders.returns", true],
    ]);
    expect(module.permissions.map((p) => p.key)).toEqual(["orders.manage", "orders.cancel", "orders.refund", "orders.ship", "orders.deliver"]);
    expect(typeof service.paymentTarget).toBe("function");
  });
});
