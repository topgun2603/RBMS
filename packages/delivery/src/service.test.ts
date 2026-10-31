import { AppError } from "@rbms/core";
import type { Db } from "@rbms/db";
import { describe, expect, it, vi } from "vitest";
import type { CarrierDriver } from "./carriers/types";
import { createSecretBox } from "./crypto";
import type { PincodeDriver } from "./pincode";
import type { FulfillmentOrder, OrderFulfillmentPort } from "./ports";
import type { DeliveryAccountRow, DeliveryRateRow, DeliveryZoneRow, ShipmentRow } from "./schema";
import { DeliveryService, type DeliveryConfig, type DeliveryDeps } from "./service";

/**
 * Chainable fake for drizzle: every builder method returns the chain, and awaiting it resolves to the next queued
 * result. `ops` records each awaited query's builder calls (method + args) for assertions.
 */
function fakeDb(results: unknown[][]) {
  const ops: { m: string; args: unknown[] }[][] = [];
  let current: { m: string; args: unknown[] }[] = [];
  const settle = () => {
    ops.push(current);
    current = [];
    return Promise.resolve(results.shift() ?? []);
  };
  const chain: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") return (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => settle().then(res, rej);
        if (prop === "catch") return (rej: (e: unknown) => unknown) => settle().catch(rej);
        return (...args: unknown[]) => {
          current.push({ m: String(prop), args });
          return chain;
        };
      },
    },
  );
  const valuesOf = (i: number, method = "values") => ops[i]?.find((o) => o.m === method)?.args[0] as Record<string, unknown>;
  return { db: chain as Db, ops, results, valuesOf };
}

const TENANT = "11111111-1111-4111-8111-111111111111";
const ORDER_ID = "33333333-3333-4333-8333-333333333333";
const SHIP_ID = "44444444-4444-4444-8444-444444444444";
const ENC = "test-key";
const box = createSecretBox(ENC);
const config: DeliveryConfig = { encryptionKey: ENC, allowMock: true, webhookBaseUrl: "https://api.test/" };
const NOW = new Date("2026-10-15T06:30:00Z");

const zone = (over: Partial<DeliveryZoneRow> = {}): DeliveryZoneRow => ({
  id: "z-tn",
  tenantId: TENANT,
  name: "Tamil Nadu",
  states: ["33"],
  pincodePrefixes: [],
  pincodes: [],
  active: true,
  sort: 0,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

const rate = (over: Partial<DeliveryRateRow> = {}): DeliveryRateRow => ({
  id: "r-std",
  tenantId: TENANT,
  zoneId: "z-tn",
  name: "Standard",
  type: "free_above",
  amount: 4000,
  freeAbove: 99_900,
  weightSlabs: [],
  etaMinDays: 1,
  etaMaxDays: 3,
  codAllowed: true,
  codFee: 2500,
  active: true,
  sort: 0,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

const account = (over: Partial<DeliveryAccountRow> = {}, creds = { email: "api@shop.in", password: "pw", webhookToken: "hook-token-1234567890" }): DeliveryAccountRow => ({
  tenantId: TENANT,
  provider: "shiprocket",
  credentialsEnc: box.encrypt(JSON.stringify(creds)),
  pickupLocation: "Primary",
  enabled: true,
  defaultPackage: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

const shipment = (over: Partial<ShipmentRow> = {}): ShipmentRow => ({
  id: SHIP_ID,
  tenantId: TENANT,
  orderId: ORDER_ID,
  provider: "shiprocket",
  providerOrderId: "111",
  providerShipmentId: "222",
  awb: "AWB9",
  courier: "Delhivery",
  status: "created",
  labelUrl: null,
  trackingUrl: "https://shiprocket.co/tracking/AWB9",
  events: [],
  cost: null,
  trackedAt: null,
  createdAt: NOW,
  updatedAt: NOW,
  ...over,
});

const order = (over: Partial<FulfillmentOrder> = {}): FulfillmentOrder => ({
  id: ORDER_ID,
  number: "ORD/26-27/0007",
  status: "packed",
  customer: { name: "Priya", phone: "+919876543210", email: null },
  shippingAddress: { line1: "12 Gandhi St", city: "Chennai", stateCode: "33", pincode: "600001", phone: "+919876543210" },
  lines: [{ name: "Kurta", sku: "K", qty: 1, price: 79_900 }],
  total: 79_900,
  paymentMethod: "online",
  balance: 0,
  ...over,
});

function ordersPort(o: FulfillmentOrder | null = order()) {
  return {
    getOrder: vi.fn(async () => o),
    setFulfillment: vi.fn(async () => undefined),
    markShipped: vi.fn(async () => undefined),
    markDelivered: vi.fn(async () => undefined),
  } satisfies OrderFulfillmentPort;
}

function make(results: unknown[][], over: Partial<DeliveryDeps> = {}) {
  const fake = fakeDb(results);
  const orders = (over.orders as ReturnType<typeof ordersPort>) ?? ordersPort();
  const service = new DeliveryService({ db: fake.db, config, orders, now: () => NOW, ...over });
  return { service, orders, ...fake };
}

const appError = async (p: Promise<unknown>) => {
  const err = await p.catch((e) => e);
  expect(err).toBeInstanceOf(AppError);
  return err as AppError;
};

describe("quote", () => {
  it("gives the implicit All India ₹0 rate when the shop has no zones", async () => {
    const { service, ops } = make([[]]);
    const q = await service.quote(TENANT, { pincode: "560001", weightGrams: 500, subtotal: 10_000, cod: true });
    expect(q.serviceable).toBe(true);
    expect(q.options).toEqual([{ id: "default", name: "Standard delivery", amount: 0, etaDays: [2, 7], codAllowed: true, codFee: 0 }]);
    expect(ops).toHaveLength(1);
  });

  it("derives the state from the pincode when zones need it (cache miss → prefix table)", async () => {
    const { service, ops } = make([[zone()], [], [rate()]]);
    const q = await service.quote(TENANT, { pincode: "641001", weightGrams: 0, subtotal: 50_000, cod: false });
    expect(q.zone).toEqual({ id: "z-tn", name: "Tamil Nadu" });
    expect(q.options).toEqual([{ id: "r-std", name: "Standard", amount: 4000, etaDays: [1, 3], codAllowed: true, codFee: 2500 }]);
    expect(ops).toHaveLength(3);
  });

  it("uses a given state code and applies free_above", async () => {
    const { service, ops } = make([[zone()], [rate()]]);
    const q = await service.quote(TENANT, { pincode: "560001", stateCode: "33", weightGrams: 0, subtotal: 99_900, cod: false });
    expect(q.options[0]!.amount).toBe(0);
    expect(ops).toHaveLength(2); // no cache lookup
  });

  it("is not serviceable for a bad pincode or no matching zone", async () => {
    const { service, ops } = make([]);
    expect(await service.quote(TENANT, { pincode: "012345", weightGrams: 0, subtotal: 0, cod: false })).toEqual({
      serviceable: false,
      options: [],
      zone: null,
    });
    expect(ops).toHaveLength(0);
    const { service: s2 } = make([[zone()], []]);
    expect((await s2.quote(TENANT, { pincode: "560001", weightGrams: 0, subtotal: 0, cod: false })).serviceable).toBe(false);
  });
});

describe("pincode lookup", () => {
  const driver = (impl: PincodeDriver["lookup"]) => ({ lookup: vi.fn(impl) });
  const info = { pincode: "600001", city: "Chennai", district: "Chennai", state: "Tamil Nadu", stateCode: "33", approximate: false };

  it("serves a fresh cache entry without calling the API", async () => {
    const d = driver(async () => info);
    const cached = { pincode: "600001", found: true, city: "Chennai", district: "Chennai", state: "Tamil Nadu", stateCode: "33", fetchedAt: new Date(NOW.getTime() - 86_400_000) };
    const { service } = make([[cached]], { pincodeDriver: d });
    expect(await service.lookupPincode("600001")).toEqual(info);
    expect(d.lookup).not.toHaveBeenCalled();
  });

  it("fetches and caches when missing or stale (30 days)", async () => {
    const d = driver(async () => info);
    const stale = { ...info, found: true, fetchedAt: new Date(NOW.getTime() - 31 * 86_400_000) };
    const { service, ops, valuesOf } = make([[stale], []], { pincodeDriver: d });
    expect(await service.lookupPincode(" 600 001 ")).toEqual(info);
    expect(d.lookup).toHaveBeenCalledWith("600001");
    expect(ops[1]!.map((o) => o.m)).toContain("onConflictDoUpdate");
    expect(valuesOf(1)).toMatchObject({ pincode: "600001", found: true, stateCode: "33", fetchedAt: NOW });
  });

  it("404 for unknown pincodes (and caches the miss)", async () => {
    const { service, valuesOf } = make([[], []], { pincodeDriver: driver(async () => null) });
    expect((await appError(service.lookupPincode("999999"))).status).toBe(404);
    expect(valuesOf(1)).toMatchObject({ found: false });
    const recentMiss = { pincode: "999999", found: false, city: "", district: "", state: "", stateCode: null, fetchedAt: NOW };
    const { service: s2 } = make([[recentMiss]], { pincodeDriver: driver(async () => info) });
    expect((await appError(s2.lookupPincode("999999"))).status).toBe(404);
  });

  it("falls back to the prefix table when the API is down", async () => {
    const { service } = make([[]], {
      pincodeDriver: driver(async () => {
        throw new Error("timeout");
      }),
    });
    expect(await service.lookupPincode("682001")).toEqual({ pincode: "682001", city: "", district: "", state: "Kerala", stateCode: "32", approximate: true });
  });

  it("400 for malformed input", async () => {
    const { service } = make([]);
    expect((await appError(service.lookupPincode("12345"))).status).toBe(400);
  });
});

describe("carrier account", () => {
  const loginFetch = (ok = true) =>
    vi.fn(async () => new Response(JSON.stringify(ok ? { token: "t" } : { message: "Invalid" }), { status: ok ? 200 : 400 }));

  it("validates the login, encrypts credentials, returns the generated webhook token once", async () => {
    const fetch = loginFetch();
    const { service, valuesOf } = make([[], [account()]], { fetch: fetch as unknown as typeof globalThis.fetch });
    const view = await service.putAccount(TENANT, { email: "api@shop.in", password: "secret-pw", enabled: true, pickupLocation: "Home" });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(String((fetch.mock.calls[0] as unknown[])[0])).toBe("https://apiv2.shiprocket.in/v1/external/auth/login");
    const stored = valuesOf(1) as { credentialsEnc: string; pickupLocation: string };
    expect(stored.credentialsEnc).not.toContain("secret-pw");
    const creds = JSON.parse(box.decrypt(stored.credentialsEnc));
    expect(creds).toMatchObject({ email: "api@shop.in", password: "secret-pw" });
    expect(view.newWebhookToken).toBe(creds.webhookToken);
    expect(view.webhookUrl).toBe(`https://api.test/v1/delivery/webhooks/courier/${TENANT}`);
    expect(view.webhookHeader).toBe("x-api-key");
    expect(JSON.stringify(view)).not.toContain("secret-pw");
  });

  it("rejects bad logins and a new email without password", async () => {
    const { service } = make([[]], { fetch: loginFetch(false) as unknown as typeof globalThis.fetch });
    expect((await appError(service.putAccount(TENANT, { email: "api@shop.in", password: "x", enabled: true }))).code).toBe("invalid_credentials");
    const { service: s2 } = make([[account()]]);
    expect((await appError(s2.putAccount(TENANT, { email: "other@shop.in", enabled: true }))).status).toBe(400);
  });

  it("keeps the stored password and token when only settings change (no login call)", async () => {
    const fetch = loginFetch();
    const { service, valuesOf } = make([[account()], [account({ enabled: false })]], { fetch: fetch as unknown as typeof globalThis.fetch });
    const view = await service.putAccount(TENANT, { email: "api@shop.in", enabled: false });
    expect(fetch).not.toHaveBeenCalled();
    expect(view.newWebhookToken).toBeUndefined();
    expect(JSON.parse(box.decrypt((valuesOf(1) as { credentialsEnc: string }).credentialsEnc))).toEqual({
      email: "api@shop.in",
      password: "pw",
      webhookToken: "hook-token-1234567890",
    });
  });

  it("GET never returns secrets", async () => {
    const { service } = make([[account()]]);
    const view = await service.getAccount(TENANT);
    expect(view).toMatchObject({ configured: true, email: "ap***@shop.in", enabled: true, webhookTokenSet: true });
    const json = JSON.stringify(view);
    expect(json).not.toContain("pw\"");
    expect(json).not.toContain("hook-token");
    expect(json).not.toContain("credentials");
  });
});

describe("shipments", () => {
  it("creates a mock shipment and records fulfillment (not yet shipped)", async () => {
    const { service, orders, valuesOf } = make([[], [shipment({ provider: "mock", awb: "MOCK1", courier: "Mock Express", status: "created", trackingUrl: null })]]);
    const view = await service.createShipment(TENANT, ORDER_ID, { provider: "mock" });
    expect(view.status).toBe("created");
    expect(valuesOf(1)).toMatchObject({ tenantId: TENANT, orderId: ORDER_ID, provider: "mock", status: "created", courier: "Mock Express" });
    expect((valuesOf(1) as { awb: string }).awb).toMatch(/^MOCK\d{10}$/);
    expect(orders.setFulfillment).toHaveBeenCalledWith(TENANT, ORDER_ID, { carrier: "Mock Express", trackingNumber: "MOCK1", trackingUrl: null, shipmentId: SHIP_ID });
    expect(orders.markShipped).not.toHaveBeenCalled();
  });

  it("manual shipments count as shipped right away", async () => {
    const { service, orders } = make([[], [shipment({ provider: "manual", status: "in_transit", awb: "EE123", courier: "India Post" })]]);
    await service.createShipment(TENANT, ORDER_ID, { provider: "manual", courier: "India Post", awb: "EE123" });
    expect(orders.markShipped).toHaveBeenCalledWith(TENANT, ORDER_ID);
    expect((await appError(make([[]]).service.createShipment(TENANT, ORDER_ID, { provider: "manual" }))).code).toBe("carrier_rejected");
  });

  it("refuses cancelled orders, a second open shipment, and mock outside development", async () => {
    const cancelled = make([], { orders: ordersPort(order({ status: "cancelled" })) });
    expect((await appError(cancelled.service.createShipment(TENANT, ORDER_ID, { provider: "mock" }))).status).toBe(409);
    const dup = make([[{ id: "x" }]]);
    expect((await appError(dup.service.createShipment(TENANT, ORDER_ID, { provider: "mock" }))).status).toBe(409);
    const missing = make([], { orders: ordersPort(null) });
    expect((await appError(missing.service.createShipment(TENANT, ORDER_ID, { provider: "mock" }))).status).toBe(404);
    const prod = make([], { config: { ...config, allowMock: false } });
    expect((await appError(prod.service.createShipment(TENANT, ORDER_ID, { provider: "mock" }))).status).toBe(400);
  });

  it("shiprocket needs delivery.carriers and an enabled account", async () => {
    const off = make([], { featureGate: { isEnabled: async () => false } });
    const e1 = await appError(off.service.createShipment(TENANT, ORDER_ID, { provider: "shiprocket" }));
    expect(e1.code).toBe("feature_disabled");
    const noAccount = make([[]]);
    expect((await appError(noAccount.service.createShipment(TENANT, ORDER_ID, { provider: "shiprocket" }))).status).toBe(400);
  });

  it("shiprocket: uses the driver with the account's default package", async () => {
    const createShipment = vi.fn(async () => ({
      providerOrderId: "111",
      providerShipmentId: "222",
      awb: "AWB9",
      courier: "Delhivery",
      trackingUrl: "https://shiprocket.co/tracking/AWB9",
      labelUrl: "https://s3/l.pdf",
      status: "created" as const,
      cost: 6000,
      events: [],
    }));
    const driver = { provider: "shiprocket", createShipment } as unknown as CarrierDriver;
    const pkg = { lengthCm: 30, breadthCm: 20, heightCm: 10, weightGrams: 1200 };
    const { service } = make([[account({ defaultPackage: pkg })], [], [shipment()]], { drivers: { shiprocket: driver } });
    await service.createShipment(TENANT, ORDER_ID, { provider: "shiprocket" });
    expect(createShipment).toHaveBeenCalledWith(expect.objectContaining({ package: pkg, now: NOW }));
  });

  it("maps carrier failures to 502 / 400", async () => {
    const { CarrierError } = await import("./carriers/types");
    const failing = (status: number) =>
      ({ provider: "shiprocket", createShipment: async () => Promise.reject(new CarrierError("shiprocket", status, "boom")) }) as unknown as CarrierDriver;
    const a = make([[account()], []], { drivers: { shiprocket: failing(500) } });
    expect((await appError(a.service.createShipment(TENANT, ORDER_ID, { provider: "shiprocket" }))).status).toBe(502);
    const b = make([[account()], []], { drivers: { shiprocket: failing(401) } });
    expect((await appError(b.service.createShipment(TENANT, ORDER_ID, { provider: "shiprocket" }))).code).toBe("carrier_auth");
  });

  it("mock-advance steps statuses and tells orders on shipped / delivered", async () => {
    const m = make([[shipment({ provider: "mock", status: "pickup_scheduled" })], [shipment({ provider: "mock", status: "in_transit" })]]);
    const v = await m.service.mockAdvance(TENANT, SHIP_ID);
    expect(v.status).toBe("in_transit");
    expect(m.valuesOf(1, "set")).toMatchObject({ status: "in_transit" });
    expect(m.orders.markShipped).toHaveBeenCalledTimes(1);
    expect(m.orders.markDelivered).not.toHaveBeenCalled();

    const d = make([[shipment({ provider: "mock", status: "out_for_delivery" })], [shipment({ provider: "mock", status: "delivered" })]]);
    await d.service.mockAdvance(TENANT, SHIP_ID);
    expect(d.orders.markShipped).not.toHaveBeenCalled(); // already shipped
    expect(d.orders.markDelivered).toHaveBeenCalledWith(TENANT, ORDER_ID);

    const done = make([[shipment({ provider: "mock", status: "delivered" })]]);
    expect((await appError(done.service.mockAdvance(TENANT, SHIP_ID))).status).toBe(409);
    const real = make([[shipment()]]);
    expect((await appError(real.service.mockAdvance(TENANT, SHIP_ID))).status).toBe(400);
  });

  it("an orders port failure never fails the shipment update", async () => {
    const orders = ordersPort();
    orders.markDelivered.mockRejectedValueOnce(new Error("409 transition"));
    const warn = vi.fn();
    const m = make([[shipment({ provider: "mock", status: "out_for_delivery" })], [shipment({ provider: "mock", status: "delivered" })]], {
      orders,
      log: { info() {}, warn, error() {} },
    });
    expect((await m.service.mockAdvance(TENANT, SHIP_ID)).status).toBe("delivered");
    expect(warn).toHaveBeenCalled();
  });

  it("cancel: calls the carrier, marks cancelled, clears the order's tracking", async () => {
    const cancel = vi.fn(async () => undefined);
    const driver = { provider: "shiprocket", cancel } as unknown as CarrierDriver;
    const m = make([[shipment()], [account()], [shipment({ status: "cancelled" })]], { drivers: { shiprocket: driver } });
    const v = await m.service.cancelShipment(TENANT, SHIP_ID);
    expect(v.status).toBe("cancelled");
    expect(cancel).toHaveBeenCalledWith({ providerOrderId: "111", providerShipmentId: "222", awb: "AWB9", status: "created" });
    expect(m.orders.setFulfillment).toHaveBeenCalledWith(TENANT, ORDER_ID, { carrier: null, trackingNumber: null, trackingUrl: null, shipmentId: null });
    const done = make([[shipment({ status: "delivered" })]]);
    expect((await appError(done.service.cancelShipment(TENANT, SHIP_ID))).status).toBe(409);
  });

  it("label: stored URL, else generated by Shiprocket and saved", async () => {
    const stored = make([[shipment({ labelUrl: "https://s3/a.pdf" })]]);
    expect(await stored.service.labelUrl(TENANT, SHIP_ID)).toBe("https://s3/a.pdf");
    const label = vi.fn(async () => "https://s3/b.pdf");
    const gen = make([[shipment()], [account()], []], { drivers: { shiprocket: { provider: "shiprocket", label } as unknown as CarrierDriver } });
    expect(await gen.service.labelUrl(TENANT, SHIP_ID)).toBe("https://s3/b.pdf");
    expect(gen.valuesOf(2, "set")).toEqual({ labelUrl: "https://s3/b.pdf" });
    const manual = make([[shipment({ provider: "manual" })]]);
    expect((await appError(manual.service.labelUrl(TENANT, SHIP_ID))).status).toBe(404);
  });
});

describe("shiprocket webhook", () => {
  const body = { awb: "AWB9", current_status: "PICKED UP", current_status_id: 42, current_timestamp: "15 10 2026 10:00:00", courier_name: "Delhivery" };

  it("401 without the right token", async () => {
    expect((await appError(make([[account()]]).service.handleShiprocketWebhook(TENANT, "wrong", body))).status).toBe(401);
    expect((await appError(make([[account()]]).service.handleShiprocketWebhook(TENANT, undefined, body))).status).toBe(401);
    expect((await appError(make([[]]).service.handleShiprocketWebhook(TENANT, "hook-token-1234567890", body))).status).toBe(401);
  });

  it("updates the shipment and marks the order shipped", async () => {
    const m = make([[account()], [shipment()], [shipment({ status: "in_transit" })]]);
    expect(await m.service.handleShiprocketWebhook(TENANT, "hook-token-1234567890", body)).toEqual({ ok: true, result: "processed" });
    expect(m.valuesOf(2, "set")).toMatchObject({
      status: "in_transit",
      events: [{ at: "2026-10-15T04:30:00.000Z", status: "in_transit", label: "PICKED UP", location: null, source: "webhook" }],
    });
    expect(m.orders.markShipped).toHaveBeenCalledWith(TENANT, ORDER_ID);
  });

  it("replays are duplicates and never move the status back", async () => {
    const event = { at: "2026-10-15T04:30:00.000Z", status: "in_transit" as const, label: "PICKED UP", location: null, source: "webhook" as const };
    const m = make([[account()], [shipment({ status: "out_for_delivery", events: [event] })]]);
    expect(await m.service.handleShiprocketWebhook(TENANT, "hook-token-1234567890", body)).toEqual({ ok: true, result: "duplicate" });
    expect(m.ops).toHaveLength(2); // no update
    expect(m.orders.markShipped).not.toHaveBeenCalled();
  });

  it("ignores unknown AWBs, test pings and shops with carriers off", async () => {
    expect((await make([[account()], []]).service.handleShiprocketWebhook(TENANT, "hook-token-1234567890", body)).result).toBe("ignored");
    expect((await make([[account()]]).service.handleShiprocketWebhook(TENANT, "hook-token-1234567890", {})).result).toBe("ignored");
    const off = make([[account()]], { featureGate: { isEnabled: async () => false } });
    expect((await off.service.handleShiprocketWebhook(TENANT, "hook-token-1234567890", body)).result).toBe("ignored");
  });
});

describe("trackOpenShipments", () => {
  it("polls open Shiprocket shipments per shop, skipping shops with carriers off", async () => {
    const OTHER = "22222222-2222-4222-8222-222222222222";
    const track = vi.fn(async () => ({ status: "delivered" as const, events: [] }));
    const driver = { provider: "shiprocket", track } as unknown as CarrierDriver;
    const featureGate = { isEnabled: vi.fn(async (t: string) => t === TENANT) };
    const m = make(
      [
        [shipment({ status: "in_transit" }), shipment({ id: "s2", tenantId: OTHER })],
        [account()],
        [shipment({ status: "delivered" })],
      ],
      { drivers: { shiprocket: driver }, featureGate },
    );
    expect(await m.service.trackOpenShipments()).toEqual({ checked: 1, updated: 1, failed: 0, skipped: 1 });
    expect(track).toHaveBeenCalledTimes(1);
    expect(m.valuesOf(2, "set")).toMatchObject({ status: "delivered", trackedAt: NOW });
    expect(m.orders.markShipped).not.toHaveBeenCalled(); // in_transit → delivered: already counted as shipped
    expect(m.orders.markDelivered).toHaveBeenCalledWith(TENANT, ORDER_ID);
  });

  it("counts failures and still stamps trackedAt", async () => {
    const driver = { provider: "shiprocket", track: async () => Promise.reject(new Error("down")) } as unknown as CarrierDriver;
    const m = make([[shipment()], [account()], []], { drivers: { shiprocket: driver } });
    expect(await m.service.trackOpenShipments()).toEqual({ checked: 1, updated: 0, failed: 1, skipped: 0 });
    expect(m.valuesOf(2, "set")).toEqual({ trackedAt: NOW });
  });

  it("skips shops without an enabled account", async () => {
    const m = make([[shipment()], [account({ enabled: false })]]);
    expect(await m.service.trackOpenShipments()).toEqual({ checked: 0, updated: 0, failed: 0, skipped: 1 });
  });
});
