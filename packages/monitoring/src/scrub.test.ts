import { describe, expect, it } from "vitest";
import { FILTERED, isSecretKey, LOG_REDACT_PATHS, scrub, scrubHeaders, scrubString } from "./scrub";

describe("isSecretKey", () => {
  it.each([
    "authorization",
    "Authorization",
    "cookie",
    "x-api-key",
    "password",
    "otp",
    "OTP",
    "token",
    "accessToken",
    "refresh_token",
    "guestToken",
    "keySecret",
    "PLATFORM_RAZORPAY_KEY_SECRET",
    "whatsappToken",
    "webhook_secret",
    "privateKey",
    "x-razorpay-signature",
    "DATABASE_URL",
    "dsn",
    "pin",
  ])("treats %s as secret", (k) => expect(isSecretKey(k)).toBe(true));

  it.each(["id", "tenantId", "name", "phone", "route", "statusCode", "tokens_used_count", "opinion", "spinner", "keyId", "code"])(
    "keeps %s",
    (k) => expect(isSecretKey(k)).toBe(false),
  );
});

describe("scrubString", () => {
  it("masks bearer tokens and JWTs", () => {
    expect(scrubString("Authorization: Bearer abc.def-123456")).toBe(`Authorization: Bearer ${FILTERED}`);
    expect(scrubString("jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl here")).toBe(`jwt ${FILTERED} here`);
  });

  it("masks API keys", () => {
    expect(scrubString("key sk_live_ABCDEF1234567890 rejected")).toBe(`key ${FILTERED} rejected`);
  });

  it("masks credentials in URLs", () => {
    expect(scrubString("connect postgres://srikit:hunter2@db:5432/srikit failed")).toBe(
      `connect postgres://srikit:${FILTERED}@db:5432/srikit failed`,
    );
  });

  it("masks secret query params", () => {
    expect(scrubString("/v1/x?token=abc123&page=2&otp=123456")).toBe(`/v1/x?token=${FILTERED}&page=2&otp=${FILTERED}`);
  });

  it("masks OTPs in messages", () => {
    expect(scrubString("Your OTP is 482913")).toBe(`Your OTP is ${FILTERED}`);
    expect(scrubString("otp: 4829 sent")).toBe(`otp: ${FILTERED} sent`);
    expect(scrubString("verification code 123456")).toBe(`verification code ${FILTERED}`);
  });

  it("masks password=… pairs", () => {
    expect(scrubString("password=hunter2 user=a")).toBe(`password=${FILTERED} user=a`);
  });

  it("leaves ordinary text alone", () => {
    const s = "Invoice INV-0042 for ₹999 failed: relation \"orders\" does not exist (status 500)";
    expect(scrubString(s)).toBe(s);
  });
});

describe("scrub", () => {
  it("filters secret keys at any depth and keeps the rest", () => {
    const input = {
      tenantId: "t1",
      body: { phone: "+919999000001", otp: "123456", nested: { accessToken: "x", ok: 1 } },
      headers: { authorization: "Bearer zzz", "user-agent": "curl" },
      list: [{ password: "p" }, { name: "n" }],
    };
    expect(scrub(input)).toEqual({
      tenantId: "t1",
      body: { phone: "+919999000001", otp: FILTERED, nested: { accessToken: FILTERED, ok: 1 } },
      headers: { authorization: FILTERED, "user-agent": "curl" },
      list: [{ password: FILTERED }, { name: "n" }],
    });
  });

  it("does not mutate the input", () => {
    const input = { token: "abc" };
    scrub(input);
    expect(input.token).toBe("abc");
  });

  it("handles cycles, errors, dates, buffers and depth", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    const err = Object.assign(new Error("boom token=abc"), { secret: "s", status: 500 });
    const out = scrub({ a, err, at: new Date("2026-01-01T00:00:00Z"), buf: Buffer.from("xyz"), fn: () => 1 }) as Record<string, any>;
    expect(out.a.self).toBe("[Circular]");
    expect(out.err.message).toBe(`boom token=${FILTERED}`);
    expect(out.err.secret).toBe(FILTERED);
    expect(out.err.status).toBe(500);
    expect(out.at).toBe("2026-01-01T00:00:00.000Z");
    expect(out.buf).toBe("[Binary 3 bytes]");
    expect("fn" in out).toBe(false);
    expect(scrub({ a: { b: { c: 1 } } }, { maxDepth: 2 })).toEqual({ a: { b: "[Truncated]" } });
  });

  it("supports extra keys", () => {
    expect(scrub({ aadhaar: "1234", x: 1 }, { extraKeys: ["aadhaar"] })).toEqual({ aadhaar: FILTERED, x: 1 });
  });
});

describe("scrubHeaders", () => {
  it("filters auth headers and flattens arrays", () => {
    expect(
      scrubHeaders({ Authorization: "Bearer a", cookie: "sid=1", "x-api-key": "k", accept: ["a", "b"], "x-request-id": "r1" }),
    ).toEqual({ Authorization: FILTERED, cookie: FILTERED, "x-api-key": FILTERED, accept: "a, b", "x-request-id": "r1" });
  });
});

describe("LOG_REDACT_PATHS", () => {
  it("covers the request auth headers and never redacts err.code", () => {
    expect(LOG_REDACT_PATHS).toContain("req.headers.authorization");
    expect(LOG_REDACT_PATHS).toContain("req.headers.cookie");
    expect(LOG_REDACT_PATHS).toContain("*.otp");
    expect(LOG_REDACT_PATHS).not.toContain("*.code");
  });
});
