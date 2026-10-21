import { PREVIEW_COOKIE, looksLikePreviewToken, safePreviewPath } from "../lib/preview-protocol";
import { upstreamTenantHeaders } from "../lib/tenant";
import { previewApi } from "./preview";

/*
 * Store route handlers for the live preview. Mount in apps/store:
 *   app/api/preview/enter/route.ts  → export { previewEnterHandler as GET }
 *   app/api/preview/exit/route.ts   → export { previewExitHandler as GET }
 * Unsaved edits go through the `parkPreviewDraft` Server Action (server/preview-actions.ts).
 */

const NO_STORE = { "cache-control": "private, no-store", "x-robots-tag": "noindex" };

function requestHost(req: Request): { host: string; proto: string } {
  const url = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? url.host;
  const proto = (req.headers.get("x-forwarded-proto") ?? "").split(",")[0]?.trim() || url.protocol.replace(":", "");
  return { host, proto };
}

function tenantHeaders(host: string): Record<string, string> {
  const h = upstreamTenantHeaders(host);
  if (!h["x-forwarded-host"]) h["x-forwarded-host"] = host;
  return h;
}

function cookieFromHeader(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

/**
 * Pure: the Set-Cookie value for the preview token. https: `SameSite=None; Secure; Partitioned` so the cookie also
 * works inside the editor's cross-site iframe (custom domains), kept in that top-level site's partition; plain http
 * (local dev, where editor and store are both on *.localhost): `SameSite=Lax`.
 */
export function previewCookie(token: string, maxAgeSeconds: number, https: boolean): string {
  const base = `${PREVIEW_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; Max-Age=${Math.max(0, Math.floor(maxAgeSeconds))}`;
  return https ? `${base}; SameSite=None; Secure; Partitioned` : `${base}; SameSite=Lax`;
}

const page = (status: number, title: string, text: string) =>
  new Response(
    `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${title}</title><body style="font:16px system-ui;display:grid;place-items:center;min-height:90vh;margin:0;color:#333"><div style="text-align:center;max-width:28rem;padding:1rem"><h1 style="font-size:1.25rem">${title}</h1><p>${text}</p></div>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", ...NO_STORE } },
  );

/** `GET /api/preview/enter?token=…&path=/…`: verify with the API, set the cookie, redirect into the store. */
export async function previewEnterHandler(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const token = url.searchParams.get("token");
  const path = safePreviewPath(url.searchParams.get("path") ?? "/") ?? "/";
  if (!looksLikePreviewToken(token)) return page(400, "Preview link invalid", "Open the preview again from your shop app.");
  const { host, proto } = requestHost(req);
  let expiresAt: string | null = null;
  try {
    const res = await previewApi("/session", token, { tenantHeaders: tenantHeaders(host) });
    if (res.ok) expiresAt = ((await res.json()) as { expiresAt?: string }).expiresAt ?? null;
  } catch {
    return page(503, "Preview unavailable", "The store couldn't reach the server. Try again in a moment.");
  }
  const left = expiresAt ? (Date.parse(expiresAt) - Date.now()) / 1000 : 0;
  if (!(left > 0)) return page(403, "Preview link expired", "Open the preview again from your shop app.");
  return new Response(null, {
    status: 303,
    headers: { location: path, "set-cookie": previewCookie(token, left, proto === "https"), ...NO_STORE, "referrer-policy": "no-referrer" },
  });
}

/** `GET /api/preview/exit`: drop the cookie (and the parked edits) and show the live store. */
export async function previewExitHandler(req: Request): Promise<Response> {
  const token = cookieFromHeader(req, PREVIEW_COOKIE);
  const { host, proto } = requestHost(req);
  if (looksLikePreviewToken(token)) await previewApi("/draft", token, { method: "DELETE", tenantHeaders: tenantHeaders(host) }).catch(() => null);
  return new Response(null, { status: 303, headers: { location: "/", "set-cookie": previewCookie("", 0, proto === "https"), ...NO_STORE } });
}
