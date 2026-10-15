"use client";

/** Browser → same-origin proxy (`/api/v1/*`), which forwards to the API for this shop. */

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

export const TOKEN_KEY = "sr_token";

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* private mode */
  }
}

export function setCookie(name: string, value: string | null, days = 30) {
  if (typeof document === "undefined") return;
  const secure = location.protocol === "https:" ? "; secure" : "";
  document.cookie = value
    ? `${name}=${encodeURIComponent(value)}; path=/; max-age=${days * 86400}; samesite=lax${secure}`
    : `${name}=; path=/; max-age=0; samesite=lax${secure}`;
}

export interface CallOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  /** Send the shopper token (default true when there is one). */
  auth?: boolean;
  signal?: AbortSignal;
  /** Extra request headers (e.g. `x-guest-token` for guest help-desk calls). */
  headers?: Record<string, string>;
}

/** Called when the API answers 401 for a signed-in call (token expired / revoked). */
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: (() => void) | null) {
  onUnauthorized = fn;
}

export async function call<T>(path: string, opts: CallOptions = {}): Promise<T> {
  const url = new URL(`/api/v1${path.startsWith("/") ? path : `/${path}`}`, window.location.origin);
  for (const [k, v] of Object.entries(opts.query ?? {})) if (v !== undefined && v !== null && v !== "") url.searchParams.set(k, String(v));
  const headers = new Headers({ accept: "application/json", ...(opts.headers ?? {}) });
  const token = opts.auth === false ? null : getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const lang = document.documentElement.lang;
  if (lang) headers.set("accept-language", lang);
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(opts.body);
  }
  let res: Response;
  try {
    res = await fetch(url, { method: opts.method ?? (body ? "POST" : "GET"), headers, body, signal: opts.signal, credentials: "omit" });
  } catch (err) {
    if (err instanceof DOMException && err.name === "AbortError") throw err;
    throw new ApiError(0, "network_error", "Network error");
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
    const e = (data && typeof data === "object" && "error" in data ? (data as { error: { code?: string; message?: string; details?: unknown } }).error : null) ?? null;
    if (res.status === 401 && token) onUnauthorized?.();
    throw new ApiError(res.status, e?.code ?? `http_${res.status}`, e?.message ?? "Request failed", e?.details);
  }
  return data as T;
}

/** A shopper-facing message for an error: API message for 4xx, generic otherwise. */
export function errorMessage(err: unknown, t: (k: string) => string): string {
  if (err instanceof ApiError) {
    if (err.status === 0) return t("common.network");
    if (err.status >= 400 && err.status < 500 && err.message && err.code !== "invalid_input") return err.message;
    if (err.code === "invalid_input" && Array.isArray(err.details)) {
      const first = err.details[0] as { message?: string } | undefined;
      if (first?.message) return first.message;
    }
  }
  return t("common.error");
}
