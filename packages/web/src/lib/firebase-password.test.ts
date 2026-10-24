import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Email + password helpers against a mocked Firebase SDK (no network, no real project). */
const state = vi.hoisted(() => ({
  user: { emailVerified: true, getIdToken: async () => "id-token-123" } as { emailVerified: boolean; getIdToken: () => Promise<string> },
  createdUser: { emailVerified: false },
  signInError: null as null | { code: string },
  resetError: null as null | { code: string },
  sendVerification: vi.fn(async (_u: unknown) => undefined),
  signOut: vi.fn(async () => undefined),
  reset: vi.fn(async (_a: unknown, _e: string) => undefined),
}));

vi.mock("firebase/app", () => ({ getApps: () => [], initializeApp: () => ({}) }));
vi.mock("firebase/auth", () => ({
  initializeAuth: () => ({ languageCode: "en" }),
  inMemoryPersistence: {},
  createUserWithEmailAndPassword: async () => ({ user: state.createdUser }),
  signInWithEmailAndPassword: async () => {
    if (state.signInError) throw state.signInError;
    return { user: state.user };
  },
  sendEmailVerification: (u: unknown) => state.sendVerification(u),
  sendPasswordResetEmail: async (a: unknown, e: string) => {
    if (state.resetError) throw state.resetError;
    return state.reset(a, e);
  },
  signOut: () => state.signOut(),
}));

import { passwordProblem, resendVerification, sendPasswordReset, signInWithPassword, signUpWithPassword } from "./firebase-phone";

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_API_KEY", "k");
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN", "p.firebaseapp.com");
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_PROJECT_ID", "p");
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_APP_ID", "1:2:web:3");
  state.user = { emailVerified: true, getIdToken: async () => "id-token-123" };
  state.signInError = null;
  state.resetError = null;
  state.sendVerification.mockClear();
  state.signOut.mockClear();
  state.reset.mockClear();
});
afterEach(() => vi.unstubAllEnvs());

describe("email + password (Firebase mocked)", () => {
  it("enforces our minimum of 8 characters before calling Firebase", async () => {
    expect(passwordProblem("1234567")).toBe("weak_password");
    expect(passwordProblem("12345678")).toBeNull();
    await expect(signUpWithPassword("a@b.in", "short")).rejects.toMatchObject({ code: "auth/weak-password" });
    expect(state.sendVerification).not.toHaveBeenCalled();
  });

  it("sign-up sends the verification email and signs Firebase out", async () => {
    await signUpWithPassword("a@b.in", "long-enough-1");
    expect(state.sendVerification).toHaveBeenCalledWith(state.createdUser);
    expect(state.signOut).toHaveBeenCalled();
  });

  it("sign-in returns the ID token only for a verified email", async () => {
    await expect(signInWithPassword("a@b.in", "long-enough-1")).resolves.toBe("id-token-123");
    expect(state.signOut).toHaveBeenCalled();
  });

  it("an unverified email gets the link again and never a token", async () => {
    state.user = { emailVerified: false, getIdToken: async () => "must-not-leak" };
    await expect(signInWithPassword("a@b.in", "long-enough-1")).rejects.toMatchObject({ code: "auth/email-not-verified" });
    expect(state.sendVerification).toHaveBeenCalledTimes(1);
    expect(state.signOut).toHaveBeenCalled();
    await resendVerification("a@b.in", "long-enough-1");
    expect(state.sendVerification).toHaveBeenCalledTimes(2);
  });

  it("wrong password and unknown email fail the same way", async () => {
    state.signInError = { code: "auth/invalid-credential" };
    await expect(signInWithPassword("a@b.in", "wrong-password")).rejects.toMatchObject({ code: "auth/invalid-credential" });
  });

  it("password reset looks the same for an unknown address, but reports a bad one", async () => {
    await sendPasswordReset("a@b.in");
    expect(state.reset).toHaveBeenCalledWith(expect.anything(), "a@b.in");
    state.resetError = { code: "auth/user-not-found" };
    await expect(sendPasswordReset("nobody@b.in")).resolves.toBeUndefined();
    state.resetError = { code: "auth/invalid-email" };
    await expect(sendPasswordReset("nope")).rejects.toMatchObject({ code: "auth/invalid-email" });
  });
});
