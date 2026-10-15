import { describe, expect, it, vi } from "vitest";
import type { FulfillmentOrder } from "../ports";
import {
  buildAdhocOrder,
  istDateTime,
  memoryTokenCache,
  parseShiprocketWebhook,
  parseTracking,
  ShiprocketClient,
  ShiprocketDriver,
  ShiprocketError,
  SHIPROCKET_TOKEN_TTL_MS,
  tenDigitPhone,
} from "./shiprocket";
import { CarrierError } from "./types";

const BASE = "https://apiv2.shiprocket.in/v1/external";
type Route = (init: RequestInit) => { status?: number; body: unknown };

/** Fetch mock routed by "METHOD path" (path relative to the API base). */
function routedFetch(routes: Record<string, Route | Route[]>) {
  const counters: Record<string, number> = {};
  return vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const key = `${init?.method ?? "GET"} ${String(url).replace(BASE, "")}`;
    const r = routes[key];
    if (!r) return new Response(JSON.stringify({ message: `no route ${key}` }), { status: 404 });
    const i = (counters[key] = (counters[key] ?? 0) + 1) - 1;
    const handler = Array.isArray(r) ? (r[Math.min(i, r.length - 1)] as Route) : r;
    const { status = 200, body } = handler(init ?? {});
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  });
}
const asFetch = (f: unknown) => f as typeof globalThis.fetch;
const login: Route = () => ({ body: { token: "tok-1", email: "api@shop.in" } });

const order = (over: Partial<FulfillmentOrder> = {}): FulfillmentOrder => ({
  id: "33333333-3333-4333-8333-333333333333",
  number: "ORD/26-27/0007",
  status: "packed",
  customer: { name: "Priya Raman", phone: "+919876543210", email: "priya@example.com" },
  shippingAddress: {
    name: "Priya Raman",
    phone: "+919876543210",
    line1: "12 Gandhi St",
    line2: "Flat 3",
    landmark: "Near temple",
    city: "Chennai",
    stateCode: "33",
    pincode: "600001",
    country: "IN",
  },
  lines: [
    { name: "Kurta", sku: "KUR-M", qty: 2, price: 79_900 },
    { name: "Dupatta", sku: null, qty: 1, price: 29_900 },
  ],
  total: 194_700,
  paymentMethod: "online",
  balance: 0,
  ...over,
});
const pkg = { lengthCm: 20, breadthCm: 15, heightCm: 5, weightGrams: 750 };
const NOW = new Date("2026-10-15T06:30:00Z");

describe("ShiprocketClient", () => {
  it("logs in once and reuses the token for ~9 days", async () => {
    const fetch = routedFetch({ "POST /auth/login": login, "GET /courier/track/awb/AWB1": () => ({ body: { tracking_data: {} } }) });
    let now = NOW;
    const cache = memoryTokenCache();
    const client = new ShiprocketClient({ email: "api@shop.in", password: "pw", fetch: asFetch(fetch), tokenCache: cache, now: () => now });
    await client.trackAwb("AWB1");
    await client.trackAwb("AWB1");
    const calls = fetch.mock.calls.map((c) => `${c[1]!.method} ${String(c[0]).replace(BASE, "")}`);
    expect(calls).toEqual(["POST /auth/login", "GET /courier/track/awb/AWB1", "GET /courier/track/awb/AWB1"]);
    expect(JSON.parse(fetch.mock.calls[0]![1]!.body as string)).toEqual({ email: "api@shop.in", password: "pw" });
    expect((fetch.mock.calls[1]![1]!.headers as Record<string, string>).authorization).toBe("Bearer tok-1");

    // a second client for the same login shares the cached token
    const other = new ShiprocketClient({ email: "API@shop.in", password: "pw", fetch: asFetch(fetch), tokenCache: cache, now: () => now });
    await other.trackAwb("AWB1");
    expect(fetch.mock.calls.filter((c) => String(c[0]).endsWith("/auth/login"))).toHaveLength(1);

    now = new Date(NOW.getTime() + SHIPROCKET_TOKEN_TTL_MS + 1);
    await client.trackAwb("AWB1");
    expect(fetch.mock.calls.filter((c) => String(c[0]).endsWith("/auth/login"))).toHaveLength(2);
  });

  it("re-logs in once when a cached token is rejected", async () => {
    const fetch = routedFetch({
      "POST /auth/login": [login, () => ({ body: { token: "tok-2" } })],
      "GET /courier/track/awb/A": [() => ({ body: {} }), () => ({ status: 401, body: { message: "Token expired" } }), () => ({ body: { ok: 1 } })],
    });
    const client = new ShiprocketClient({ email: "e@x.in", password: "p", fetch: asFetch(fetch) });
    await client.trackAwb("A");
    expect(await client.trackAwb("A")).toEqual({ ok: 1 });
    expect((fetch.mock.calls.at(-1)![1]!.headers as Record<string, string>).authorization).toBe("Bearer tok-2");
  });

  it("validates credentials", async () => {
    const ok = new ShiprocketClient({ email: "e@x.in", password: "p", fetch: asFetch(routedFetch({ "POST /auth/login": login })) });
    expect(await ok.validateCredentials()).toBe(true);
    const bad = routedFetch({ "POST /auth/login": () => ({ status: 400, body: { message: "Invalid email and password combination" } }) });
    expect(await new ShiprocketClient({ email: "e@x.in", password: "p", fetch: asFetch(bad) }).validateCredentials()).toBe(false);
    const down = routedFetch({ "POST /auth/login": () => ({ status: 503, body: {} }) });
    await expect(new ShiprocketClient({ email: "e@x.in", password: "p", fetch: asFetch(down) }).validateCredentials()).rejects.toBeInstanceOf(
      ShiprocketError,
    );
  });

  it("surfaces validation errors and network failures", async () => {
    const fetch = routedFetch({
      "POST /auth/login": login,
      "POST /orders/create/adhoc": () => ({ status: 422, body: { message: "Oops! Invalid Data.", errors: { billing_pincode: ["Pincode is invalid"] } } }),
    });
    const err = await new ShiprocketClient({ email: "e@x.in", password: "p", fetch: asFetch(fetch) })
      .createAdhocOrder(buildAdhocOrder(order(), pkg, "Primary", NOW))
      .catch((e) => e);
    expect(err).toBeInstanceOf(ShiprocketError);
    expect(err.status).toBe(422);
    expect(err.message).toBe("Oops! Invalid Data.; Pincode is invalid");

    const net = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });
    const e2 = await new ShiprocketClient({ email: "e@x.in", password: "p", fetch: asFetch(net) }).login().catch((e) => e);
    expect(e2).toBeInstanceOf(ShiprocketError);
    expect(e2.status).toBe(0);
  });
});

describe("buildAdhocOrder", () => {
  it("maps a prepaid order (rupees, kg, IST date, 10-digit phone)", () => {
    const body = buildAdhocOrder(order(), pkg, "Warehouse 1", NOW);
    expect(body).toMatchObject({
      order_id: "ORD/26-27/0007",
      order_date: "2026-10-15 12:00",
      pickup_location: "Warehouse 1",
      billing_customer_name: "Priya",
      billing_last_name: "Raman",
      billing_address: "12 Gandhi St",
      billing_address_2: "Flat 3, Near temple",
      billing_city: "Chennai",
      billing_pincode: "600001",
      billing_state: "Tamil Nadu",
      billing_country: "India",
      billing_phone: "9876543210",
      shipping_is_billing: true,
      payment_method: "Prepaid",
      sub_total: 1897,
      shipping_charges: 50,
      total_discount: 0,
      weight: 0.75,
      length: 20,
    });
    expect(body.order_items).toEqual([
      { name: "Kurta", sku: "KUR-M", units: 2, selling_price: 799 },
      { name: "Dupatta", sku: "ITEM-2", units: 1, selling_price: 299 },
    ]);
  });

  it("collects the balance for COD orders", () => {
    const body = buildAdhocOrder(order({ paymentMethod: "cod", total: 189_700, balance: 150_000 }), pkg, "P", NOW);
    expect(body.payment_method).toBe("COD");
    expect(body.sub_total).toBe(1897);
    expect(body.total_discount).toBe(397);
    expect(body.shipping_charges).toBe(0);
  });

  it("needs an address and a phone", () => {
    expect(() => buildAdhocOrder(order({ shippingAddress: null }), pkg, "P", NOW)).toThrow(CarrierError);
    const noPhone = order({ customer: { name: "A", phone: null, email: null } });
    noPhone.shippingAddress!.phone = "123";
    expect(() => buildAdhocOrder(noPhone, pkg, "P", NOW)).toThrow(/phone/);
  });

  it("helpers", () => {
    expect(tenDigitPhone("+91 98765-43210")).toBe("9876543210");
    expect(tenDigitPhone("09876543210")).toBe("9876543210");
    expect(istDateTime(new Date("2026-03-31T20:00:00Z"))).toBe("2026-04-01 01:30");
  });
});

describe("tracking + webhook parsing", () => {
  const tracking = {
    tracking_data: {
      track_status: 1,
      shipment_status: 18,
      shipment_track: [{ awb_code: "AWB9", courier_name: "Delhivery Surface", current_status: "IN TRANSIT" }],
      shipment_track_activities: [
        { date: "2026-10-14 18:20:00", status: "X-PPOM", activity: "Picked up", location: "Chennai", "sr-status": "42", "sr-status-label": "PICKED UP" },
        { date: "2026-10-15 09:00:00", status: "X-DLL2F", activity: "Reached hub", location: "Bengaluru", "sr-status": "38", "sr-status-label": "REACHED AT DESTINATION HUB" },
      ],
      track_url: "https://shiprocket.co/tracking/AWB9",
    },
  };

  it("parses GET /courier/track/awb", () => {
    const r = parseTracking(tracking, "AWB9", NOW);
    expect(r.status).toBe("in_transit");
    expect(r.courier).toBe("Delhivery Surface");
    expect(r.trackingUrl).toBe("https://shiprocket.co/tracking/AWB9");
    expect(r.events).toEqual([
      { at: "2026-10-14T12:50:00.000Z", status: "in_transit", label: "Picked up", location: "Chennai", source: "track" },
      { at: "2026-10-15T03:30:00.000Z", status: "in_transit", label: "Reached hub", location: "Bengaluru", source: "track" },
    ]);
  });

  it("accepts the per-AWB wrapped form and empty answers", () => {
    expect(parseTracking({ AWB9: tracking }, "AWB9", NOW).status).toBe("in_transit");
    expect(parseTracking({ tracking_data: { track_status: 0, error: "Aahh! There is no activities found" } }, "X", NOW)).toEqual({
      status: null,
      events: [],
      courier: null,
      trackingUrl: null,
    });
    expect(parseTracking(null, "X", NOW)).toEqual({ status: null, events: [] });
  });

  it("parses the webhook body", () => {
    const w = parseShiprocketWebhook(
      {
        awb: 59948250030,
        courier_name: "Delhivery Surface",
        current_status: "OUT FOR DELIVERY",
        current_status_id: 17,
        shipment_status: "OUT FOR DELIVERY",
        current_timestamp: "15 10 2026 08:15:00",
        order_id: "ORD/26-27/0007",
        scans: [{ date: "2026-10-15 08:15:00", activity: "Out for delivery", location: "Bengaluru", "sr-status": "17", "sr-status-label": "OUT FOR DELIVERY" }],
      },
      NOW,
    )!;
    expect(w.awb).toBe("59948250030");
    expect(w.status).toBe("out_for_delivery");
    expect(w.at).toBe("2026-10-15T02:45:00.000Z");
    expect(w.events.map((e) => e.label)).toEqual(["Out for delivery"]);
    const bare = parseShiprocketWebhook({ awb: "A1", current_status: "DELIVERED", current_timestamp: "15 10 2026 10:00:00" }, NOW)!;
    expect(bare.events).toEqual([{ at: "2026-10-15T04:30:00.000Z", status: "delivered", label: "DELIVERED", location: null, source: "webhook" }]);
    expect(parseShiprocketWebhook({}, NOW)).toBeNull();
    expect(parseShiprocketWebhook("x", NOW)).toBeNull();
  });
});

describe("ShiprocketDriver", () => {
  const created = () => ({ body: { order_id: 111, shipment_id: 222, status: "NEW", status_code: 1 } });
  const awb = () => ({ body: { awb_assign_status: 1, response: { data: { awb_code: "AWB9", courier_name: "Delhivery", freight_charges: 62.5 } } } });
  const label = () => ({ body: { label_created: 1, label_url: "https://s3/label.pdf" } });

  it("creates order → assigns AWB → generates label", async () => {
    const fetch = routedFetch({ "POST /auth/login": login, "POST /orders/create/adhoc": created, "POST /courier/assign/awb": awb, "POST /courier/generate/label": label });
    const driver = new ShiprocketDriver(new ShiprocketClient({ email: "e@x.in", password: "p", fetch: asFetch(fetch) }), "Primary");
    const s = await driver.createShipment({ order: order(), package: pkg, courier: "12", now: NOW });
    expect(s).toMatchObject({
      providerOrderId: "111",
      providerShipmentId: "222",
      awb: "AWB9",
      courier: "Delhivery",
      trackingUrl: "https://shiprocket.co/tracking/AWB9",
      labelUrl: "https://s3/label.pdf",
      status: "created",
      cost: 6250,
    });
    const assign = fetch.mock.calls.find((c) => String(c[0]).endsWith("/courier/assign/awb"))!;
    expect(JSON.parse(assign[1]!.body as string)).toEqual({ shipment_id: "222", courier_id: 12 });
    const lbl = fetch.mock.calls.find((c) => String(c[0]).endsWith("/courier/generate/label"))!;
    expect(JSON.parse(lbl[1]!.body as string)).toEqual({ shipment_id: ["222"] });
  });

  it("skips assignment when Shiprocket already assigned an AWB, and survives a label failure", async () => {
    const fetch = routedFetch({
      "POST /auth/login": login,
      "POST /orders/create/adhoc": () => ({ body: { order_id: 1, shipment_id: 2, awb_code: "AUTO1", courier_name: "Xpress" } }),
      "POST /courier/generate/label": () => ({ status: 500, body: { message: "busy" } }),
    });
    const warn = vi.fn();
    const driver = new ShiprocketDriver(new ShiprocketClient({ email: "e@x.in", password: "p", fetch: asFetch(fetch) }), "Primary", { warn });
    const s = await driver.createShipment({ order: order(), package: pkg, now: NOW });
    expect(s.awb).toBe("AUTO1");
    expect(s.labelUrl).toBeNull();
    expect(warn).toHaveBeenCalled();
    expect(fetch.mock.calls.some((c) => String(c[0]).endsWith("/courier/assign/awb"))).toBe(false);
  });

  it("cancels the Shiprocket order when no AWB can be assigned", async () => {
    const fetch = routedFetch({
      "POST /auth/login": login,
      "POST /orders/create/adhoc": created,
      "POST /courier/assign/awb": () => ({ body: { awb_assign_status: 0, response: { data: { awb_assign_error: "No courier serviceable" } } } }),
      "POST /orders/cancel": () => ({ body: { status: 200 } }),
    });
    const driver = new ShiprocketDriver(new ShiprocketClient({ email: "e@x.in", password: "p", fetch: asFetch(fetch) }), "Primary");
    const err = await driver.createShipment({ order: order(), package: pkg, now: NOW }).catch((e) => e);
    expect(err).toBeInstanceOf(CarrierError);
    expect(err.message).toContain("No courier serviceable");
    const cancel = fetch.mock.calls.find((c) => String(c[0]).endsWith("/orders/cancel"))!;
    expect(JSON.parse(cancel[1]!.body as string)).toEqual({ ids: [111] });
  });

  it("tracks, cancels and fetches labels", async () => {
    const fetch = routedFetch({
      "POST /auth/login": login,
      "GET /courier/track/awb/AWB9": () => ({ body: { tracking_data: { shipment_status: 7, shipment_track: [{ current_status: "Delivered" }] } } }),
      "POST /orders/cancel": () => ({ body: {} }),
      "POST /courier/generate/label": label,
    });
    const driver = new ShiprocketDriver(new ShiprocketClient({ email: "e@x.in", password: "p", fetch: asFetch(fetch) }), "Primary");
    const ref = { providerOrderId: "111", providerShipmentId: "222", awb: "AWB9", status: "in_transit" as const };
    expect((await driver.track(ref, NOW)).status).toBe("delivered");
    await driver.cancel(ref);
    expect(await driver.label(ref)).toBe("https://s3/label.pdf");
    await expect(driver.cancel({ ...ref, providerOrderId: null })).rejects.toBeInstanceOf(CarrierError);
    expect(await driver.track({ ...ref, awb: null }, NOW)).toEqual({ status: null, events: [] });
  });

  it("maps Shiprocket failures to CarrierError with the status", async () => {
    const fetch = routedFetch({ "POST /auth/login": login, "POST /orders/create/adhoc": () => ({ status: 422, body: { message: "Wrong pickup location" } }) });
    const driver = new ShiprocketDriver(new ShiprocketClient({ email: "e@x.in", password: "p", fetch: asFetch(fetch) }), "Nope");
    const err = await driver.createShipment({ order: order(), package: pkg, now: NOW }).catch((e) => e);
    expect(err).toBeInstanceOf(CarrierError);
    expect(err.status).toBe(422);
    expect(err.message).toBe("Wrong pickup location");
  });
});
