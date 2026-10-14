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
