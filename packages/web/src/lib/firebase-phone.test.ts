import { afterEach, describe, expect, it, vi } from "vitest";
import {
  choosePhoneMethod,
  firebasePhoneErrorKind,
  firebasePhoneMessage,
  firebaseWebConfig,
  isFirebaseAuthHost,
  matchesTestTarget,
  methodOn,
  methodSignInRedirectUrl,
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
    expect(isFirebaseAuthHost("raja.rbms.in", [".rbms.in"])).toBe(true);
    expect(isFirebaseAuthHost("rbms.in", [".rbms.in"])).toBe(false);
    expect(isFirebaseAuthHost("evilrbms.in", [".rbms.in"])).toBe(false);
  });

  it("builds the www login URL", () => {
    expect(phoneSignInRedirectUrl("http://localhost:3005", "+919876543210", "http://raja.localhost:3001/login")).toBe(
      "http://localhost:3005/login?phone=%2B919876543210&return=http%3A%2F%2Fraja.localhost%3A3001%2Flogin",
    );
  });

  const origins = ["http://*.localhost:3001", "http://localhost:3000", "https://*.rbms.in"];
  it("accepts return URLs on allowed origins ending in /login", () => {
    expect(safeReturnUrl("http://raja.localhost:3001/login", origins)).toBe("http://raja.localhost:3001/login");
    expect(safeReturnUrl("https://raja.rbms.in/billing/login?handoff=old#x", origins)).toBe("https://raja.rbms.in/billing/login");
    expect(safeReturnUrl("http://localhost:3000/login", origins)).toBe("http://localhost:3000/login");
  });
  it("refuses anything else", () => {
    expect(safeReturnUrl(null, origins)).toBeNull();
    expect(safeReturnUrl("https://evil.com/login", origins)).toBeNull();
    expect(safeReturnUrl("https://raja.rbms.in.evil.com/login", origins)).toBeNull();
    expect(safeReturnUrl("https://a.b.rbms.in/login", origins)).toBeNull();
    expect(safeReturnUrl("http://raja.rbms.in/login", origins)).toBeNull();
    expect(safeReturnUrl("http://raja.localhost:3003/login", origins)).toBeNull();
    expect(safeReturnUrl("https://raja.rbms.in/account", origins)).toBeNull();
    expect(safeReturnUrl("https://user:pw@raja.rbms.in/login", origins)).toBeNull();
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
  it("maps email + password errors; wrong email and wrong password read the same", () => {
    for (const code of ["auth/invalid-credential", "auth/wrong-password", "auth/user-not-found", "auth/invalid-login-credentials"]) {
      expect(firebasePhoneErrorKind({ code })).toBe("bad_credentials");
    }
    expect(firebasePhoneMessage({ code: "auth/wrong-password" }, "en")).toBe(firebasePhoneMessage({ code: "auth/user-not-found" }, "en"));
    expect(firebasePhoneErrorKind({ code: "auth/email-not-verified" })).toBe("email_not_verified");
    expect(firebasePhoneErrorKind({ code: "firebase_email_unverified" })).toBe("email_not_verified");
    expect(firebasePhoneErrorKind({ code: "auth/email-already-in-use" })).toBe("email_in_use");
    expect(firebasePhoneErrorKind({ code: "auth/weak-password" })).toBe("weak_password");
    expect(firebasePhoneErrorKind({ code: "method_disabled" })).toBe("method_disabled");
    expect(firebasePhoneMessage({ code: "auth/email-not-verified" }, "ta")).toMatch(/மின்னஞ்சலை/);
    // sign-up must not confirm that an address already has an account
    expect(firebasePhoneMessage({ code: "auth/email-already-in-use" }, "en")).toMatch(/^If this email/);
  });
  it("speaks English and Tamil", () => {
    expect(firebasePhoneMessage({ code: "auth/invalid-verification-code" }, "en")).toMatch(/didn't work/);
    expect(firebasePhoneMessage({ code: "auth/invalid-verification-code" }, "ta")).toMatch(/குறியீடு/);
    expect(firebasePhoneMessage({ code: "auth/quota-exceeded" }, undefined)).toMatch(/can't send/);
  });
});

describe("shop sign-in methods", () => {
  it("methodOn follows the shop's list, or the old behaviour when the API sent none", () => {
    const phoneCfg = { method: "otp" as const, firebaseProjectId: null };
    const cfg = { phone: phoneCfg, signIn: { audience: "staff" as const, shop: null, methods: ["password" as const, "sms" as const], default: "password" as const } };
    expect(methodOn(cfg, "password")).toBe(true);
    expect(methodOn(cfg, "email_code")).toBe(false);
    expect(methodOn(null, "email_code")).toBe(true);
    expect(methodOn(null, "password")).toBe(false);
    expect(methodOn({ phone: phoneCfg }, "google")).toBe(false);
  });
  it("builds the landing-site URL for Google / password on hosts Firebase does not authorize", () => {
    const u = new URL(methodSignInRedirectUrl("http://localhost:3005", "password", "http://anbu.localhost:3001/login", "anbu"));
    expect(u.pathname).toBe("/login");
    expect(u.searchParams.get("method")).toBe("password");
    expect(u.searchParams.get("return")).toBe("http://anbu.localhost:3001/login");
    expect(u.searchParams.get("shop")).toBe("anbu");
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
