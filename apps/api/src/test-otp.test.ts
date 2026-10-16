import { describe, expect, it } from "vitest";
import { phoneAuthConfig, testOtpConfig } from "./test-otp";

describe("testOtpConfig", () => {
  const dev = { NODE_ENV: "development" as const, TEST_OTP_CODE: "123456", TEST_OTP_TARGETS: "+9199990*, e2e-*@example.com" };

  it("is off when no code is set", () => {
    expect(testOtpConfig({ ...dev, TEST_OTP_CODE: undefined })).toEqual({ testOtp: undefined, note: null });
  });

  it("passes code and trimmed targets outside production, with a log line", () => {
    const r = testOtpConfig(dev);
    expect(r.testOtp).toEqual({ code: "123456", targets: ["+9199990*", "e2e-*@example.com"] });
    expect(r.note).toMatch(/test OTPs on \(development\)/);
    expect(testOtpConfig({ ...dev, NODE_ENV: "test" }).testOtp?.code).toBe("123456");
  });

  it("is never honoured in production", () => {
    const r = testOtpConfig({ ...dev, NODE_ENV: "production" });
    expect(r.testOtp).toBeUndefined();
    expect(r.note).toMatch(/ignored in production/);
  });

  it("needs at least one target; a bare * is dropped", () => {
    expect(testOtpConfig({ ...dev, TEST_OTP_TARGETS: " , *" }).testOtp).toBeUndefined();
    expect(testOtpConfig({ ...dev, TEST_OTP_TARGETS: undefined }).testOtp).toBeUndefined();
  });
});

describe("phoneAuthConfig", () => {
  const base = { NODE_ENV: "production" as const, FIREBASE_PROJECT_ID: "srikit-prod", MSG91_AUTH_KEY: undefined, MSG91_SENDER_ID: undefined };

  it("is off without a project id", () => {
    expect(phoneAuthConfig({ ...base, FIREBASE_PROJECT_ID: undefined })).toEqual({ firebaseProjectId: undefined, smsOtpDisabled: false, note: null });
  });

  it("refuses console SMS codes in production when Firebase is on", () => {
    const r = phoneAuthConfig(base);
    expect(r).toMatchObject({ firebaseProjectId: "srikit-prod", smsOtpDisabled: true });
    expect(r.note).toMatch(/refused/);
  });

  it("keeps SMS codes with a real SMS provider, and always in development", () => {
    expect(phoneAuthConfig({ ...base, MSG91_AUTH_KEY: "k", MSG91_SENDER_ID: "SRIRTL" }).smsOtpDisabled).toBe(false);
    expect(phoneAuthConfig({ ...base, NODE_ENV: "development" }).smsOtpDisabled).toBe(false);
  });
});
