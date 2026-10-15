import { AppError } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { describe, expect, it, vi } from "vitest";
import { createAuth } from "./index";

// These tests only exercise paths that fail before touching the database.
const db = {} as Db;
const base = {
  db,
  otp: { sendOtp: vi.fn() },
  memberships: { rolesFor: vi.fn(async () => []) },
};

describe("AuthService (no database)", () => {
  it("creates the auth module", () => {
    const { module, contextHook } = createAuth({ ...base, config: { sessionTtlDays: 30, otpTtlMinutes: 10 } });
    expect(module.id).toBe("auth");
    expect(module.tables).toHaveProperty("users");
    expect(typeof contextHook).toBe("function");
  });

  it("rejects Google sign-in when no client ids are configured", async () => {
    const { service } = createAuth({ ...base, config: { sessionTtlDays: 30, otpTtlMinutes: 10 } });
    await expect(service.signInWithGoogle({ idToken: "x".repeat(20) })).rejects.toMatchObject({
      status: 400,
      message: "Google sign-in is not configured",
    });
  });

  it("maps verifier failures and unverified emails to 400", async () => {
    const failing = createAuth({
      ...base,
      config: { sessionTtlDays: 30, otpTtlMinutes: 10, googleClientIds: ["web"] },
      verifyGoogleToken: async () => {
        throw new Error("bad signature");
      },
    });
    await expect(failing.service.signInWithGoogle({ idToken: "t" })).rejects.toBeInstanceOf(AppError);

    const verifier = vi.fn(async () => ({ sub: "1", email: "a@b.in", email_verified: false }));
    const unverified = createAuth({
      ...base,
      config: { sessionTtlDays: 30, otpTtlMinutes: 10, googleClientIds: ["web", "android"] },
      verifyGoogleToken: verifier,
    });
    await expect(unverified.service.signInWithGoogle({ idToken: "t" })).rejects.toMatchObject({ status: 400 });
    expect(verifier).toHaveBeenCalledWith("t", ["web", "android"]);
  });

  it("validates OTP targets and channels", async () => {
    const { service } = createAuth({ ...base, config: { sessionTtlDays: 30, otpTtlMinutes: 10 } });
    await expect(service.requestOtp({ target: "nope", locale: "en" })).rejects.toMatchObject({ status: 400 });
    await expect(service.requestOtp({ target: "9876543210", channel: "email", locale: "en" })).rejects.toMatchObject({
      status: 400,
    });
    await expect(service.requestOtp({ target: "a@b.in", channel: "sms", locale: "en" })).rejects.toMatchObject({
      status: 400,
    });
  });

  it("authenticate returns null for missing tokens", async () => {
    const { service } = createAuth({ ...base, config: { sessionTtlDays: 30, otpTtlMinutes: 10 } });
    expect(await service.authenticate(null)).toBeNull();
    expect(await service.authenticate("")).toBeNull();
  });
});

describe("AuthService test OTP (dev only)", () => {
  const testOtp = { code: "123456", targets: ["+9199990*", "e2e-*@example.com"] };
  const config = { sessionTtlDays: 30, otpTtlMinutes: 10, testOtp };

  /** A db whose every call fails, so these tests prove the test-target paths never touch the OTP table. */
  const untouchable = new Proxy({}, { get: () => { throw new Error("db touched"); } }) as Db;

  /** Enough of the db for completeSignIn/createSession: update(users)...returning() and insert(sessions)...returning(). */
  function signInDb() {
    const row = {
      id: "u1", phone: "+919999000101", email: null, name: null, avatarUrl: null, locale: "en",
      platformRoles: [], status: "active", createdAt: new Date(), lastLoginAt: new Date(), updatedAt: new Date(), deletedAt: null,
    };
    const session = { id: "s1", userId: "u1", ip: null, userAgent: null, createdAt: new Date(), lastSeenAt: new Date(), expiresAt: new Date(Date.now() + 86_400_000) };
    const update = vi.fn(() => ({ set: () => ({ where: () => ({ returning: async () => [row] }) }) }));
    const insert = vi.fn(() => ({ values: () => ({ returning: async () => [session] }) }));
    const select = vi.fn(() => { throw new Error("otp table read"); });
    return { db: { update, insert, select } as unknown as Db, row, update, insert, select };
  }

  it("requestOtp for a test target sends nothing, stores nothing and has no cooldown or hourly cap", async () => {
    const sendOtp = vi.fn();
    const { service } = createAuth({ ...base, db: untouchable, otp: { sendOtp }, config });
    for (let i = 0; i < 12; i++) {
      const r = await service.requestOtp({ target: "+91 99990 00101", locale: "en" });
      expect(r).toMatchObject({ channel: "sms", resendInSeconds: 0 });
    }
    await service.requestOtp({ target: "E2E-Owner@example.com", locale: "en" });
    expect(sendOtp).not.toHaveBeenCalled();
  });

  it("verifyOtp accepts the fixed code for a test target and rejects any other code", async () => {
    const { db, select } = signInDb();
    const { service } = createAuth({ ...base, db, config });
    const user = { id: "u1", phone: "+919999000101", email: null, name: null, avatarUrl: null, locale: "en", platformRoles: [], status: "active" as const, createdAt: new Date() };
    const find = vi.spyOn(service, "findOrCreateByTarget").mockResolvedValue({ user, isNewUser: true });
    const r = await service.verifyOtp({ target: "9999000101", code: "123 456" });
    expect(r.token).toMatch(/.{20,}/);
    expect(r.isNewUser).toBe(true);
    expect(find).toHaveBeenCalledWith("+919999000101", { name: null });
    await expect(service.verifyOtp({ target: "9999000101", code: "654321" })).rejects.toMatchObject({ status: 400, message: "Incorrect code" });
    expect(select).not.toHaveBeenCalled();
  });

  it("other targets keep the normal flow: the fixed code is not accepted", async () => {
    const select = vi.fn(() => ({ from: () => ({ where: () => ({ orderBy: () => ({ limit: async () => [] }) }) }) }));
    const { service } = createAuth({ ...base, db: { select } as unknown as Db, config });
    expect(service.isTestTarget("+919876543210")).toBe(false);
    await expect(service.verifyOtp({ target: "9876543210", code: "123456" })).rejects.toMatchObject({ status: 400 });
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("is off without config, with a malformed code or with no targets", () => {
    for (const cfg of [undefined, { code: "12ab56", targets: ["+9199990*"] }, { code: "123456", targets: [" "] }]) {
      const { service } = createAuth({ ...base, config: { sessionTtlDays: 30, otpTtlMinutes: 10, testOtp: cfg } });
      expect(service.isTestTarget("+919999000101")).toBe(false);
    }
  });
});
