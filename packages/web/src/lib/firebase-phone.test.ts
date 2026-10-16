import { afterEach, describe, expect, it, vi } from "vitest";
import {
  choosePhoneMethod,
  firebasePhoneErrorKind,
  firebasePhoneMessage,
  firebaseWebConfig,
  isFirebaseAuthHost,
  matchesTestTarget,
  phoneSignInRedirectUrl,
  safeReturnUrl,
} from "./firebase-phone";

const web = { apiKey: "k", authDomain: "p.firebaseapp.com", projectId: "p", appId: "1:2:web:3" };
const server = { phone: { method: "firebase" as const, firebaseProjectId: "p" }, testTargets: ["+9199990*", "e2e-*@example.com"] };
const phone = (target: string, extra: Partial<Parameters<typeof choosePhoneMethod>[0]> = {}) =>
  choosePhoneMethod({ kind: "phone", target, web, server, ...extra });

describe("choosePhoneMethod", () => {
  it("uses Firebase for real phone numbers on SMS", () => {
    expect(phone("+919876543210")).toBe("firebase");
  });
  it("keeps the OTP flow for test numbers, email, WhatsApp, and missing config", () => {
    expect(phone("+919999000001")).toBe("otp");
    expect(choosePhoneMethod({ kind: "email", target: "a@b.in", web, server })).toBe("otp");
    expect(phone("+919876543210", { channel: "whatsapp" })).toBe("otp");
    expect(phone("+919876543210", { web: null })).toBe("otp");
    expect(phone("+919876543210", { server: null })).toBe("otp");
    expect(phone("+919876543210", { server: { phone: { method: "otp", firebaseProjectId: null } } })).toBe("otp");
    expect(phone("+919876543210", { server: { phone: { method: "firebase", firebaseProjectId: "other" } } })).toBe("otp");
  });
});

describe("matchesTestTarget", () => {
  it("matches exact values and * patterns, never a bare *", () => {
    expect(matchesTestTarget("+919999012345", ["+9199990*"])).toBe(true);
    expect(matchesTestTarget("+919999112345", ["+9199990*"])).toBe(false);
    expect(matchesTestTarget("E2E-x@example.com", ["e2e-*@example.com"])).toBe(true);
    expect(matchesTestTarget("+919876543210", ["*"])).toBe(false);
    expect(matchesTestTarget("+919876543210", undefined)).toBe(false);
  });
});

describe("firebase hosts and the www round trip", () => {
  it("matches exact hosts and .suffix entries", () => {
    expect(isFirebaseAuthHost("localhost", ["localhost"])).toBe(true);
    expect(isFirebaseAuthHost("raja.localhost", ["localhost"])).toBe(false);
    expect(isFirebaseAuthHost("raja.srikit.in", [".srikit.in"])).toBe(true);
    expect(isFirebaseAuthHost("srikit.in", [".srikit.in"])).toBe(false);
    expect(isFirebaseAuthHost("evilsrikit.in", [".srikit.in"])).toBe(false);
  });

  it("builds the www login URL", () => {
    expect(phoneSignInRedirectUrl("http://localhost:3005", "+919876543210", "http://raja.localhost:3001/login")).toBe(
      "http://localhost:3005/login?phone=%2B919876543210&return=http%3A%2F%2Fraja.localhost%3A3001%2Flogin",
    );
  });

  const origins = ["http://*.localhost:3001", "http://localhost:3000", "https://*.srikit.in"];
  it("accepts return URLs on allowed origins ending in /login", () => {
    expect(safeReturnUrl("http://raja.localhost:3001/login", origins)).toBe("http://raja.localhost:3001/login");
    expect(safeReturnUrl("https://raja.srikit.in/billing/login?handoff=old#x", origins)).toBe("https://raja.srikit.in/billing/login");
    expect(safeReturnUrl("http://localhost:3000/login", origins)).toBe("http://localhost:3000/login");
  });
  it("refuses anything else", () => {
    expect(safeReturnUrl(null, origins)).toBeNull();
    expect(safeReturnUrl("https://evil.com/login", origins)).toBeNull();
    expect(safeReturnUrl("https://raja.srikit.in.evil.com/login", origins)).toBeNull();
    expect(safeReturnUrl("https://a.b.srikit.in/login", origins)).toBeNull();
    expect(safeReturnUrl("http://raja.srikit.in/login", origins)).toBeNull();
    expect(safeReturnUrl("http://raja.localhost:3003/login", origins)).toBeNull();
    expect(safeReturnUrl("https://raja.srikit.in/account", origins)).toBeNull();
    expect(safeReturnUrl("https://user:pw@raja.srikit.in/login", origins)).toBeNull();
    expect(safeReturnUrl("javascript:alert(1)//login", origins)).toBeNull();
    expect(safeReturnUrl("not a url", origins)).toBeNull();
  });
});

describe("Firebase errors", () => {
  it("maps codes to kinds", () => {
    expect(firebasePhoneErrorKind({ code: "auth/invalid-verification-code" })).toBe("invalid_code");
    expect(firebasePhoneErrorKind({ code: "auth/code-expired" })).toBe("code_expired");
    expect(firebasePhoneErrorKind({ code: "auth/too-many-requests" })).toBe("too_many_attempts");
    expect(firebasePhoneErrorKind({ code: "auth/quota-exceeded" })).toBe("quota_exceeded");
    expect(firebasePhoneErrorKind({ code: "auth/network-request-failed" })).toBe("network");
    expect(firebasePhoneErrorKind({ code: "auth/operation-not-allowed" })).toBe("not_enabled");
    expect(firebasePhoneErrorKind(new Error("x"))).toBe("unknown");
    expect(firebasePhoneErrorKind({ code: "firebase_token_expired" })).toBe("code_expired");
    expect(firebasePhoneErrorKind({ code: "firebase_wrong_project" })).toBe("unknown");
  });
  it("speaks English and Tamil", () => {
    expect(firebasePhoneMessage({ code: "auth/invalid-verification-code" }, "en")).toMatch(/didn't work/);
    expect(firebasePhoneMessage({ code: "auth/invalid-verification-code" }, "ta")).toMatch(/குறியீடு/);
    expect(firebasePhoneMessage({ code: "auth/quota-exceeded" }, undefined)).toMatch(/can't send/);
  });
});

describe("firebaseWebConfig", () => {
  afterEach(() => vi.unstubAllEnvs());
  it("needs all four values", () => {
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_API_KEY", "k");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", "p.firebaseapp.com");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "p");
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_APP_ID", "");
    expect(firebaseWebConfig()).toBeNull();
    vi.stubEnv("NEXT_PUBLIC_FIREBASE_APP_ID", "1:2:web:3");
    expect(firebaseWebConfig()).toEqual(web);
  });
});
