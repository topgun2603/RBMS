import { describe, expect, it, vi } from "vitest";
import { buildPayload, subscribes, WEBHOOK_EVENT_TYPES, WEBHOOK_EVENTS } from "./events";
import { TokenBucketLimiter } from "./ratelimit";
import { AUTO_DISABLE_AFTER, MAX_ATTEMPTS, readLimited, retryDelayMs, RETRY_SCHEDULE_MS, truncateUtf8 } from "./retry";
import { newWebhookSecret, sendWebhook, webhookRequest } from "./service";
import { verifySignature } from "./signature";

const MIN = 60_000;

describe("retry schedule", () => {
  it("is 1 m, 5 m, 30 m, 2 h, 12 h, then gives up", () => {
    expect(RETRY_SCHEDULE_MS).toEqual([MIN, 5 * MIN, 30 * MIN, 120 * MIN, 720 * MIN]);
    expect([1, 2, 3, 4, 5].map(retryDelayMs)).toEqual([MIN, 5 * MIN, 30 * MIN, 2 * 60 * MIN, 12 * 60 * MIN]);
    expect(retryDelayMs(6)).toBeNull();
    expect(retryDelayMs(0)).toBe(0);
    expect(MAX_ATTEMPTS).toBe(6);
    expect(AUTO_DISABLE_AFTER).toBe(20);
  });

  it("truncates bodies to 2 KB without splitting characters", () => {
    expect(truncateUtf8("x".repeat(5000))).toHaveLength(2048);
    expect(truncateUtf8("short")).toBe("short");
    const tamil = "தமிழ்".repeat(300);
    const cut = truncateUtf8(tamil);
    expect(Buffer.byteLength(cut, "utf8")).toBeLessThanOrEqual(2048);
    expect(cut).not.toContain("�");
    expect(tamil.startsWith(cut)).toBe(true);
  });

  it("reads at most 2 KB of a response", async () => {
    expect(await readLimited(new Response("y".repeat(100_000)))).toHaveLength(2048);
    expect(await readLimited(new Response(null, { status: 204 }))).toBe("");
  });
});

describe("event catalogue", () => {
  it("lists every contract event with a description and a sample", () => {
    expect(WEBHOOK_EVENTS.map((e) => e.type)).toEqual([...WEBHOOK_EVENT_TYPES]);
    for (const e of WEBHOOK_EVENTS) {
      expect(e.description.length).toBeGreaterThan(10);
      expect(Object.keys(e.sample).length).toBeGreaterThan(0);
    }
    expect(subscribes(["*"], "order.created")).toBe(true);
    expect(subscribes(["invoice.paid"], "order.created")).toBe(false);
  });
});

describe("delivery request", () => {
  const secret = newWebhookSecret();
  const payload = buildPayload("e1", "order.created", "meena-stores", { total: 125000 }, new Date("2026-10-15T10:30:00Z"));

  it("payload shape is { id, type, createdAt, tenant: { slug }, data }", () => {
    expect(secret).toMatch(/^whsec_[0-9A-Za-z]{32}$/);
    expect(payload).toEqual({ id: "e1", type: "order.created", createdAt: "2026-10-15T10:30:00.000Z", tenant: { slug: "meena-stores" }, data: { total: 125000 } });
  });

  it("sends signed JSON with the documented headers; 2xx = success", async () => {
    const fetchFn = vi.fn(async () => new Response("ok", { status: 200 }));
    const r = await sendWebhook(fetchFn as unknown as typeof fetch, "https://h.example.com/x", secret, payload, "d1", 1_760_000_000);
    expect(r).toMatchObject({ ok: true, status: 200, body: "ok", error: null });
    const [url, init] = fetchFn.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://h.example.com/x");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    const h = init.headers as Record<string, string>;
    expect(h["content-type"]).toBe("application/json");
    expect(h["user-agent"]).toBe("Srikit-Webhooks/1.0");
    expect(h["x-srikit-event"]).toBe("order.created");
    expect(h["x-srikit-delivery"]).toBe("d1");
    expect(h["x-srikit-signature"]).toMatch(/^t=1760000000,v1=[0-9a-f]{64}$/);
    expect(JSON.parse(init.body as string)).toEqual(payload);
    expect(verifySignature(secret, h["x-srikit-signature"], init.body as string, 300, 1_760_000_000)).toBe(true);
    expect(webhookRequest(secret, payload, "d1", 1).body).toBe(init.body);
  });

  it("treats non-2xx, redirects, network errors and timeouts as failures", async () => {
    const at = (status: number) => vi.fn(async () => new Response("nope", { status }));
    expect((await sendWebhook(at(500) as unknown as typeof fetch, "https://h/x", secret, payload, "d", 1)).ok).toBe(false);
    expect((await sendWebhook(at(302) as unknown as typeof fetch, "https://h/x", secret, payload, "d", 1)).ok).toBe(false);
    const boom = vi.fn(async () => {
      throw Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } });
    });
    expect(await sendWebhook(boom as unknown as typeof fetch, "https://h/x", secret, payload, "d", 1)).toMatchObject({
      ok: false,
      status: null,
      error: "ECONNREFUSED",
    });
    const slow = vi.fn(
      (_u: string, init: RequestInit) =>
        new Promise<Response>((_res, rej) => init.signal!.addEventListener("abort", () => rej(init.signal!.reason))),
    );
    const r = await sendWebhook(slow as unknown as typeof fetch, "https://h/x", secret, payload, "d", 1, 20);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Timed out/);
  });
});

describe("token bucket", () => {
  it("allows 600 per minute per key, then 429 with retry-after, and refills", () => {
    const l = new TokenBucketLimiter(600, 60_000);
    for (let i = 0; i < 600; i++) expect(l.take("k", 0).allowed).toBe(true);
    const denied = l.take("k", 0);
    expect(denied).toMatchObject({ allowed: false, remaining: 0 });
    expect(denied.retryAfterSec).toBe(1);
    expect(l.take("other", 0).allowed).toBe(true);
    expect(l.take("k", 100).allowed).toBe(true); // 0.1 s refills one token
    expect(l.take("k", 100).allowed).toBe(false);
  });
});
