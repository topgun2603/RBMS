import { afterEach, describe, expect, it, vi } from "vitest";
import { proxyHandler, proxyRetries } from "./proxy";

afterEach(() => vi.unstubAllGlobals());

const refused = () => Promise.reject(new TypeError("fetch failed"));
const ok = () => Promise.resolve(new Response(JSON.stringify({ items: [] }), { status: 200, headers: { "content-type": "application/json" } }));

describe("store proxy under load / API restarts", () => {
  it("retries reads, never writes", () => {
    expect(proxyRetries("GET")).toBe(2);
    expect(proxyRetries("head")).toBe(2);
    expect(proxyRetries("POST")).toBe(0);
  });

  it("a read that fails to connect is retried and then answers normally", async () => {
    const f = vi.fn().mockImplementationOnce(refused).mockImplementationOnce(ok);
    vi.stubGlobal("fetch", f);
    const res = await proxyHandler(new Request("http://cauvery.localhost:3003/api/v1/inventory/public/availability?itemIds=a"));
    expect(res.status).toBe(200);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("an analytics beacon that can't reach the API is a quiet 204, not a 502 (and is not re-sent)", async () => {
    const f = vi.fn().mockImplementation(refused);
    vi.stubGlobal("fetch", f);
    const res = await proxyHandler(new Request("http://cauvery.localhost:3003/api/v1/analytics/public/events", { method: "POST", body: "{}", headers: { "content-type": "application/json" } }));
    expect(res.status).toBe(204);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("other failures still say so (502 after the retries)", async () => {
    const f = vi.fn().mockImplementation(refused);
    vi.stubGlobal("fetch", f);
    const res = await proxyHandler(new Request("http://cauvery.localhost:3003/api/v1/catalog/public/search"));
    expect(res.status).toBe(502);
    expect(f).toHaveBeenCalledTimes(3);
  });
});
