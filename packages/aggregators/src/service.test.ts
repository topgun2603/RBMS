import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AppError } from "@srirealtime/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signBody } from "./parse";
import type { HttpPort, KitchenOrderInput, KitchenPort, MenuItemInfo, MenuPort } from "./ports";
import { AggregatorsService } from "./service";
import { memoryStore } from "./testing";

const TENANT = "aaaaaaaa-0000-4000-8000-000000000001";
const PANEER = "11111111-1111-4111-8111-aaaaaaaaaaaa";
const NAAN = "22222222-2222-4222-8222-bbbbbbbbbbbb";
const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");

function fakeKitchen() {
  const orders = new Map<string, { input: KitchenOrderInput; status: "open" | "billed" | "cancelled"; sent: boolean; due: Date | null; kots: { id: string; status: string }[]; cancelReason?: string }>();
  let n = 0;
  const port: KitchenPort = {
    open: vi.fn(async (_t, input) => {
      const existing = [...orders.entries()].find(([, o]) => o.input.ref === input.ref);
      if (existing) return { id: existing[0], number: 1 };
      n += 1;
      const id = `dddddddd-0000-4000-8000-00000000000${n}`;
      orders.set(id, { input, status: "open", sent: input.send, due: input.dueAt, kots: [] });
      return { id, number: n };
    }),
    send: vi.fn(async (_t, id) => {
      const o = orders.get(id)!;
      o.sent = true;
      o.kots = [{ id: `kot-${id}-1`, status: "new" }, { id: `kot-${id}-2`, status: "new" }];
    }),
    setDue: vi.fn(async (_t, id, due) => {
      orders.get(id)!.due = due;
    }),
    cancel: vi.fn(async (_t, id, reason) => {
      const o = orders.get(id)!;
      o.status = "cancelled";
      o.cancelReason = reason;
    }),
    settle: vi.fn(async (_t, id) => {
      orders.get(id)!.status = "billed";
    }),
    state: vi.fn(async (_t, id) => {
      const o = orders.get(id);
      return o ? { status: o.status, number: 1, kots: o.kots } : null;
    }),
    orderOfKot: vi.fn(async (_t, kotId) => [...orders.entries()].find(([, o]) => o.kots.some((k) => k.id === kotId))?.[0] ?? null),
  };
  return { port, orders };
}

const menuItems: MenuItemInfo[] = [
  { id: PANEER, name: "Paneer Butter Masala", rate: 24000, gstRate: 5, categoryId: "c1", image: null, veg: true, available: true },
  { id: NAAN, name: "Garlic Naan", rate: 9500, gstRate: 5, categoryId: "c1", image: null, veg: true, available: false },
];
const menu: MenuPort = {
  list: async () => menuItems,
  categories: async () => [
    { id: "c1", name: "Mains", sort: 1 },
    { id: "c2", name: "Empty", sort: 2 },
  ],
  existing: async (_t, ids) => ids.filter((id) => menuItems.some((m) => m.id === id)),
};

let store: ReturnType<typeof memoryStore>;
let kitchen: ReturnType<typeof fakeKitchen>;
let http: HttpPort & { send: ReturnType<typeof vi.fn> };
let svc: AggregatorsService;
let now: Date;

beforeEach(() => {
  store = memoryStore();
  kitchen = fakeKitchen();
  http = { send: vi.fn(async () => ({ status: 200, body: { status: "success" } })) };
  now = new Date("2026-10-21T08:00:00Z");
  svc = new AggregatorsService({
    store,
    kitchen: kitchen.port,
    menu,
    http,
    features: { isEnabled: async () => true },
    config: { encryptionKey: "test-key", publicBaseUrl: "https://api.example.in/" },
    now: () => now,
  });
});

async function connectUp(extra: Record<string, unknown> = {}) {
  const c = await svc.saveConnection(TENANT, "urbanpiper", { username: "biz", apiKey: "k3y", webhookSecret: "s3cret", storeRef: "annapoorna-main", ...extra });
  return { ...c, key: c.webhookUrl!.split("/").pop()! };
}
const post = (key: string, body: string, headers: Record<string, string> = { "x-webhook-secret": "s3cret" }, provider = "urbanpiper") =>
  svc.handleWebhook(provider, key, Buffer.from(body), headers);

describe("connection settings", () => {
  it("creates a connection with a webhook URL, encrypted secrets, and never returns them", async () => {
    const c = await svc.saveConnection(TENANT, "urbanpiper", { username: "biz", apiKey: "k3y", storeRef: "s1" });
    expect(c.webhookUrl).toMatch(/^https:\/\/api\.example\.in\/v1\/aggregators\/urbanpiper\/webhook\/[A-Za-z0-9_-]{24}$/);
    expect(c.newWebhookSecret).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(c).toMatchObject({ configured: true, hasApiKey: true, hasWebhookSecret: true, username: "biz" });
    expect(JSON.stringify(c)).not.toContain("k3y");
    expect(store.conns[0]!.apiKeyEnc).not.toContain("k3y");
    expect(c.platforms.zomato).toEqual({ enabled: true, taxMode: "eco_9_5", gstin: null });
    const again = await svc.saveConnection(TENANT, "urbanpiper", { autoAccept: true });
    expect(again.webhookUrl).toBe(c.webhookUrl);
    expect(again.newWebhookSecret).toBeUndefined();
  });

  it("lists every provider; rotating gives a new URL and the old one stops working", async () => {
    expect((await svc.connections(TENANT)).map((c) => [c.provider, c.configured])).toEqual([
      ["urbanpiper", false],
      ["manual", false],
    ]);
    const { key } = await connectUp();
    const r = await svc.rotate(TENANT, "urbanpiper");
    expect(r.webhookUrl).not.toContain(key);
    await expect(post(key, fixture("urbanpiper-order-zomato.json"))).rejects.toMatchObject({ status: 404 });
  });

  it("switching a platform off pushes store off to the provider", async () => {
    await connectUp();
    const r = await svc.saveConnection(TENANT, "urbanpiper", { platforms: { swiggy: { enabled: false, gstin: "29aaacb1234c1z5" } } });
    expect(r.platforms.swiggy).toEqual({ enabled: false, taxMode: "eco_9_5", gstin: "29AAACB1234C1Z5" });
    expect(http.send).toHaveBeenCalledWith(expect.objectContaining({ url: "https://api.urbanpiper.com/hub/api/v1/location/", body: { location_ref_id: "annapoorna-main", platforms: ["swiggy"], action: "disable" } }));
    expect(r.pushed).toEqual([{ sent: true, ok: true, requests: 1, failed: 0 }]);
  });
});

describe("incoming order webhook", () => {
  it("verifies, normalizes, maps and opens a waiting kitchen order", async () => {
    const { key } = await connectUp();
    const r = await post(key, fixture("urbanpiper-order-zomato.json"));
    expect(r).toMatchObject({ ok: true, kind: "order", duplicate: false });
    const o = store.orders[0]!;
    expect(o).toMatchObject({ platform: "zomato", externalId: "812345601", status: "placed", unmapped: 1, total: 46300, taxMode: "eco_9_5", valueOfSupply: 46000, gst: 2300, kitchenNumber: 1 });
    expect(o.lines.map((l) => [l.title, l.itemId, l.via])).toEqual([
      ["Paneer Butter Masala", PANEER, "ref"],
      ["Garlic Naan", null, null],
    ]);
    const k = kitchen.orders.get(o.diningOrderId!)!;
    expect(k.input).toMatchObject({ ref: `agg:${o.id}`, type: "delivery", platform: "zomato", customerName: "Ravi K.", customerPhone: "******3210", taxByOperator: true, send: false });
    expect(k.input.note).toBe("Zomato #5123412345 · 1 item(s) not on our menu · Don't ring the bell");
    expect(k.input.lines).toEqual([
      { itemId: PANEER, name: "Paneer Butter Masala", qty: 1, rate: 27000, note: "+ Extra cheese · − Onion · Less spicy" },
      { itemId: null, name: "Garlic Naan", qty: 2, rate: 9500, note: "⚠ not on menu" },
    ]);
    expect(k.sent).toBe(false);
    expect(store.conns[0]!.lastWebhookAt).toEqual(now);
  });

  it("an explicit mapping maps the platform item", async () => {
    const { key } = await connectUp();
    await svc.saveMapping(TENANT, "urbanpiper", { externalId: "UP-GARLIC-NAAN", itemId: NAAN, title: "Garlic Naan" });
    await post(key, fixture("urbanpiper-order-zomato.json"));
    expect(store.orders[0]!.unmapped).toBe(0);
    expect(store.orders[0]!.lines[1]).toMatchObject({ itemId: NAAN, via: "mapping" });
    await expect(svc.saveMapping(TENANT, "urbanpiper", { externalId: "x", itemId: "33333333-3333-4333-8333-333333333333" })).rejects.toThrow(/Unknown menu item/);
  });

  it("is idempotent by the provider's order id", async () => {
    const { key } = await connectUp();
    const a = await post(key, fixture("urbanpiper-order-zomato.json"));
    const b = await post(key, fixture("urbanpiper-order-zomato.json"));
    expect(b).toEqual({ ok: true, kind: "order", id: a.id, duplicate: true });
    expect(store.orders).toHaveLength(1);
    expect(kitchen.port.open).toHaveBeenCalledTimes(1);
  });

  it("refuses bad signatures (401), unknown keys (404), switched-off connections and shops (403), bad bodies (400)", async () => {
    const { key } = await connectUp();
    await expect(post(key, fixture("urbanpiper-order-zomato.json"), { "x-webhook-secret": "nope" })).rejects.toMatchObject({ status: 401, code: "bad_signature" });
    expect(store.conns[0]!.lastError).toMatch(/signature/);
    await expect(post("A".repeat(24), "{}")).rejects.toMatchObject({ status: 404 });
    await expect(post(key, "{}", { "x-aggregator-secret": "s3cret" }, "manual")).rejects.toMatchObject({ status: 404 });
    await expect(post(key, "not json")).rejects.toMatchObject({ status: 400 });
    await expect(post(key, '{"hello":1}')).rejects.toMatchObject({ status: 400 });
    expect(store.conns[0]!.lastError).toMatch(/Not an UrbanPiper/);
    const hmac = signBody(fixture("urbanpiper-order-zomato.json"), "s3cret");
    expect(await post(key, fixture("urbanpiper-order-zomato.json"), { "x-urbanpiper-signature": hmac })).toMatchObject({ ok: true });

    await svc.saveConnection(TENANT, "urbanpiper", { enabled: false });
    await expect(post(key, fixture("urbanpiper-order-swiggy-cod.json"))).rejects.toMatchObject({ status: 403, code: "connection_off" });
    await svc.saveConnection(TENANT, "urbanpiper", { enabled: true });
    const off = new AggregatorsService({ store, config: { encryptionKey: "test-key", publicBaseUrl: "x" }, features: { isEnabled: async () => false } });
    await expect(off.handleWebhook("urbanpiper", key, Buffer.from(fixture("urbanpiper-order-swiggy-cod.json")), { "x-webhook-secret": "s3cret" })).rejects.toMatchObject({ status: 403, code: "feature_disabled" });
  });

  it("keeps the order when the kitchen fails, and retries it", async () => {
    const { key } = await connectUp();
    vi.mocked(kitchen.port.open).mockRejectedValueOnce(new Error("db down"));
    await post(key, fixture("urbanpiper-order-zomato.json"));
    const o = store.orders[0]!;
    expect(o).toMatchObject({ diningOrderId: null, kitchenError: "db down", status: "placed" });
    const r = await svc.retryKitchen(TENANT, o.id);
    expect(r.diningOrderId).toBeTruthy();
    expect(r.kitchenError).toBeNull();
  });

  it("auto-accept sends KOTs at once with the default prep time and reports Acknowledged", async () => {
    const { key } = await connectUp({ autoAccept: true, prepMinutes: 15 });
    await post(key, fixture("urbanpiper-order-zomato.json"));
    const o = store.orders[0]!;
    expect(o).toMatchObject({ status: "accepted", prepMinutes: 15, acceptedAt: now });
    const k = kitchen.orders.get(o.diningOrderId!)!;
    expect(k.sent).toBe(true);
    expect(k.due).toEqual(new Date(now.getTime() + 15 * 60_000));
    expect(http.send).toHaveBeenCalledWith({
      method: "PUT",
      url: "https://api.urbanpiper.com/external/api/v1/orders/812345601/status/",
      headers: { "content-type": "application/json", authorization: "apikey biz:k3y" },
      body: { new_status: "Acknowledged", message: "Accepted", extra: { prep_time: 15 } },
    });
    expect(o.callbacks).toEqual([{ status: "accepted", at: now.toISOString(), ok: true, httpStatus: 200 }]);
  });
});

describe("staff actions and status callbacks", () => {
  async function placed() {
    const { key } = await connectUp();
    await post(key, fixture("urbanpiper-order-zomato.json"));
    return store.orders[0]!;
  }

  it("accept → KOTs + due time + Acknowledged; ready → Food Ready; dispatched → Dispatched and settled without a bill", async () => {
    const o = await placed();
    const a = await svc.accept(TENANT, o.id, { prepMinutes: 25 });
    expect(a.status).toBe("accepted");
    expect(kitchen.orders.get(o.diningOrderId!)!.sent).toBe(true);
    expect(kitchen.orders.get(o.diningOrderId!)!.due).toEqual(new Date(now.getTime() + 25 * 60_000));
    await expect(svc.accept(TENANT, o.id)).rejects.toMatchObject({ code: "order_moved" });

    const r = await svc.markReady(TENANT, o.id);
    expect(r).toMatchObject({ status: "ready", readyAt: now });
    const d = await svc.markDispatched(TENANT, o.id);
    expect(d.status).toBe("dispatched");
    expect(kitchen.port.settle).toHaveBeenCalledWith(TENANT, o.diningOrderId);
    expect(kitchen.orders.get(o.diningOrderId!)!.status).toBe("billed");
    expect(http.send.mock.calls.map((c) => (c[0] as { body: { new_status: string } }).body.new_status)).toEqual(["Acknowledged", "Food Ready", "Dispatched"]);
    expect(d.callbacks.map((c) => [c.status, c.ok])).toEqual([
      ["accepted", true],
      ["ready", true],
      ["dispatched", true],
    ]);
    expect(d.taxNote).toMatch(/collected and paid by Zomato under section 9\(5\)/);
  });

  it("reject cancels the kitchen order and reports Cancelled with the reason", async () => {
    const o = await placed();
    const r = await svc.reject(TENANT, o.id, { reason: "Out of paneer" });
    expect(r).toMatchObject({ status: "rejected", reason: "Out of paneer" });
    expect(kitchen.orders.get(o.diningOrderId!)!).toMatchObject({ status: "cancelled", cancelReason: "Rejected: Out of paneer" });
    expect(http.send).toHaveBeenLastCalledWith(expect.objectContaining({ body: { new_status: "Cancelled", message: "Out of paneer" } }));
    await expect(svc.reject(TENANT, o.id, { reason: "again" })).rejects.toBeInstanceOf(AppError);
    await expect(svc.reject(TENANT, o.id, { reason: "x" })).rejects.toThrow();
  });

  it("a failed callback is recorded, not thrown, and can be re-sent", async () => {
    const o = await placed();
    http.send.mockResolvedValueOnce({ status: 500, body: { message: "boom" } });
    const a = await svc.accept(TENANT, o.id);
    expect(a.status).toBe("accepted");
    expect(a.lastCallback).toMatchObject({ status: "accepted", ok: false, httpStatus: 500, error: '{"message":"boom"}' });
    http.send.mockRejectedValueOnce(new Error("ETIMEDOUT"));
    expect((await svc.resync(TENANT, o.id)).lastCallback).toMatchObject({ ok: false, error: "ETIMEDOUT" });
    expect((await svc.resync(TENANT, o.id)).lastCallback).toMatchObject({ ok: true, httpStatus: 200 });
  });

  it("without an API key nothing is sent and the report says why", async () => {
    const o = await placed();
    await svc.saveConnection(TENANT, "urbanpiper", { apiKey: null });
    const a = await svc.accept(TENANT, o.id);
    expect(http.send).not.toHaveBeenCalled();
    expect(a.lastCallback).toMatchObject({ ok: false, skipped: true, error: "No API key saved" });
  });

  it("all tickets ready on the kitchen display marks the order ready", async () => {
    const o = await placed();
    await svc.accept(TENANT, o.id);
    const k = kitchen.orders.get(o.diningOrderId!)!;
    k.kots[0]!.status = "ready";
    await svc.kitchenChanged(TENANT, { kind: "kot", id: k.kots[0]!.id });
    expect(store.orders[0]!.status).toBe("accepted");
    k.kots[1]!.status = "ready";
    await svc.kitchenChanged(TENANT, { kind: "kot", id: k.kots[1]!.id });
    expect(store.orders[0]!.status).toBe("ready");
    await svc.kitchenChanged(TENANT, { kind: "kot", id: "unknown" });
  });

  it("platform cancellation and rider pickup webhooks", async () => {
    const o = await placed();
    const key = store.conns[0]!.webhookKey;
    await svc.accept(TENANT, o.id);
    await post(key, fixture("urbanpiper-rider.json"));
    expect(store.orders[0]).toMatchObject({ status: "dispatched", rider: { name: "Arun", phone: "******2345", status: "out-for-delivery" } });
    expect(kitchen.orders.get(o.diningOrderId!)!.status).toBe("billed");
    // Already dispatched: a late cancel changes nothing.
    await post(key, fixture("urbanpiper-status-cancelled.json"));
    expect(store.orders[0]!.status).toBe("dispatched");
  });

  it("a cancel before dispatch cancels the kitchen order", async () => {
    const o = await placed();
    await post(store.conns[0]!.webhookKey, fixture("urbanpiper-status-cancelled.json"));
    expect(store.orders[0]).toMatchObject({ status: "cancelled", reason: "Customer cancelled the order" });
    expect(kitchen.orders.get(o.diningOrderId!)!.status).toBe("cancelled");
    expect(http.send).not.toHaveBeenCalled();
  });

  it("restaurant tax mode: not settled on dispatch (the shop bills it as usual)", async () => {
    const { key } = await connectUp({ platforms: { zomato: { taxMode: "restaurant" } } });
    await post(key, fixture("urbanpiper-order-zomato.json"));
    const o = store.orders[0]!;
    expect(kitchen.orders.get(o.diningOrderId!)!.input.taxByOperator).toBe(false);
    await svc.accept(TENANT, o.id);
    await svc.markDispatched(TENANT, o.id);
    expect(kitchen.port.settle).not.toHaveBeenCalled();
  });
});

describe("test orders, menu and stock push, GST report", () => {
  it("a test order goes through the manual provider and is never reported", async () => {
    const t = await svc.testOrder(TENANT, "manual", { platform: "swiggy" });
    expect(t).toMatchObject({ platform: "swiggy", test: true, status: "placed", unmapped: 0 });
    expect(t.lines.map((l) => [l.itemId, l.qty])).toEqual([[PANEER, 1]]);
    await svc.accept(TENANT, t.id);
    expect(http.send).not.toHaveBeenCalled();
    expect((await svc.getOrder(TENANT, t.id)).lastCallback).toMatchObject({ skipped: true, ok: true });
    expect(kitchen.orders.get(t.diningOrderId!)!.input.note).toContain("TEST");
  });

  it("menu push sends catalogue items (mapped ones with the platform ref) and used categories only", async () => {
    await connectUp();
    await svc.saveMapping(TENANT, "urbanpiper", { externalId: "UP-GARLIC-NAAN", itemId: NAAN });
    const r = await svc.pushMenu(TENANT, "urbanpiper");
    expect(r).toEqual({ sent: true, ok: true, requests: 1, failed: 0, items: 2 });
    const body = (http.send.mock.calls[0]![0] as { body: { items: { ref_id: string; available: boolean }[]; categories: unknown[]; items_platforms?: unknown } }).body;
    expect(body.items.map((i) => [i.ref_id, i.available])).toEqual([
      [PANEER, true],
      ["UP-GARLIC-NAAN", false],
    ]);
    expect(body.categories).toHaveLength(1);
    expect(store.conns[0]!.menuPushedAt).toEqual(now);
  });

  it("stock push sends sold-out items as disabled; manual provider has nothing to push", async () => {
    await connectUp();
    const r = await svc.pushStock(TENANT, "urbanpiper");
    expect(r).toMatchObject({ sent: true, ok: true, requests: 2, items: 2 });
    expect(http.send.mock.calls.map((c) => (c[0] as { body: { action: string; item_ref_ids: string[] } }).body)).toEqual([
      expect.objectContaining({ action: "enable", item_ref_ids: [PANEER] }),
      expect.objectContaining({ action: "disable", item_ref_ids: [NAAN] }),
    ]);
    await svc.saveConnection(TENANT, "manual", {});
    expect(await svc.pushMenu(TENANT, "manual")).toMatchObject({ sent: false, reason: "The manual provider has no API" });
  });

  it("unmapped items seen in orders are listed for mapping", async () => {
    const { key } = await connectUp();
    await post(key, fixture("urbanpiper-order-zomato.json"));
    expect(await svc.unmapped(TENANT, "urbanpiper")).toEqual([{ externalId: "99002", title: "Garlic Naan", count: 1, lastSeen: new Date(1792560000000) }]);
  });

  it("the 9(5) report sums dispatched / completed orders per platform, without test orders", async () => {
    const { key } = await connectUp();
    await post(key, fixture("urbanpiper-order-zomato.json"));
    const o = store.orders[0]!;
    await svc.accept(TENANT, o.id);
    await svc.markDispatched(TENANT, o.id);
    const t = await svc.testOrder(TENANT, "manual");
    await svc.accept(TENANT, t.id);
    await svc.markDispatched(TENANT, t.id);
    const day = new Date(1792560000000 + 5.5 * 3_600_000).toISOString().slice(0, 10);
    const r = await svc.ecoReport(TENANT, { from: day, to: day });
    expect(r.summary).toEqual([{ platform: "zomato", operator: "Zomato", operatorGstin: null, orders: 1, valueOfSupply: 46000, gst: 2300 }]);
    await expect(svc.ecoReport(TENANT, { from: "2026-10-22", to: "2026-10-01" })).rejects.toThrow();
  });
});
