import { describe, expect, it, vi } from "vitest";
import { cacheResource, cacheTags, tagsToRevalidate } from "./cache-tags";
import { revalidateHandler, revalidateSecret } from "../server/revalidate";

describe("store cache tags", () => {
  it("names the resource behind each API path the store reads", () => {
    expect(cacheResource("/cms/public/home")).toBe("home");
    expect(cacheResource("/cms/public/menus")).toBe("menus");
    expect(cacheResource("/cms/public/pages/size-guide")).toBe("pages");
    expect(cacheResource("/cms/public/posts")).toBe("posts");
    expect(cacheResource("/cms/public/seo")).toBe("seo");
    expect(cacheResource("/branding")).toBe("branding");
    expect(cacheResource("/store/config")).toBe("config");
    expect(cacheResource("/store/promotions")).toBe("offers");
    expect(cacheResource("/store/bundles")).toBe("offers");
    expect(cacheResource("/catalog/public/products/kurti")).toBe("catalog");
    expect(cacheResource("/inventory/public/availability")).toBe("catalog");
    expect(cacheResource("/features")).toBe("features");
    expect(cacheResource("/reviews/public/ratings")).toBe("reviews");
    // The booking page's services and staff: refreshed when staff change services (API kit-store-revalidate).
    expect(cacheResource("/bookings/public/services")).toBe("bookings");
    expect(cacheResource("/bookings/public/staff")).toBe("bookings");
    expect(cacheTags("glow", "/bookings/public/services")).toEqual(["store:glow", "store:glow:bookings"]);
    expect(tagsToRevalidate({ keys: ["glow"], resources: ["bookings", "catalog"] })).toEqual(["store:glow:bookings", "store:glow:catalog"]);
    expect(cacheResource("/jobcards/public/track/x")).toBe("other");
  });

  it("tags every cached fetch with the shop and the shop + resource", () => {
    expect(cacheTags("anbu", "/cms/public/home")).toEqual(["store:anbu", "store:anbu:home"]);
    expect(cacheTags("WWW.Anbu.in", "/catalog/public/search")).toEqual(["store:www.anbu.in", "store:www.anbu.in:catalog"]);
  });

  it("turns a refresh request into tags (unknown resources dropped; none → the whole shop; bad body → null)", () => {
    expect(tagsToRevalidate({ keys: ["anbu", "anbufashions.in"], resources: ["home", "catalog", "nope"] })).toEqual([
      "store:anbu:home",
      "store:anbu:catalog",
      "store:anbufashions.in:home",
      "store:anbufashions.in:catalog",
    ]);
    expect(tagsToRevalidate({ keys: ["anbu"] })).toEqual(["store:anbu"]);
    expect(tagsToRevalidate({ keys: ["anbu"], resources: ["nope"] })).toEqual(["store:anbu"]);
    expect(tagsToRevalidate({ keys: ["bad key/../x"] })).toBeNull();
    expect(tagsToRevalidate({ resources: ["home"] })).toBeNull();
    expect(tagsToRevalidate(null)).toBeNull();
  });
});

describe("POST /api/revalidate", () => {
  const req = (body: unknown, secret?: string) =>
    new Request("http://store/api/revalidate", { method: "POST", headers: { "content-type": "application/json", ...(secret ? { "x-revalidate-secret": secret } : {}) }, body: JSON.stringify(body) });

  it("clears the requested tags with the right secret", async () => {
    const revalidate = vi.fn();
    const res = await revalidateHandler(req({ keys: ["anbu"], resources: ["home"] }, "s3cret"), { secret: "s3cret", revalidate });
    expect(res.status).toBe(200);
    expect(revalidate.mock.calls).toEqual([["store:anbu:home"]]);
  });

  it("refuses a wrong / missing secret and bad bodies; is off without a secret", async () => {
    const revalidate = vi.fn();
    expect((await revalidateHandler(req({ keys: ["anbu"] }, "nope"), { secret: "s3cret", revalidate })).status).toBe(401);
    expect((await revalidateHandler(req({ keys: ["anbu"] }), { secret: "s3cret", revalidate })).status).toBe(401);
    expect((await revalidateHandler(req({ nope: 1 }, "s3cret"), { secret: "s3cret", revalidate })).status).toBe(400);
    expect((await revalidateHandler(req({ keys: ["anbu"] }, "x"), { secret: null, revalidate })).status).toBe(404);
    expect(revalidate).not.toHaveBeenCalled();
  });

  it("uses STORE_REVALIDATE_SECRET; a dev default only outside production", () => {
    expect(revalidateSecret({ STORE_REVALIDATE_SECRET: " abc " })).toBe("abc");
    expect(revalidateSecret({ NODE_ENV: "development" })).toBe("dev-store-revalidate-secret");
    expect(revalidateSecret({ NODE_ENV: "production" })).toBeNull();
  });
});
