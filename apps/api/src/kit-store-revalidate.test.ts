import { describe, expect, it, vi } from "vitest";
import { createStoreRevalidator, storeResourcesFor, storeRevalidateConfig } from "./kit-store-revalidate";

describe("storeResourcesFor", () => {
  it("maps staff writes to the store data they change", () => {
    expect(storeResourcesFor("POST", "/v1/cms/home/publish")).toEqual(["home"]);
    expect(storeResourcesFor("PUT", "/v1/cms/home")).toEqual([]); // a draft isn't public
    expect(storeResourcesFor("PUT", "/v1/cms/menus/:key")).toEqual(["menus"]);
    expect(storeResourcesFor("PATCH", "/v1/cms/pages/:id")).toEqual(["pages", "seo"]);
    expect(storeResourcesFor("POST", "/v1/cms/posts/:id/publish")).toEqual(["posts", "seo"]);
    expect(storeResourcesFor("PUT", "/v1/branding/")).toEqual(["branding", "config"]);
    expect(storeResourcesFor("POST", "/v1/branding/preview")).toEqual([]);
    expect(storeResourcesFor("PATCH", "/v1/catalog/products/:id")).toEqual(["catalog", "offers", "seo", "bookings"]);
    expect(storeResourcesFor("POST", "/v1/catalog/collections")).toEqual(["catalog", "offers", "seo", "bookings"]);
    // The booking page (/book) refreshes when services or staff change; slots are always live.
    expect(storeResourcesFor("PATCH", "/v1/bookings/services/:id")).toEqual(["bookings", "catalog"]);
    expect(storeResourcesFor("POST", "/v1/bookings/staff")).toEqual(["bookings", "catalog"]);
    expect(storeResourcesFor("PUT", "/v1/bookings/hours")).toEqual([]);
    expect(storeResourcesFor("POST", "/v1/bookings/public/appointments")).toEqual([]);
    expect(storeResourcesFor("PUT", "/v1/features/:key")).toEqual(["features", "config", "catalog", "bookings"]);
    expect(storeResourcesFor("POST", "/v1/inventory/adjustments")).toEqual(["catalog"]);
    expect(storeResourcesFor("PATCH", "/v1/coupons/offers/:id")).toEqual(["offers"]);
    expect(storeResourcesFor("POST", "/v1/coupons/offers/preview")).toEqual([]);
    expect(storeResourcesFor("PUT", "/v1/settings/:namespace/tenant", { namespace: "store" })).toEqual(["config"]);
    expect(storeResourcesFor("PUT", "/v1/settings/:namespace/tenant", { namespace: "billing" })).toEqual([]);
  });

  it("ignores reads, shopper traffic and unrelated modules", () => {
    expect(storeResourcesFor("GET", "/v1/catalog/products")).toEqual([]);
    expect(storeResourcesFor("POST", "/v1/store/cart")).toEqual([]);
    expect(storeResourcesFor("POST", "/v1/catalog/public/search")).toEqual([]);
    expect(storeResourcesFor("POST", "/v1/invoices")).toEqual([]);
    expect(storeResourcesFor("POST", undefined)).toEqual([]);
  });
});

describe("storeRevalidateConfig", () => {
  it("has dev defaults outside production only", () => {
    expect(storeRevalidateConfig({})).toEqual({ url: "http://127.0.0.1:3003/api/revalidate", secret: "dev-store-revalidate-secret" });
    expect(storeRevalidateConfig({ NODE_ENV: "production" })).toEqual({ url: null, secret: null });
    expect(storeRevalidateConfig({ NODE_ENV: "production", STORE_REVALIDATE_URL: "https://store.internal/api/revalidate", STORE_REVALIDATE_SECRET: "s3cret" })).toEqual({
      url: "https://store.internal/api/revalidate",
      secret: "s3cret",
    });
    expect(storeRevalidateConfig({ STORE_REVALIDATE_URL: "off" }).url).toBeNull();
  });
});

describe("createStoreRevalidator", () => {
  const log = { info: vi.fn(), warn: vi.fn() };
  const config = { url: "http://store/api/revalidate", secret: "s" };
  const reply = (statusCode: number) => ({ statusCode }) as never;
  const req = (method: string, url: string, tenant: { id: string; slug: string } | null = { id: "t1", slug: "anbu" }) =>
    ({ method, routeOptions: { url }, params: {}, ctx: { tenant } }) as never;

  it("merges a shop's writes into one call with its slug and verified domains, and the shared secret", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    const r = createStoreRevalidator({ config, domains: async () => ["anbufashions.in"], log, fetch: fetch as never, debounceMs: 10_000 });
    await r.onResponse(req("PATCH", "/v1/catalog/products/:id"), reply(200));
    await r.onResponse(req("POST", "/v1/cms/home/publish"), reply(200));
    await r.onResponse(req("POST", "/v1/cms/pages"), reply(400)); // failed write: nothing
    await r.flush();
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("http://store/api/revalidate");
    expect((init.headers as Record<string, string>)["x-revalidate-secret"]).toBe("s");
    expect(JSON.parse(init.body as string)).toEqual({ keys: ["anbu", "anbufashions.in"], resources: ["catalog", "offers", "seo", "bookings", "home"] });
  });

  it("never throws: a store that is down is logged, and no tenant / no config means no call", async () => {
    const fetch = vi.fn(async () => {
      throw new Error("ECONNREFUSED");
    });
    const r = createStoreRevalidator({ config, domains: async () => [], log, fetch: fetch as never, debounceMs: 10_000 });
    await r.onResponse(req("PUT", "/v1/cms/menus/:key"), reply(200));
    await expect(r.flush()).resolves.toBeUndefined();
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ err: "ECONNREFUSED" }), "store revalidate failed");

    await r.onResponse(req("PUT", "/v1/cms/menus/:key", null), reply(200));
    await r.flush();
    expect(fetch).toHaveBeenCalledTimes(1);

    const off = vi.fn();
    const r2 = createStoreRevalidator({ config: { url: null, secret: null }, domains: async () => [], log, fetch: off as never });
    await r2.onResponse(req("PUT", "/v1/cms/menus/:key"), reply(200));
    await r2.flush();
    expect(off).not.toHaveBeenCalled();
  });
});
