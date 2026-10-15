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

  const token = anonymous ? null : getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
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
    if (res.status === 401 && !anonymous) handleUnauthorized();
    // A closed branch or a removed assignment: forget it so the next call uses the server's choice.
    if (branch && isBranchError(e?.code)) setStoredBranch(null, slug);
    throw new ApiError(res.status, e?.code ?? `http_${res.status}`, e?.message ?? res.statusText ?? "Request failed", e?.details);
  }
  return data as T;
}

/**
 * Downloads a CSV (or any file) the API streams back: same auth + tenant headers as `api`, then saves
 * the blob under the server's Content-Disposition filename (or `fallbackName`).
 */
export async function apiDownload(path: string, query: QueryParams, fallbackName: string): Promise<void> {
  const headers = new Headers({ accept: "text/csv, */*" });
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
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
    if (res.status === 401) handleUnauthorized();
    if (branch && isBranchError(e?.code)) setStoredBranch(null, slug);
    throw new ApiError(res.status, e?.code ?? `http_${res.status}`, e?.message ?? res.statusText ?? "Download failed", e?.details);
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
