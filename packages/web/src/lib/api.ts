"use client";

import { BRANCH_HEADER, getStoredBranch, isBranchError, setStoredBranch } from "./branch";
import { getToken, LOCALE_KEY, readStored, setToken } from "./session";
import { currentTenantSlug } from "./tenant";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/+$/, "");

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

export interface ApiOptions extends Omit<RequestInit, "body"> {
  body?: unknown;
  query?: QueryParams;
  /** Override the x-tenant header; null omits it. Defaults to the current shop (see TenantStrategy). */
  tenant?: string | null;
  /** Public calls: no bearer token, and a 401 doesn't redirect to /login. */
  anonymous?: boolean;
}

/** Absolute URL for an API path ("/auth/me" → "{API}/v1/auth/me"). */
export function apiUrl(path: string, query?: QueryParams): string {
  const url = new URL(`${API_URL}/v1${path.startsWith("/") ? path : `/${path}`}`);
  if (query) {
    for (const [k, v] of Object.entries(query)) {
      if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
    }
  }
  return url.toString();
}

/** Resolves URLs the API hands back (logos, uploads) that may be relative to the API origin. */
export function absoluteUrl(url: string): string;
export function absoluteUrl(url: string | null | undefined): string | null;
export function absoluteUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  if (/^https?:\/\//i.test(url) || url.startsWith("data:") || url.startsWith("blob:")) return url;
  return `${API_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

let redirecting = false;
let loginPath = "/login";
let publicPrefixes: string[] = [];

/** Called by createWebApp: where to send signed-out users, and which paths are public (no redirect on 401). */
export function configureApi(opts: { loginPath?: string; publicPrefixes?: string[] }) {
  if (opts.loginPath) loginPath = opts.loginPath;
  if (opts.publicPrefixes) publicPrefixes = opts.publicPrefixes;
}

/** True for public pages (shared bills, statements) that must never bounce to the login screen. */
export function isPublicPath(path: string): boolean {
  return publicPrefixes.some((p) => path === p || path.startsWith(p.endsWith("/") ? p : `${p}/`));
}

// ---------------------------------------------------------------- paired POS terminals (docs/pos-terminals.md)

/** Header a paired POS terminal sends with every request. */
export const DEVICE_TOKEN_HEADER = "x-device-token";

let deviceToken: string | null = null;

export interface SessionOverride {
  /** Bearer token to send instead of the stored sign-in (null = none, e.g. a locked terminal). */
  token: string | null;
  /** A 401 while the override is active: reported here instead of clearing the stored sign-in and redirecting. */
  onUnauthorized?: (error: ApiError) => void;
}

let sessionOverride: SessionOverride | null = null;

/** While set, every api() / apiDownload() call carries `x-device-token` (a paired POS terminal). null stops. */
export function setDeviceToken(token: string | null) {
  deviceToken = token || null;
}
export const getDeviceToken = () => deviceToken;

/**
 * Terminal mode: calls use `override.token` (a PIN session) instead of the stored staff sign-in, and a 401 goes to
 * `override.onUnauthorized` (lock the terminal) instead of signing out. null restores the normal behaviour.
 */
export function setSessionOverride(override: SessionOverride | null) {
  sessionOverride = override;
}
export const hasSessionOverride = () => sessionOverride !== null;

/** The bearer token calls use right now (the terminal's PIN session while overridden, else the stored sign-in). */
export const authToken = (): string | null => (sessionOverride ? sessionOverride.token : getToken());

/** Auth headers for hand-built fetches (PDF / file downloads): bearer, x-tenant, x-device-token. */
export function authHeaders(init?: HeadersInit): Headers {
  const headers = new Headers(init);
  const token = authToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const slug = currentTenantSlug();
  if (slug) headers.set("x-tenant", slug);
  if (deviceToken) headers.set(DEVICE_TOKEN_HEADER, deviceToken);
  return headers;
}

function unauthorized(error: ApiError) {
  if (sessionOverride) {
    try {
      sessionOverride.onUnauthorized?.(error);
    } catch {
      // the terminal's handler must never change what the caller sees
    }
    return;
  }
  handleUnauthorized();
}

function handleUnauthorized() {
  setToken(null);
  if (typeof window === "undefined" || redirecting) return;
  const path = window.location.pathname;
  if (path !== loginPath && !isPublicPath(path)) {
    redirecting = true;
    window.location.assign(loginPath);
  }
}

/**
 * fetch wrapper for the srikit API: bearer token, x-tenant (current shop), JSON in/out.
 * Errors `{ error: { code, message, details } }` become ApiError. A 401 clears the token and
 * sends the user to the login screen (unless the page is public).
 */
export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { body, query, tenant, anonymous, headers: extraHeaders, ...init } = opts;
  const headers = new Headers(extraHeaders);
  headers.set("accept", "application/json");

  const token = anonymous ? null : authToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (deviceToken) headers.set(DEVICE_TOKEN_HEADER, deviceToken);
  const slug = tenant === undefined ? currentTenantSlug() : tenant;
  if (slug) headers.set("x-tenant", slug);
  // The current branch (multi-branch shops) goes with every signed-in call for this shop.
  const branch = !anonymous && slug ? getStoredBranch(slug) : null;
  if (branch && !headers.has(BRANCH_HEADER)) headers.set(BRANCH_HEADER, branch);
  const locale = readStored(LOCALE_KEY);
  if (locale) headers.set("accept-language", locale);

  let payload: BodyInit | undefined;
  if (body !== undefined) {
    if (body instanceof FormData || body instanceof Blob) payload = body;
    else {
      headers.set("content-type", "application/json");
      payload = JSON.stringify(body);
    }
  }

  let res: Response;
  try {
    res = await fetch(apiUrl(path, query), {
      ...init,
      headers,
      body: payload,
      credentials: anonymous ? "omit" : "include",
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "network_error", err instanceof Error ? err.message : "Network error");
  }

  const text = res.status === 204 ? "" : await res.text();
  let data: unknown = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const e = (data && typeof data === "object" && "error" in data ? (data as { error: unknown }).error : null) as {
      code?: string;
      message?: string;
      details?: unknown;
    } | null;
    // A closed branch or a removed assignment: forget it so the next call uses the server's choice.
    if (branch && isBranchError(e?.code)) setStoredBranch(null, slug);
    const error = new ApiError(res.status, e?.code ?? `http_${res.status}`, e?.message ?? res.statusText ?? "Request failed", e?.details);
    if (res.status === 401 && !anonymous) unauthorized(error);
    emitApiError({ error, method: (init.method ?? "GET").toUpperCase(), path });
    throw error;
  }
  return data as T;
}

/** A failed api() call, as seen by `onApiError` listeners (the error is still thrown to the caller). */
export interface ApiErrorEvent {
  error: ApiError;
  method: string;
  path: string;
}

const errorListeners = new Set<(e: ApiErrorEvent) => void>();

/**
 * Observe every failed api() call app-wide (the shell's upgrade dialog listens for 402 plan limits). Listeners run
 * synchronously before the error reaches the caller and must not throw. Returns the unsubscribe function.
 */
export function onApiError(listener: (e: ApiErrorEvent) => void): () => void {
  errorListeners.add(listener);
  return () => void errorListeners.delete(listener);
}

function emitApiError(e: ApiErrorEvent) {
  for (const l of errorListeners) {
    try {
      l(e);
    } catch {
      // a listener must never change what the caller sees
    }
  }
}

/**
 * Downloads a CSV (or any file) the API streams back: same auth + tenant headers as `api`, then saves
 * the blob under the server's Content-Disposition filename (or `fallbackName`).
 */
export async function apiDownload(path: string, query: QueryParams, fallbackName: string): Promise<void> {
  const headers = new Headers({ accept: "text/csv, */*" });
  const token = authToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  if (deviceToken) headers.set(DEVICE_TOKEN_HEADER, deviceToken);
  const slug = currentTenantSlug();
  if (slug) headers.set("x-tenant", slug);
  const branch = slug ? getStoredBranch(slug) : null;
  if (branch) headers.set(BRANCH_HEADER, branch);
  let res: Response;
  try {
    res = await fetch(apiUrl(path, query), { headers, credentials: "include" });
  } catch (err) {
    throw new ApiError(0, "network_error", err instanceof Error ? err.message : "Network error");
  }
  if (!res.ok) {
    type ErrBody = { code?: string; message?: string; details?: unknown };
    const e: ErrBody | null = await res
      .json()
      .then((j: { error?: ErrBody }) => j.error ?? null)
      .catch(() => null);
    if (branch && isBranchError(e?.code)) setStoredBranch(null, slug);
    const error = new ApiError(res.status, e?.code ?? `http_${res.status}`, e?.message ?? res.statusText ?? "Download failed", e?.details);
    if (res.status === 401) unauthorized(error);
    throw error;
  }
  const blob = await res.blob();
  const cd = res.headers.get("content-disposition") ?? "";
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  const name = m?.[1] ? decodeURIComponent(m[1]) : fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

api.get =<T = unknown>(path: string, query?: QueryParams, opts?: ApiOptions) => api<T>(path, { ...opts, query });
api.post = <T = unknown>(path: string, body?: unknown, opts?: ApiOptions) => api<T>(path, { ...opts, method: "POST", body });
api.put = <T = unknown>(path: string, body?: unknown, opts?: ApiOptions) => api<T>(path, { ...opts, method: "PUT", body });
api.patch = <T = unknown>(path: string, body?: unknown, opts?: ApiOptions) => api<T>(path, { ...opts, method: "PATCH", body });
api.delete = <T = unknown>(path: string, body?: unknown, opts?: ApiOptions) => api<T>(path, { ...opts, method: "DELETE", body });
