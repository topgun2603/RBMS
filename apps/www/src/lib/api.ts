/**
 * Every browser call the marketing site makes, in one place. Requests go through the same-origin proxy
 * (`/api/v1/*` → API `/v1/*`, see app/api/v1/[...path]/route.ts). The session token from the OTP sign-in is kept in
 * sessionStorage (this origin only) and sent as a bearer token; the shop apps get their own session through the
 * login handoff code.
 */
import type { Interval, Plan } from "./plans";
import type { AuthClientConfig } from "@srirealtime/web/firebase-phone";
import type { AppId } from "./site";

const BASE = "/api/v1";
const TOKEN_KEY = "sr_www_token";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
  }
}

export function getToken(): string | null {
  try {
    return sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}
export function setToken(token: string | null) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode: the session lasts for this page only */
  }
}

async function call<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  const token = getToken();
  if (token) headers.authorization = `Bearer ${token}`;
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal, cache: "no-store" });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "network_error", "Network error");
  }
  const data = (await res.json().catch(() => null)) as ({ error?: { code?: string; message?: string; details?: unknown } } & T) | null;
  if (!res.ok) {
    if (res.status === 401) setToken(null);
    throw new ApiError(res.status, data?.error?.code ?? `http_${res.status}`, data?.error?.message ?? res.statusText, data?.error?.details);
  }
  return data as T;
}

// ------------------------------------------------------------------ types

export interface User {
  id: string;
  phone: string | null;
  email: string | null;
  name: string | null;
  locale?: string;
}
export interface OtpRequestResult {
  target: string;
  channel: string;
  expiresInSeconds: number;
  resendInSeconds: number;
}
export interface SignInResult {
  token: string;
  expiresAt: string;
  user: User;
  isNewUser: boolean;
}
export interface Shop {
  id: string;
  slug: string;
  name: string;
  appId: string | null;
  status: string;
}
export interface SlugCheck {
  available: boolean;
  reason?: string;
  suggestions: string[];
}
export interface SignupInput {
  shopName: string;
  slug: string;
  appId: AppId;
  planId: string;
  interval: Interval;
  businessType?: string;
  /** GST state code, e.g. "33" for Tamil Nadu. */
  state: string;
  gstin?: string;
  phone?: string;
}
/** `handoff` is the single-use code (the contract allows a bare string or `{code}`). */
export interface SignupResult {
  tenant: Shop;
  appUrl: string;
  handoff: string | { code: string; expiresAt?: string };
  /** `<appUrl>/login?handoff=<code>`, ready to open. */
  loginUrl?: string;
  trial?: boolean;
}
export interface HandoffResult {
  code: string;
  expiresAt?: string;
  /** Present when the API resolves the destination itself. */
  appUrl?: string;
  url?: string;
}

// ------------------------------------------------------------------ calls

export const api = {
  plans: () => call<{ items: Plan[] }>("GET", "/plans"),

  requestOtp: (target: string) => call<OtpRequestResult>("POST", "/auth/otp/request", { target }),
  verifyOtp: async (target: string, code: string, name?: string) => {
    const r = await call<SignInResult>("POST", "/auth/otp/verify", { target, code, ...(name ? { name } : {}) });
    setToken(r.token);
    return r;
  },
  /** Sign in with a Firebase phone ID token (the number was verified by Firebase). */
  firebaseSignIn: async (idToken: string, name?: string) => {
    const r = await call<SignInResult>("POST", "/auth/firebase", { idToken, ...(name ? { name } : {}) });
    setToken(r.token);
    return r;
  },
  /** Which phone method the API uses (firebase | otp). */
  authConfig: () => call<AuthClientConfig>("GET", "/auth/config"),
  me: () => call<{ user: User; tenantRoles: string[]; permissions: string[] }>("GET", "/auth/me"),
  logout: async () => {
    await call("POST", "/auth/logout").catch(() => undefined);
    setToken(null);
  },
  /** The signed-in user's shops with their roles. */
  myShops: () => call<{ items: { tenant: Shop; roles: string[] }[] }>("GET", "/tenancy/mine"),

  slugAvailable: (slug: string, signal?: AbortSignal) => call<SlugCheck>("GET", `/tenancy/slug-available?slug=${encodeURIComponent(slug)}`, undefined, signal),
  signup: (input: SignupInput) => call<SignupResult>("POST", "/signup", input),
  /** Single-use login code for opening a shop app on another origin. */
  handoff: (tenantId?: string) => call<HandoffResult>("POST", "/auth/handoff", tenantId ? { tenantId } : {}),
};

// ------------------------------------------------------------------ helpers

export const handoffCode = (h: SignupResult["handoff"]) => (typeof h === "string" ? h : h.code);

/** `<appUrl>/login?handoff=<code>` (keeps an appUrl that already carries the code or a path). */
export function handoffUrl(appUrl: string, code: string): string {
  if (/[?&]handoff=/.test(appUrl)) return appUrl;
  const u = new URL(appUrl);
  if (u.pathname === "/" || u.pathname === "") u.pathname = "/login";
  else if (!u.pathname.endsWith("/login")) u.pathname = `${u.pathname.replace(/\/+$/, "")}/login`;
  u.searchParams.set("handoff", code);
  return u.toString();
}

/** "98765 43210" → "+919876543210"; emails lower-cased; otherwise null. */
export function normalizeTarget(input: string): string | null {
  const s = input.trim();
  if (s.includes("@")) return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) ? s.toLowerCase() : null;
  const digits = s.replace(/[^\d+]/g, "");
  if (/^\+91[6-9]\d{9}$/.test(digits)) return digits;
  if (/^91[6-9]\d{9}$/.test(digits)) return `+${digits}`;
  if (/^0?[6-9]\d{9}$/.test(digits)) return `+91${digits.slice(-10)}`;
  return null;
}

/** A user-facing message for an error (translated keys for the common cases). */
export function errorMessage(err: unknown, t: (k: string) => string): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return t("error.network");
    if (err.status === 404 && err.code === "not_found") return t("error.unavailable");
    if (err.message && err.status < 500) return err.message;
  }
  return t("error.generic");
}
