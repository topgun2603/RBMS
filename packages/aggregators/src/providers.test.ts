import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { signBody } from "./parse";
import { createManualProvider } from "./providers/manual";
import { urbanPiperProvider as up } from "./providers/urbanpiper";
import { PayloadError, type ProviderCredentials } from "./types";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");
const json = (name: string) => JSON.parse(fixture(name)) as unknown;
const creds: ProviderCredentials = { username: "biz_user", apiKey: "k3y", webhookSecret: "s3cret", storeRef: "annapoorna-main", baseUrl: null };

describe("UrbanPiper: order placed", () => {
  const ev = up.parseWebhook(json("urbanpiper-order-zomato.json"));
  if (ev.kind !== "order") throw new Error("expected order");
  const o = ev.order;

  it("reads platform, ids, type, masked customer and store", () => {
    expect(o).toMatchObject({ platform: "zomato", externalId: "812345601", platformOrderId: "5123412345", type: "delivery", storeRef: "annapoorna-main" });
    expect(o.customer).toEqual({ name: "Ravi K.", phone: "******3210" });
    expect(JSON.stringify(o)).not.toContain("Gandhi Road");
    expect(JSON.stringify(o)).not.toContain("9876543210");
  });

  it("reads items with options, left-outs and notes, in paise", () => {
    expect(o.items).toHaveLength(2);
    expect(o.items[0]).toMatchObject({
      externalId: "99001",
      merchantRef: "11111111-1111-4111-8111-aaaaaaaaaaaa",
      title: "Paneer Butter Masala",
      qty: 1,
      unitPrice: 27000,
      total: 27000,
      removed: ["Onion"],
      note: "Less spicy",
    });
    expect(o.items[0]!.options).toEqual([{ externalId: "opt-cheese", title: "Extra cheese", price: 3000, qty: 1 }]);
    expect(o.items[1]).toMatchObject({ externalId: "99002", merchantRef: "UP-GARLIC-NAAN", qty: 2, unitPrice: 9500, total: 19000 });
  });

  it("reads charges, discounts with who funds them, taxes and totals", () => {
    expect(o.charges).toEqual([{ title: "Packaging charge", amount: 3000 }]);
    expect(o.discounts).toEqual([
      { title: "WELCOME50", amount: 3000, fundedBy: "merchant" },
      { title: "Zomato Pro", amount: 2000, fundedBy: "platform" },
    ]);
    expect(o.taxes.map((t) => t.amount)).toEqual([1150, 1150]);
    expect(o.totals).toEqual({ items: 46000, charges: 3000, discount: 5000, tax: 2300, total: 46300 });
    expect(o.payment).toEqual({ mode: "prepaid", amount: 46300 });
  });

  it("reads times: placed, and pickup from the estimated prep time", () => {
    expect(o.placedAt).toBe(new Date(1792560000000).toISOString());
    expect(o.expectedPickupAt).toBe(new Date(1792560000000 + 18 * 60_000).toISOString());
    expect(o.instructions).toBe("Don't ring the bell");
  });

  it("is tolerant: numbers as strings, ISO times, pickup, cash on delivery, no taxes", () => {
    const e = up.parseWebhook(json("urbanpiper-order-swiggy-cod.json"));
    if (e.kind !== "order") throw new Error("expected order");
    expect(e.order).toMatchObject({ platform: "swiggy", externalId: "SW-778899", platformOrderId: "SWG-1001", type: "pickup" });
    expect(e.order.customer).toEqual({ name: "Meena", phone: "******8901" });
    expect(e.order.items.map((i) => [i.externalId, i.qty, i.unitPrice, i.total, i.merchantRef])).toEqual([
      ["771", 2, 4025, 8050, null],
      ["772", 1, 7000, 7000, null],
    ]);
    expect(e.order.totals).toEqual({ items: 15050, charges: 1000, discount: 0, tax: 0, total: 16050 });
    expect(e.order.payment.mode).toBe("cod");
    expect(e.order.placedAt).toBe("2026-10-21T07:35:00.000Z");
    expect(e.order.expectedPickupAt).toBe("2026-10-21T07:55:00.000Z");
  });

  it("rejects payloads it can't read", () => {
    expect(() => up.parseWebhook("nope")).toThrow(PayloadError);
    expect(() => up.parseWebhook({ hello: 1 })).toThrow(PayloadError);
    expect(() => up.parseWebhook({ order: { details: { id: 1 }, items: [] } })).toThrow(/without items/);
    expect(() => up.parseWebhook({ order: { details: {}, items: [{ id: 1 }] } })).toThrow(/without order.details.id/);
  });
});

describe("UrbanPiper: status and rider webhooks", () => {
  it("maps order status updates", () => {
    expect(up.parseWebhook(json("urbanpiper-status-cancelled.json"))).toEqual({ kind: "status", externalId: "812345601", status: "cancelled", message: "Customer cancelled the order" });
    expect(up.parseWebhook({ order_id: 5, new_state: "Completed" })).toMatchObject({ kind: "status", status: "completed" });
    expect(up.parseWebhook({ order_id: 5, new_state: "Something new" })).toMatchObject({ kind: "ignored" });
  });

  it("reads rider updates with a masked phone", () => {
    expect(up.parseWebhook(json("urbanpiper-rider.json"))).toEqual({
      kind: "rider",
      externalId: "812345601",
      rider: { name: "Arun", phone: "******2345", status: "out-for-delivery", updatedAt: null },
    });
  });
});

describe("UrbanPiper: webhook verification", () => {
  const raw = Buffer.from(fixture("urbanpiper-order-zomato.json"));
  const verify = (headers: Record<string, string>, c = creds) => up.verifyWebhook({ rawBody: raw, headers }, c);

  it("accepts the shared secret header (custom webhook header)", () => {
    expect(verify({ "x-webhook-secret": "s3cret" })).toBe(true);
    expect(verify({ authorization: "Bearer s3cret" })).toBe(true);
    expect(verify({ "x-webhook-secret": "wrong" })).toBe(false);
  });

  it("accepts an HMAC-SHA256 signature in hex or base64", () => {
    expect(verify({ "x-urbanpiper-signature": signBody(raw, "s3cret") })).toBe(true);
    expect(verify({ "x-signature": `sha256=${signBody(raw, "s3cret")}` })).toBe(true);
    expect(verify({ "x-urbanpiper-signature": createHmac("sha256", "s3cret").update(raw).digest("base64") })).toBe(true);
    expect(verify({ "x-urbanpiper-signature": signBody(Buffer.concat([raw, Buffer.from(" ")]), "s3cret") })).toBe(false);
  });

  it("never verifies without a configured secret or a header", () => {
    expect(verify({ "x-webhook-secret": "" }, { ...creds, webhookSecret: null })).toBe(false);
    expect(verify({})).toBe(false);
  });
});

describe("UrbanPiper: outgoing requests", () => {
  it("status callbacks: PUT with the UrbanPiper state names and apikey auth", () => {
    const r = up.statusRequest(creds, "812345601", { status: "accepted", prepMinutes: 20 })!;
    expect(r).toMatchObject({ method: "PUT", url: "https://api.urbanpiper.com/external/api/v1/orders/812345601/status/" });
    expect(r.headers.authorization).toBe("apikey biz_user:k3y");
    expect(r.body).toEqual({ new_status: "Acknowledged", message: "Accepted", extra: { prep_time: 20 } });
    expect((up.statusRequest(creds, "1", { status: "ready" })!.body as { new_status: string }).new_status).toBe("Food Ready");
    expect((up.statusRequest(creds, "1", { status: "dispatched" })!.body as { new_status: string }).new_status).toBe("Dispatched");
    expect(up.statusRequest(creds, "1", { status: "rejected", reason: "Out of paneer" })!.body).toEqual({ new_status: "Cancelled", message: "Out of paneer" });
    expect(up.statusRequest({ ...creds, baseUrl: "https://pos-int.urbanpiper.com/" }, "9", { status: "ready" })!.url).toBe("https://pos-int.urbanpiper.com/external/api/v1/orders/9/status/");
  });

  it("menu push: items with our refs, rupees, food type, no taxes", () => {
    const r = up.menuRequest(
      creds,
      {
        categories: [{ id: "cat-1", name: "Mains", sort: 1 }],
        items: [{ ref: "item-1", name: "Dosa", description: null, price: 12050, categoryId: "cat-1", veg: true, available: false, image: null }],
      },
      ["zomato", "swiggy"],
    )!;
    expect(r.url).toBe("https://api.urbanpiper.com/external/api/v1/inventory/locations/annapoorna-main/");
    const body = r.body as { items: Record<string, unknown>[]; taxes: unknown[]; flush_items: boolean };
    expect(body.flush_items).toBe(false);
    expect(body.taxes).toEqual([]);
    expect(body.items[0]).toMatchObject({ ref_id: "item-1", title: "Dosa", price: 120.5, available: false, food_type: "1", category_ref_ids: ["cat-1"], included_platforms: ["zomato", "swiggy"] });
    expect(up.menuRequest({ ...creds, storeRef: null }, { categories: [], items: [] }, [])).toBeNull();
  });

  it("stock: one enable and one disable call per 100 items; store on/off", () => {
    const reqs = up.stockRequests(creds, [{ ref: "a", available: true }, { ref: "b", available: false }, { ref: "c", available: false }], ["zomato"]);
    expect(reqs.map((r) => r.body)).toEqual([
      { location_ref_id: "annapoorna-main", platforms: ["zomato"], item_ref_ids: ["a"], action: "enable" },
      { location_ref_id: "annapoorna-main", platforms: ["zomato"], item_ref_ids: ["b", "c"], action: "disable" },
    ]);
    expect(up.storeRequest(creds, "swiggy", false)!.body).toEqual({ location_ref_id: "annapoorna-main", platforms: ["swiggy"], action: "disable" });
  });

  it("its sample webhook parses back through its own parser", () => {
    const now = new Date("2026-10-21T08:00:00Z");
    const ev = up.parseWebhook(up.sampleWebhook({ externalId: "t-1", platform: "swiggy", items: [{ ref: "r1", name: "Idli", price: 5000, qty: 2 }], now }));
    if (ev.kind !== "order") throw new Error("expected order");
    expect(ev.order).toMatchObject({ platform: "swiggy", externalId: "t-1", placedAt: now.toISOString() });
    expect(ev.order.items[0]).toMatchObject({ merchantRef: "r1", qty: 2, unitPrice: 5000, total: 10000 });
    expect(ev.order.totals.total).toBe(10000 + 2000 + 600);
  });
});

describe("manual provider", () => {
  const now = new Date("2026-10-21T08:00:00Z");
  const manual = createManualProvider(() => now);
  const body = {
    event: "order",
    order: {
      id: "M-1001",
      platform: "zomato",
      platformOrderId: "ZO-55",
      customer: { name: "Ravi Kumar", phone: "9876543210" },
      items: [{ id: "dosa", name: "Masala dosa", qty: 2, price: 12000, options: [{ name: "Extra ghee", price: 2000 }], note: "crispy" }],
      charges: [{ title: "Packaging", amount: 2000 }],
      tax: 1500,
      pickupInMinutes: 20,
    },
  };

  it("parses its own JSON (paise) with defaults", () => {
    const ev = manual.parseWebhook(body);
    if (ev.kind !== "order") throw new Error("expected order");
    expect(ev.order).toMatchObject({ platform: "zomato", externalId: "M-1001", type: "delivery", customer: { name: "Ravi K.", phone: "******3210" } });
    expect(ev.order.items[0]).toMatchObject({ unitPrice: 14000, total: 28000, note: "crispy" });
    expect(ev.order.totals).toEqual({ items: 28000, charges: 2000, discount: 0, tax: 1500, total: 31500 });
    expect(ev.order.expectedPickupAt).toBe(new Date(now.getTime() + 20 * 60_000).toISOString());
  });

  it("parses status and rider events, rejects bad bodies", () => {
    expect(manual.parseWebhook({ event: "status", id: "M-1", status: "cancelled" })).toEqual({ kind: "status", externalId: "M-1", status: "cancelled", message: null });
    expect(manual.parseWebhook({ event: "rider", id: "M-1", rider: { name: "Arun", phone: "9000000000" } })).toMatchObject({ kind: "rider", rider: { phone: "******0000" } });
    expect(() => manual.parseWebhook({ event: "order", order: { id: "x", items: [] } })).toThrow(PayloadError);
  });

  it("verifies with its secret header or HMAC, and never calls out", () => {
    const raw = Buffer.from(JSON.stringify(body));
    expect(manual.verifyWebhook({ rawBody: raw, headers: { "x-aggregator-secret": "s3cret" } }, creds)).toBe(true);
    expect(manual.verifyWebhook({ rawBody: raw, headers: { "x-aggregator-signature": signBody(raw, "s3cret") } }, creds)).toBe(true);
    expect(manual.verifyWebhook({ rawBody: raw, headers: { "x-aggregator-secret": "nope" } }, creds)).toBe(false);
    expect(manual.statusRequest(creds, "x", { status: "accepted" })).toBeNull();
    expect(manual.menuRequest(creds, { categories: [], items: [] }, [])).toBeNull();
    expect(manual.stockRequests(creds, [{ ref: "a", available: true }], [])).toEqual([]);
  });
});
