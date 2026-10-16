import { describe, expect, it, vi } from "vitest";
import { hmacHex, MOCK_WEBHOOK_SECRET, MockSubscriptionProvider, ProviderError, RazorpaySubscriptionProvider, verifyHmac } from "./provider";

describe("webhook signature", () => {
  it("accepts the HMAC of the raw body and rejects anything else", () => {
    const body = Buffer.from('{"event":"subscription.charged"}');
    const sig = hmacHex(body, "whsec");
    expect(verifyHmac(body, sig, "whsec")).toBe(true);
    expect(verifyHmac(body, sig.toUpperCase(), "whsec")).toBe(true);
    expect(verifyHmac(body, sig, "other")).toBe(false);
    expect(verifyHmac(Buffer.from('{"event":"x"}'), sig, "whsec")).toBe(false);
    expect(verifyHmac(body, undefined, "whsec")).toBe(false);
    expect(verifyHmac(body, "not-hex", "whsec")).toBe(false);
    expect(verifyHmac(body, sig, "")).toBe(false);
  });
});

describe("RazorpaySubscriptionProvider", () => {
  const make = (responder: (url: string, init: RequestInit) => { status?: number; body: unknown }) => {
    const calls: { url: string; init: RequestInit }[] = [];
    const fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init: init! });
      const r = responder(String(url), init!);
      return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
    }) as unknown as typeof globalThis.fetch;
    return { p: new RazorpaySubscriptionProvider({ keyId: "rzp_test", keySecret: "sec", webhookSecret: "wh", fetch }), calls };
  };

  it("creates plans and subscriptions with Basic auth and a future start", async () => {
    const { p, calls } = make((url) => (url.endsWith("/plans") ? { body: { id: "plan_1" } } : { body: { id: "sub_1", short_url: "https://rzp.io/i/x" } }));
    expect(await p.createPlan({ planId: "pro", name: "Pro (monthly)", interval: "monthly", amountPaise: 176_882 })).toEqual({ id: "plan_1" });
    const plan = JSON.parse(String(calls[0]!.init.body));
    expect(plan).toMatchObject({ period: "monthly", interval: 1, item: { amount: 176_882, currency: "INR" } });
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe(`Basic ${Buffer.from("rzp_test:sec").toString("base64")}`);
    const start = new Date(Date.now() + 14 * 86_400_000);
    expect(await p.createSubscription({ providerPlanId: "plan_1", interval: "monthly", startAt: start, notes: { tenantId: "t" } })).toEqual({
      id: "sub_1",
      shortUrl: "https://rzp.io/i/x",
    });
    const s = JSON.parse(String(calls[1]!.init.body));
    expect(s).toMatchObject({ plan_id: "plan_1", total_count: 120, start_at: Math.floor(start.getTime() / 1000), notes: { tenantId: "t" } });
    await p.createSubscription({ providerPlanId: "plan_1", interval: "yearly", startAt: new Date(), notes: {} });
    const now = JSON.parse(String(calls[2]!.init.body));
    expect(now.start_at).toBeUndefined();
    expect(now.total_count).toBe(10);
  });

  it("cancels at the cycle end or now", async () => {
    const { p, calls } = make(() => ({ body: { id: "sub_1", status: "cancelled" } }));
    await p.cancel("sub_1", true);
    await p.cancel("sub_1", false);
    expect(calls[0]!.url).toMatch(/\/subscriptions\/sub_1\/cancel$/);
    expect(JSON.parse(String(calls[0]!.init.body))).toEqual({ cancel_at_cycle_end: 1 });
    expect(JSON.parse(String(calls[1]!.init.body))).toEqual({ cancel_at_cycle_end: 0 });
  });

  it("maps errors to ProviderError", async () => {
    const { p } = make(() => ({ status: 400, body: { error: { code: "BAD_REQUEST_ERROR", description: "plan_id is invalid" } } }));
    await expect(p.createSubscription({ providerPlanId: "x", interval: "monthly", notes: {} })).rejects.toMatchObject({
      name: "ProviderError",
      status: 400,
      message: "plan_id is invalid",
    });
    expect(new ProviderError(0, null, "x")).toBeInstanceOf(Error);
  });
});

describe("MockSubscriptionProvider", () => {
  it("returns the app's authorise URL and verifies with the dev secret", async () => {
    const p = new MockSubscriptionProvider({ authUrl: (id, notes) => `http://${notes.slug}.localhost:3001/settings/plan?mockAuth=${id}` });
    const r = await p.createSubscription({ providerPlanId: "plan_mock", notes: { slug: "acme" } });
    expect(r.id).toMatch(/^sub_mock_/);
    expect(r.shortUrl).toBe(`http://acme.localhost:3001/settings/plan?mockAuth=${r.id}`);
    expect((await p.fetch(r.id)).status).toBe("created");
    await p.cancel(r.id);
    expect((await p.fetch(r.id)).status).toBe("cancelled");
    const body = '{"event":"subscription.authenticated"}';
    expect(p.verifyWebhook(body, hmacHex(body, MOCK_WEBHOOK_SECRET))).toBe(true);
    expect(p.verifyWebhook(body, hmacHex(body, "wrong"))).toBe(false);
  });
});
