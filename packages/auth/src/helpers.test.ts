import { describe, expect, it } from "vitest";
import {
  detectTarget,
  maskTarget,
  normalizeEmail,
  normalizePhone,
  otpHash,
  otpRetryAfter,
  parseBearer,
  parseCookies,
  sessionCookie,
} from "./helpers";

describe("normalizePhone", () => {
  it.each([
    ["9876543210", "+919876543210"],
    ["98765 43210", "+919876543210"],
    ["+91-98765-43210", "+919876543210"],
    ["+91 98765 43210", "+919876543210"],
    ["09876543210", "+919876543210"],
    ["919876543210", "+919876543210"],
    ["0091 98765 43210", "+919876543210"],
    ["(987) 654-3210", "+919876543210"],
    ["6000000000", "+916000000000"],
    ["9198765432", "+919198765432"],
  ])("%s → %s", (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it.each(["", "   ", "12345", "5876543210", "+91 5876543210", "98765432", "987654321012", "98765abc10", "+91987654321"])(
    "rejects %j",
    (input) => {
      expect(normalizePhone(input)).toBeNull();
    },
  );

  it("accepts other international numbers in E.164", () => {
    expect(normalizePhone("+1 (415) 555-2671")).toBe("+14155552671");
    expect(normalizePhone("+44 7911 123456")).toBe("+447911123456");
  });

  it("uses a different default country", () => {
    expect(normalizePhone("4155552671", "1")).toBe("+14155552671");
  });
});

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  Ravi.K@Gmail.COM ")).toBe("ravi.k@gmail.com");
  });
  it.each(["", "ravi", "ravi@", "@gmail.com", "ravi@gmail", "ra vi@gmail.com"])("rejects %j", (v) => {
    expect(normalizeEmail(v)).toBeNull();
  });
});

describe("detectTarget", () => {
  it("detects email and phone", () => {
    expect(detectTarget("A@B.in")).toEqual({ kind: "email", value: "a@b.in" });
    expect(detectTarget("98765 43210")).toEqual({ kind: "phone", value: "+919876543210" });
  });
  it("returns null for garbage", () => {
    expect(detectTarget("hello")).toBeNull();
    expect(detectTarget("x@y")).toBeNull();
  });
});

describe("parseBearer", () => {
  it("extracts the token", () => {
    expect(parseBearer("Bearer abc.DEF_123-x")).toBe("abc.DEF_123-x");
    expect(parseBearer("bearer   tok ")).toBe("tok");
    expect(parseBearer(["Bearer a"])).toBe("a");
  });
  it("rejects other schemes and junk", () => {
    expect(parseBearer(undefined)).toBeNull();
    expect(parseBearer("")).toBeNull();
    expect(parseBearer("Basic abc")).toBeNull();
    expect(parseBearer("Bearer")).toBeNull();
    expect(parseBearer("Bearer a b")).toBeNull();
  });
});

describe("cookies", () => {
  it("parses a Cookie header", () => {
    expect(parseCookies('a=1; sr_session=tok%2Fx; b="q"; a=2')).toEqual({ a: "1", sr_session: "tok/x", b: "q" });
    expect(parseCookies(undefined)).toEqual({});
  });
  it("serialises the session cookie", () => {
    const c = sessionCookie("sr_session", "tok", { maxAgeSeconds: 3600, secure: true });
    expect(c).toBe("sr_session=tok; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600; Secure");
    const cleared = sessionCookie("sr_session", "", { maxAgeSeconds: 0, secure: false });
    expect(cleared).toContain("Max-Age=0");
    expect(cleared).toContain("Expires=");
    expect(cleared).not.toContain("Secure");
  });
});

describe("maskTarget", () => {
  it("masks phones and emails", () => {
    expect(maskTarget("+919876543210")).toBe("+91******3210");
    expect(maskTarget("ravi.k@gmail.com")).toBe("ra****@gmail.com");
    expect(maskTarget("a@b.in")).toBe("a*@b.in");
  });
});

describe("otpHash", () => {
  it("binds the code to the target", () => {
    expect(otpHash("123456", "+919876543210")).not.toBe(otpHash("123456", "+919876543211"));
    expect(otpHash("123456", "a@b.in")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("otpRetryAfter", () => {
  const now = new Date("2026-01-01T10:00:00Z");
  const ago = (s: number) => new Date(now.getTime() - s * 1000);
  const base = { now, resendSeconds: 30, maxPerHour: 5 };

  it("allows the first code", () => {
    expect(otpRetryAfter({ ...base, recent: [] })).toBe(0);
  });
  it("enforces the resend cooldown", () => {
    expect(otpRetryAfter({ ...base, recent: [ago(10)] })).toBe(20);
    expect(otpRetryAfter({ ...base, recent: [ago(31)] })).toBe(0);
  });
  it("enforces the hourly cap", () => {
    const recent = [ago(3000), ago(2000), ago(1000), ago(500), ago(100)];
    // Oldest code (3000s ago) leaves the window in 600s.
    expect(otpRetryAfter({ ...base, recent })).toBe(600);
    expect(otpRetryAfter({ ...base, recent: recent.slice(1) })).toBe(0);
  });
  it("ignores codes older than an hour", () => {
    expect(otpRetryAfter({ ...base, recent: [ago(4000), ago(3700), ago(3650), ago(3610), ago(3601)] })).toBe(0);
  });
});
