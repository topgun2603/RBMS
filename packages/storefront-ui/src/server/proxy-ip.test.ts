import { afterEach, describe, expect, it, vi } from "vitest";
import { forwardedClientIp, proxyHandler } from "./proxy";

afterEach(() => vi.unstubAllGlobals());

describe("store proxy: the shopper's IP", () => {
  it("takes the entry the load balancer added, never one the browser wrote", () => {
    expect(forwardedClientIp("6.6.6.6, 203.0.113.9")).toBe("203.0.113.9");
    expect(forwardedClientIp("203.0.113.9")).toBe("203.0.113.9");
    expect(forwardedClientIp("6.6.6.6, 203.0.113.9, 10.0.0.7", 2)).toBe("203.0.113.9");
    expect(forwardedClientIp("2001:db8::1")).toBe("2001:db8::1");
    expect(forwardedClientIp(null)).toBeNull();
    expect(forwardedClientIp("203.0.113.9", 2)).toBeNull();
    expect(forwardedClientIp("not an ip")).toBeNull();
  });

  it("forwards one X-Forwarded-For entry to the API: the real client", async () => {
    const f = vi.fn(async (_url: string, _init: RequestInit) => new Response("{}", { status: 200, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", f);
    await proxyHandler(new Request("http://cauvery.localhost:3003/api/v1/store/products", { headers: { "x-forwarded-for": "6.6.6.6, 203.0.113.9" } }));
    expect(new Headers(f.mock.calls[0]![1].headers).get("x-forwarded-for")).toBe("203.0.113.9");
  });
});
