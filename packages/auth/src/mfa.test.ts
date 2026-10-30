import type { Db } from "@rbms/db";
import { describe, expect, it, vi } from "vitest";
import { createAuth } from "./index";
import { isMfaPending } from "./service";
import {
  base32Decode,
  base32Encode,
  createSecretBox,
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  hotp,
  looksLikeRecoveryCode,
  normalizeRecoveryCode,
  otpauthUri,
  signMfaChallenge,
  totpCode,
  verifyMfaChallenge,
  verifyTotp,
} from "./totp";
import { audienceOptionsSchema, readAudienceOptions } from "./sign-in-options";

// RFC 6238 appendix B: the SHA-1 secret is the ASCII string "12345678901234567890"; 8-digit codes at fixed times.
const RFC_SECRET = base32Encode(Buffer.from("12345678901234567890"));

describe("TOTP (RFC 6238)", () => {
  it("matches the RFC test vectors", () => {
    const secret = Buffer.from("12345678901234567890");
    expect(hotp(secret, Math.floor(59 / 30), 8)).toBe("94287082");
    expect(hotp(secret, Math.floor(1111111109 / 30), 8)).toBe("07081804");
    expect(hotp(secret, Math.floor(1234567890 / 30), 8)).toBe("89005924");
    expect(hotp(secret, Math.floor(20000000000 / 30), 8)).toBe("65353130");
  });

  it("round-trips base32", () => {
    const s = generateTotpSecret();
    expect(s).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Encode(base32Decode(s))).toBe(s);
    expect(base32Decode(RFC_SECRET).toString()).toBe("12345678901234567890");
    expect(() => base32Decode("not*base32")).toThrow();
  });

  it("accepts the current and adjacent steps, rejects others and replays", () => {
    const at = 1_700_000_000_000;
    const code = totpCode(RFC_SECRET, at);
    expect(verifyTotp(RFC_SECRET, code, { atMs: at })).not.toBeNull();
    expect(verifyTotp(RFC_SECRET, code, { atMs: at + 30_000 })).not.toBeNull();
    expect(verifyTotp(RFC_SECRET, code, { atMs: at + 120_000 })).toBeNull();
    expect(verifyTotp(RFC_SECRET, totpCode(RFC_SECRET, at - 30_000), { atMs: at, window: 0 })).toBeNull();
    const step = verifyTotp(RFC_SECRET, code, { atMs: at })!;
    expect(verifyTotp(RFC_SECRET, code, { atMs: at, lastStep: step })).toBeNull();
    expect(verifyTotp(RFC_SECRET, "12345", { atMs: at })).toBeNull();
    expect(verifyTotp(RFC_SECRET, "abcdef", { atMs: at })).toBeNull();
  });

  it("builds the otpauth link", () => {
    const u = otpauthUri({ secret: "ABC", account: "a@b.in", issuer: "RBMS" });
    expect(u).toBe("otpauth://totp/RBMS:a%40b.in?secret=ABC&issuer=RBMS&algorithm=SHA1&digits=6&period=30");
  });
});

describe("recovery codes", () => {
  it("makes 10 distinct codes and matches them whatever the typing", () => {
    const codes = generateRecoveryCodes();
    expect(codes).toHaveLength(10);
    expect(new Set(codes).size).toBe(10);
    expect(codes[0]).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const c = codes[0]!;
    expect(hashRecoveryCode("p", c)).toBe(hashRecoveryCode("p", c.toLowerCase().replace("-", " ")));
    expect(hashRecoveryCode("p", c)).not.toBe(hashRecoveryCode("q", c));
    expect(normalizeRecoveryCode("ab-cd ef12")).toBe("ABCDEF12");
  });
  it("tells recovery codes from authenticator codes", () => {
    expect(looksLikeRecoveryCode("K7QM-2XPD")).toBe(true);
    expect(looksLikeRecoveryCode("123456")).toBe(false);
    expect(looksLikeRecoveryCode("123 456")).toBe(false);
  });
});

describe("secret box and challenge token", () => {
  it("encrypts at rest and refuses another key or tampering", () => {
    const box = createSecretBox("k1");
    const enc = box.encrypt("JBSWY3DPEHPK3PXP");
    expect(enc).not.toContain("JBSWY3DP");
    expect(box.decrypt(enc)).toBe("JBSWY3DPEHPK3PXP");
    expect(() => createSecretBox("k2").decrypt(enc)).toThrow();
    expect(() => box.decrypt(enc.slice(0, -2) + "xx")).toThrow();
  });

  it("signs a challenge that expires and can't be forged", () => {
    const exp = new Date(Date.now() + 60_000);
    const t = signMfaChallenge("s", { userId: "u1", tenantId: "t1", purpose: "verify", isNewUser: false, expiresAt: exp });
    expect(verifyMfaChallenge("s", t)).toMatchObject({ userId: "u1", tenantId: "t1", purpose: "verify", isNewUser: false });
    expect(verifyMfaChallenge("other", t)).toBeNull();
    expect(verifyMfaChallenge("s", t, new Date(Date.now() + 120_000))).toBeNull();
    const [p, sig] = t.split(".");
    const forged = Buffer.from(JSON.stringify({ u: "admin", t: null, p: "verify", n: false, exp: Math.floor(exp.getTime() / 1000) })).toString("base64url");
    expect(verifyMfaChallenge("s", `${forged}.${sig}`)).toBeNull();
    expect(verifyMfaChallenge("s", `${p}.`)).toBeNull();
  });
});

describe("sign-in options: require 2FA", () => {
  it("keeps requireMfa only when true", () => {
    const fb = { methods: ["sms" as const], default: "sms" as const };
    expect(readAudienceOptions({ methods: ["sms", "google"], default: "google", requireMfa: true }, fb)).toEqual({ methods: ["sms", "google"], default: "google", requireMfa: true });
    expect(readAudienceOptions({ methods: ["sms"], default: "sms", requireMfa: "yes" }, fb)).toEqual({ methods: ["sms"], default: "sms" });
    expect(audienceOptionsSchema.safeParse({ methods: ["sms"], default: "sms", requireMfa: true }).success).toBe(true);
  });
});

describe("sign-in second step", () => {
  const user = { id: "u1", phone: "+919876543210", email: null, name: null, avatarUrl: null, locale: "en", platformRoles: [], status: "active" as const, createdAt: new Date() };
  const row = { ...user, lastLoginAt: new Date(), updatedAt: new Date(), deletedAt: null };
  const session = { id: "s1", userId: "u1", ip: null, userAgent: null, createdAt: new Date(), lastSeenAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) };
  const okDb = {
    update: () => ({ set: () => ({ where: () => ({ returning: async () => [row] }) }) }),
    insert: () => ({ values: () => ({ returning: async () => [session] }) }),
  } as unknown as Db;
  const make = (config: Record<string, unknown> = {}, roles: string[] = []) => {
    const rolesFor = vi.fn(async () => roles);
    const { service } = createAuth({
      db: okDb,
      otp: { sendOtp: vi.fn() },
      memberships: { rolesFor },
      config: { sessionTtlDays: 30, otpTtlMinutes: 10, mfaSecret: "test-secret-0123456789", ...config },
    });
    vi.spyOn(service, "findOrCreateByTarget").mockResolvedValue({ user, isNewUser: false });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const signIn = (target: string, input: Record<string, unknown> = {}) => (service as any).signInTarget(target, input);
    return { service, signIn, rolesFor };
  };

  it("asks for the second step when the user has 2FA on, and opens no session", async () => {
    const { service, signIn } = make();
    vi.spyOn(service.mfa!, "isEnabled").mockResolvedValue(true);
    const r = await signIn("+919876543210");
    expect(isMfaPending(r)).toBe(true);
    expect(r).toMatchObject({ mfaRequired: true, enrolRequired: false });
    expect(r.token).toBeUndefined();
    expect(service.readMfaChallenge(r.challengeToken, "verify").userId).toBe("u1");
    expect(() => service.readMfaChallenge(r.challengeToken, "enrol")).toThrow();
  });

  it("signs in straight away without 2FA", async () => {
    const { service, signIn } = make();
    vi.spyOn(service.mfa!, "isEnabled").mockResolvedValue(false);
    const r = await signIn("+919876543210");
    expect(isMfaPending(r)).toBe(false);
    expect(r.token).toMatch(/.{20,}/);
  });

  it("test identities (TEST_OTP) skip 2FA", async () => {
    const { service, signIn } = make({ testOtp: { code: "123456", targets: ["+9198765*"] } });
    const spy = vi.spyOn(service.mfa!, "isEnabled").mockResolvedValue(true);
    const r = await signIn("+919876543210");
    expect(isMfaPending(r)).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it("a user with 2FA on is challenged whatever audience the client claims (x-auth-audience can't waive it)", async () => {
    for (const policy of [{ tenantId: "t1", audience: "customer" as const }, { tenantId: "t1", audience: "staff" as const }, null]) {
      const { service, signIn } = make({}, ["owner"]);
      vi.spyOn(service.mfa!, "isEnabled").mockResolvedValue(true);
      const r = await signIn("+919876543210", { policy });
      expect(isMfaPending(r)).toBe(true);
      expect(r).toMatchObject({ enrolRequired: false });
    }
  });

  it("shoppers with 2FA off on a storefront are not asked", async () => {
    const { service, signIn } = make({}, []);
    vi.spyOn(service.mfa!, "isEnabled").mockResolvedValue(false);
    vi.spyOn(service, "getSignInOptions").mockResolvedValue({
      staff: { methods: ["sms"], default: "sms", requireMfa: true },
      customer: { methods: ["sms"], default: "sms" },
    });
    const r = await signIn("+919876543210", { policy: { tenantId: "t1", audience: "customer" } });
    expect(isMfaPending(r)).toBe(false);
  });

  it("a staff owner can't skip the shop's required setup by claiming the customer audience", async () => {
    const { service, signIn } = make({}, ["owner"]);
    vi.spyOn(service.mfa!, "isEnabled").mockResolvedValue(false);
    vi.spyOn(service, "getSignInOptions").mockResolvedValue({
      staff: { methods: ["sms"], default: "sms", requireMfa: true },
      customer: { methods: ["sms"], default: "sms" },
    });
    const r = await signIn("+919876543210", { policy: { tenantId: "t1", audience: "customer" } });
    expect(r).toMatchObject({ mfaRequired: true, enrolRequired: true });
  });

  it("records on the session whether it passed 2FA", async () => {
    const values: Array<Record<string, unknown>> = [];
    const db = {
      update: () => ({ set: () => ({ where: () => ({ returning: async () => [row] }) }) }),
      insert: () => ({ values: (v: Record<string, unknown>) => (values.push(v), { returning: async () => [{ ...session, mfaAt: v.mfaAt }] }) }),
    } as unknown as Db;
    const { service } = createAuth({
      db,
      otp: { sendOtp: vi.fn() },
      memberships: { rolesFor: async () => [] },
      config: { sessionTtlDays: 30, otpTtlMinutes: 10, mfaSecret: "test-secret-0123456789" },
    });
    vi.spyOn(service, "findOrCreateByTarget").mockResolvedValue({ user, isNewUser: false });
    vi.spyOn(service, "getUser").mockResolvedValue(user);
    const isEnabled = vi.spyOn(service.mfa!, "isEnabled").mockResolvedValue(false);
    // One factor: no mfaAt, even if a caller slips one in.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (service as any).signInTarget("+919876543210", { mfaAt: new Date() });
    expect(values.at(-1)!.mfaAt).toBeNull();
    // Second step passed: mfaAt is set.
    isEnabled.mockResolvedValue(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pending = await (service as any).signInTarget("+919876543210", {});
    vi.spyOn(service.mfa!, "verifyCode").mockResolvedValue({ method: "totp", recoveryCodesLeft: 10 });
    await service.verifyMfaSignIn({ challengeToken: pending.challengeToken, code: "123456" });
    expect(values.at(-1)!.mfaAt).toBeInstanceOf(Date);
  });

  it("the shop policy forces setup for owners, admins and managers only", async () => {
    const policy = { tenantId: "t1", audience: "staff" as const };
    for (const [roles, expected] of [[["owner"], true], [["manager"], true], [["cashier"], false], [[], false]] as const) {
      const { service, signIn } = make({}, [...roles]);
      vi.spyOn(service.mfa!, "isEnabled").mockResolvedValue(false);
      vi.spyOn(service, "getSignInOptions").mockResolvedValue({
        staff: { methods: ["sms"], default: "sms", requireMfa: true },
        customer: { methods: ["sms"], default: "sms" },
      });
      const r = await signIn("+919876543210", { policy });
      expect(isMfaPending(r)).toBe(expected);
      if (expected) expect(r).toMatchObject({ enrolRequired: true });
    }
  });

  it("is off entirely without mfaSecret", async () => {
    const { service, signIn } = make({ mfaSecret: undefined });
    expect(service.mfa).toBeNull();
    const r = await signIn("+919876543210");
    expect(isMfaPending(r)).toBe(false);
    await expect(service.beginMfaEnrol("u1")).rejects.toMatchObject({ status: 503 });
    expect(await service.mfaStatus("u1")).toMatchObject({ available: false, enabled: false });
  });

  it("an enrol challenge can't be used as a verify challenge", async () => {
    const { service } = make();
    const t = signMfaChallenge("nope", { userId: "u1", tenantId: null, purpose: "enrol", isNewUser: false, expiresAt: new Date(Date.now() + 1000) });
    expect(() => service.readMfaChallenge(t)).toThrow(/expired/);
  });
});
