"use client";

import { getTenantSlug, getToken, LOCALE_KEY, readStored, setToken } from "./session";

export const API_URL = (process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/+$/, "");
export const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";

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
  /** Override the x-tenant header; null omits it. Defaults to the stored tenant. */
  tenant?: string | null;
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

/** Resolves URLs the API hands back (uploads, files) that may be relative to the API origin. */
export function absoluteUrl(url: string): string {
  if (/^https?:\/\//i.test(url) || url.startsWith("data:") || url.startsWith("blob:")) return url;
  return `${API_URL}${url.startsWith("/") ? "" : "/"}${url}`;
}

let redirecting = false;
function handleUnauthorized() {
  setToken(null);
  if (typeof window === "undefined" || redirecting) return;
  if (window.location.pathname !== "/login") {
    redirecting = true;
    window.location.assign("/login");
  }
}

/**
 * fetch wrapper for the srikit API: bearer token, x-tenant, JSON in/out, cookies included.
 * Errors `{ error: { code, message, details } }` become ApiError. A 401 clears the token and
 * sends the user to /login.
 */
export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const { body, query, tenant, headers: extraHeaders, ...init } = opts;
  const headers = new Headers(extraHeaders);
  headers.set("accept", "application/json");

  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const slug = tenant === undefined ? getTenantSlug() : tenant;
  if (slug) headers.set("x-tenant", slug);
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
    res = await fetch(apiUrl(path, query), { ...init, headers, body: payload, credentials: "include" });
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
    if (res.status === 401) handleUnauthorized();
    throw new ApiError(res.status, e?.code ?? `http_${res.status}`, e?.message ?? res.statusText ?? "Request failed", e?.details);
  }
  return data as T;
}

api.get = <T = unknown>(path: string, query?: QueryParams, opts?: ApiOptions) => api<T>(path, { ...opts, query });
api.post = <T = unknown>(path: string, body?: unknown, opts?: ApiOptions) => api<T>(path, { ...opts, method: "POST", body });
api.put = <T = unknown>(path: string, body?: unknown, opts?: ApiOptions) => api<T>(path, { ...opts, method: "PUT", body });
api.patch = <T = unknown>(path: string, body?: unknown, opts?: ApiOptions) => api<T>(path, { ...opts, method: "PATCH", body });
api.delete = <T = unknown>(path: string, body?: unknown, opts?: ApiOptions) => api<T>(path, { ...opts, method: "DELETE", body });

/**
 * Downloads a file the API streams back (PDF, CSV) with the same auth headers as `api`, saved under the server's
 * Content-Disposition filename or `fallbackName`. `tenant: null` omits x-tenant (platform routes).
 */
export async function apiDownload(path: string, fallbackName: string, opts: { query?: QueryParams; tenant?: string | null } = {}): Promise<void> {
  const headers = new Headers({ accept: "application/pdf, text/csv, */*" });
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const slug = opts.tenant === undefined ? getTenantSlug() : opts.tenant;
  if (slug) headers.set("x-tenant", slug);
  let res: Response;
  try {
    res = await fetch(apiUrl(path, opts.query), { headers, credentials: "include" });
  } catch (err) {
    throw new ApiError(0, "network_error", err instanceof Error ? err.message : "Network error");
  }
  if (!res.ok) {
    type ErrBody = { code?: string; message?: string; details?: unknown };
    const e: ErrBody | null = await res
      .json()
      .then((j: { error?: ErrBody }) => j.error ?? null)
      .catch(() => null);
    if (res.status === 401) handleUnauthorized();
    throw new ApiError(res.status, e?.code ?? `http_${res.status}`, e?.message ?? res.statusText ?? "Download failed", e?.details);
  }
  const blob = await res.blob();
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(res.headers.get("content-disposition") ?? "");
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = m?.[1] ? decodeURIComponent(m[1]) : fallbackName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
