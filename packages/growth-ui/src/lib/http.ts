"use client";

import { ApiError, apiUrl, BRANCH_HEADER, currentTenantSlug, getStoredBranch, getToken, type QueryParams } from "@rbms/web";

/** True for an API error with one of these HTTP statuses. */
export const isStatus = (err: unknown, ...statuses: number[]) => err instanceof ApiError && statuses.includes(err.status);

/** Retry policy for queries: never retry 4xx (no access, feature off, not found). */
export const retry4xx = (count: number, err: unknown) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2;

/** Saves a blob under a file name. */
export function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Saves a JSON value as a .json file. */
export const saveJson = (value: unknown, name: string) =>
  saveBlob(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }), name);

/**
 * Downloads a file the API returns for a request with a body (e.g. `POST /reports/run?format=xlsx`). Same auth,
 * tenant and branch headers as `api()`; the server's Content-Disposition name wins over `fallbackName`.
 */
export async function apiFile(
  path: string,
  opts: { method?: "GET" | "POST"; body?: unknown; query?: QueryParams; fallbackName: string },
): Promise<void> {
  const headers = new Headers({ accept: "*/*" });
  const token = getToken();
  if (token) headers.set("authorization", `Bearer ${token}`);
  const slug = currentTenantSlug();
  if (slug) headers.set("x-tenant", slug);
  const branch = slug ? getStoredBranch(slug) : null;
  if (branch) headers.set(BRANCH_HEADER, branch);
  if (opts.body !== undefined) headers.set("content-type", "application/json");
  let res: Response;
  try {
    res = await fetch(apiUrl(path, opts.query), {
      method: opts.method ?? (opts.body !== undefined ? "POST" : "GET"),
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: "include",
    });
  } catch (err) {
    throw new ApiError(0, "network_error", err instanceof Error ? err.message : "Network error");
  }
  if (!res.ok) {
    type ErrBody = { code?: string; message?: string; details?: unknown };
    const e: ErrBody | null = await res
      .json()
      .then((j: { error?: ErrBody }) => j.error ?? null)
      .catch(() => null);
    throw new ApiError(res.status, e?.code ?? `http_${res.status}`, e?.message ?? res.statusText ?? "Download failed", e?.details);
  }
  const blob = await res.blob();
  const cd = res.headers.get("content-disposition") ?? "";
  const m = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(cd);
  saveBlob(blob, m?.[1] ? decodeURIComponent(m[1]) : opts.fallbackName);
}
