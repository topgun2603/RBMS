import { cookies, headers } from "next/headers";
import { cache } from "react";
import { PREVIEW_COOKIE, PREVIEW_TOKEN_HEADER, looksLikePreviewToken } from "../lib/preview-protocol";
import { configPatchFor, parsePreviewTokens } from "../lib/preview-theme";
import { API_ORIGIN, upstreamTenantHeaders } from "../lib/tenant";
import type { PublicHome, StoreConfig } from "../types";

/*
 * Server half of the live preview. A request is in preview mode only when it carries the httpOnly preview cookie AND
 * the API confirms the token for this shop (per request, uncached). Then:
 * - `/cms/public/home` is replaced by the preview home (unsaved sections › saved draft › published), fetched no-store;
 * - `/store/config` gets the unsaved brand tokens applied (css, theme variants, fonts).
 * Everything else renders as for shoppers. `previewTransform` is the single hook in server/api.ts `apiGet`.
 */

export interface PreviewSession {
  token: string;
  tenantId: string;
  expiresAt: string;
  /** Unsaved brand tokens parked by the bridge (unvalidated; see parsePreviewTokens). */
  tokens: unknown;
  draftHome: boolean;
}

async function hostHeaders(): Promise<Record<string, string>> {
  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const out = upstreamTenantHeaders(host);
  if (!out["x-forwarded-host"] && host) out["x-forwarded-host"] = host;
  return out;
}

/** Calls a token-authenticated preview route of the API (never cached). */
export async function previewApi(path: string, token: string, init: { method?: string; body?: unknown; tenantHeaders?: Record<string, string> } = {}): Promise<Response> {
  const tenant = init.tenantHeaders ?? (await hostHeaders());
  return fetch(`${API_ORIGIN}/v1/cms/preview${path}`, {
    method: init.method ?? "GET",
    headers: { accept: "application/json", ...tenant, [PREVIEW_TOKEN_HEADER]: token, ...(init.body !== undefined ? { "content-type": "application/json" } : {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    cache: "no-store",
  });
}

/** The preview cookie's token when it is well-formed (not yet verified), else null. */
const cookieToken = cache(async (): Promise<string | null> => {
  try {
    const token = (await cookies()).get(PREVIEW_COOKIE)?.value;
    return looksLikePreviewToken(token) ? token : null;
  } catch {
    return null; // outside a request (build time)
  }
});

/** The verified preview session of this request, or null (no cookie, bad/expired token, other shop, API down). */
export const getPreviewSession = cache(async (): Promise<PreviewSession | null> => {
  const token = await cookieToken();
  if (!token) return null;
  try {
    const res = await previewApi("/session", token);
    if (!res.ok) return null;
    const s = (await res.json()) as Omit<PreviewSession, "token">;
    return { ...s, token };
  } catch {
    return null;
  }
});

/** True when this request renders the preview. */
export async function isPreview(): Promise<boolean> {
  return (await getPreviewSession()) !== null;
}

/** The home the preview shows, or null outside preview mode / when the API fails (the published home is used then). */
export const getPreviewHome = cache(async (): Promise<PublicHome | null> => {
  // Fetched alongside the session check (the API verifies the token itself), not after it: one round trip less.
  const token = await cookieToken();
  if (!token) return null;
  try {
    const res = await previewApi("/home", token);
    return res.ok ? ((await res.json()) as PublicHome) : null;
  } catch {
    return null;
  }
});

/** The shop config with the unsaved brand tokens applied (unchanged outside preview / without valid tokens). */
export async function previewConfig(config: StoreConfig): Promise<StoreConfig> {
  const s = await getPreviewSession();
  const tokens = s ? parsePreviewTokens(s.tokens) : null;
  if (!tokens) return config;
  const patch = configPatchFor(tokens);
  return { ...config, shop: { ...config.shop, css: patch.css, theme: patch.theme, fonts: patch.fonts } };
}

/**
 * The hook in `apiGet`: swaps in preview data for the two reads the preview changes. Outside preview mode it only
 * reads the cookie (no network) and returns `data` as is.
 */
export async function previewTransform<T>(path: string, data: T): Promise<T> {
  if (path !== "/cms/public/home" && path !== "/store/config") return data;
  if (!(await cookieToken())) return data;
  if (path === "/store/config") return (await previewConfig(data as StoreConfig)) as T;
  const [session, home] = await Promise.all([getPreviewSession(), getPreviewHome()]);
  return (session && home ? home : data) as T;
}
