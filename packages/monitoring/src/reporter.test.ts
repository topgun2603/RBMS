import { describe, expect, it, vi } from "vitest";
import { buildEnvelope, buildEvent, createErrorReporter, parseDsn, parseStack } from "./reporter";
import { FILTERED } from "./scrub";

const makeLog = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });
const DSN = "https://pubkey123@o1.ingest.example.io/42";

describe("parseDsn", () => {
  it("builds the envelope URL", () => {
    expect(parseDsn(DSN)).toEqual({ publicKey: "pubkey123", projectId: "42", envelopeUrl: "https://o1.ingest.example.io/api/42/envelope/" });
    expect(parseDsn("https://k@host.example/sub/7")?.envelopeUrl).toBe("https://host.example/sub/api/7/envelope/");
  });
  it("rejects malformed DSNs", () => {
    expect(parseDsn("not a url")).toBeNull();
    expect(parseDsn("https://host.example/42")).toBeNull();
  });
});

describe("parseStack", () => {
  it("parses V8 frames oldest first", () => {
    const frames = parseStack("Error: x\n    at inner (/app/src/a.ts:10:5)\n    at /app/node_modules/fastify/lib/x.js:1:2");
    expect(frames).toEqual([
      { function: "<anonymous>", filename: "/app/node_modules/fastify/lib/x.js", lineno: 1, colno: 2, in_app: false },
      { function: "inner", filename: "/app/src/a.ts", lineno: 10, colno: 5, in_app: true },
    ]);
  });
});

describe("buildEvent", () => {
  it("attaches request and tenant ids and scrubs secrets", () => {
    const err = new Error("db failed for postgres://u:pw@db/x token=abc");
    const ev = buildEvent(
      err,
      {
        requestId: "req-1",
        tenantId: "t-1",
        userId: "u-1",
        route: "/v1/invoices/:id",
        method: "POST",
        url: "/v1/invoices/9?otp=123456",
        statusCode: 500,
        headers: { authorization: "Bearer secret-token-value", cookie: "sid=1", "user-agent": "jest" },
        extra: { body: { otp: "123456", phone: "+91999" }, apiKey: "sk_live_abcdefgh123" },
      },
      { environment: "test", release: "abc123" },
      "e".repeat(32),
      new Date("2026-10-16T00:00:00Z"),
    );
    expect(ev.tags).toEqual({ request_id: "req-1", tenant_id: "t-1", route: "/v1/invoices/:id", method: "POST", status_code: "500" });
    expect(ev.user).toEqual({ id: "u-1" });
    expect(ev.request?.headers).toEqual({ authorization: FILTERED, cookie: FILTERED, "user-agent": "jest" });
    expect(ev.request?.url).toBe(`/v1/invoices/9?otp=${FILTERED}`);
    expect(ev.extra).toEqual({ body: { otp: FILTERED, phone: "+91999" }, apiKey: FILTERED });
    const value = ev.exception.values[0]!.value;
    expect(value).not.toContain("pw@");
    expect(value).not.toContain("abc");
    expect(ev.release).toBe("abc123");
    expect(ev.timestamp).toBe(Date.parse("2026-10-16T00:00:00Z") / 1000);
    const serialized = JSON.stringify(ev);
    for (const secret of ["secret-token-value", "123456", "sid=1", "sk_live_abcdefgh123", ":pw@"]) expect(serialized).not.toContain(secret);
  });

  it("includes the cause chain (innermost first) and handles non-errors", () => {
    const ev = buildEvent(new Error("outer", { cause: new TypeError("inner") }), {}, {}, "1".repeat(32));
    expect(ev.exception.values.map((v) => v.type)).toEqual(["TypeError", "Error"]);
    expect(buildEvent("plain string", {}, {}, "1".repeat(32)).exception.values[0]!.value).toBe("plain string");
  });
});

describe("buildEnvelope", () => {
  it("is three newline-delimited JSON lines", () => {
    const lines = buildEnvelope({ event_id: "abc" }, DSN, new Date("2026-10-16T00:00:00Z")).split("\n");
    expect(lines.map((l) => JSON.parse(l))).toEqual([
      { event_id: "abc", sent_at: "2026-10-16T00:00:00.000Z", dsn: DSN },
      { type: "event" },
      { event_id: "abc" },
    ]);
  });
});

describe("createErrorReporter", () => {
  it("console driver: logs scrubbed and never calls fetch", () => {
    const log = makeLog();
    const fetch = vi.fn();
    const r = createErrorReporter({ log, fetch: fetch as never });
    expect(r.driver).toBe("console");
    const id = r.capture(new Error("Bearer abcdefghijk failed"), { requestId: "r1", tenantId: "t1" });
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(fetch).not.toHaveBeenCalled();
    const [payload, msg] = log.error.mock.calls[0]!;
    expect(payload).toMatchObject({ eventId: id, request_id: "r1", tenant_id: "t1" });
    expect(JSON.stringify(payload) + msg).not.toContain("abcdefghijk");
  });

  it("sentry driver: posts an envelope with the auth header", async () => {
    const log = makeLog();
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    const r = createErrorReporter({ log, fetch: fetch as never, config: { dsn: DSN, environment: "production" } });
    expect(r.driver).toBe("sentry");
    const id = r.capture(new Error("boom"), { tenantId: "t9", headers: { authorization: "Bearer zzzzzzzz" } });
    expect(await r.flush()).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0]! as unknown as [string, RequestInit];
    expect(url).toBe("https://o1.ingest.example.io/api/42/envelope/");
    expect((init.headers as Record<string, string>)["x-sentry-auth"]).toContain("sentry_key=pubkey123");
    const body = String(init.body);
    expect(body).toContain(id);
    expect(body).toContain('"tenant_id":"t9"');
    expect(body).not.toContain("zzzzzzzz");
  });

  it("never throws when the send fails", async () => {
    const log = makeLog();
    const fetch = vi.fn(async () => {
      throw new Error("network down");
    });
    const r = createErrorReporter({ log, fetch: fetch as never, config: { dsn: DSN } });
    expect(() => r.capture(new Error("x"))).not.toThrow();
    await r.flush();
    expect(log.warn).toHaveBeenCalledWith(expect.objectContaining({ reason: "Error" }), "monitoring: error report not sent");
  });

  it("falls back to console on a malformed DSN", () => {
    const log = makeLog();
    expect(createErrorReporter({ log, config: { dsn: "nope" } }).driver).toBe("console");
    expect(log.warn).toHaveBeenCalled();
  });

  it("caps in-flight sends", async () => {
    const log = makeLog();
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fetch = vi.fn(async () => {
      await gate;
      return new Response("{}");
    });
    const r = createErrorReporter({ log, fetch: fetch as never, config: { dsn: DSN, maxInFlight: 2 } });
    r.capture(new Error("1"));
    r.capture(new Error("2"));
    r.capture(new Error("3"));
    expect(fetch).toHaveBeenCalledTimes(2);
    release();
    expect(await r.flush()).toBe(true);
  });
});
