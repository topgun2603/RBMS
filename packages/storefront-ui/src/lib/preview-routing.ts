/*
 * Live-preview constants, paths and origin rules: pure, dependency-free and edge-safe (the store middleware loads
 * this). The message schemas are in preview-protocol.ts.
 */

export const PREVIEW_SOURCE = "sr-preview";
export const PREVIEW_PROTOCOL_VERSION = 1;
/** httpOnly cookie holding the preview token on the store host. */
export const PREVIEW_COOKIE = "sr_preview";
/** `/?__preview=<token>` enters preview mode (the middleware turns it into the cookie). */
export const PREVIEW_QUERY = "__preview";
/** Store route that verifies a token, sets the cookie and redirects (`?token=…&path=/…`). */
export const PREVIEW_ENTER_PATH = "/api/preview/enter";
export const PREVIEW_EXIT_PATH = "/api/preview/exit";
/** Header the store server sends the token to the API in. */
export const PREVIEW_TOKEN_HEADER = "x-preview-token";

const TOKEN_RE = /^pv1\.[A-Za-z0-9_-]{10,400}\.[A-Za-z0-9_-]{43}$/;
/** Cheap shape check before any network call (the API does the real verification). */
export const looksLikePreviewToken = (v: unknown): v is string => typeof v === "string" && v.length <= 512 && TOKEN_RE.test(v);

// ------------------------------------------------------------------ paths

/**
 * A same-origin path the preview may open: `/`, `/p/saree?x=1#top`. Null for absolute / protocol-relative URLs,
 * backslashes, control characters and the API (`/api/...`), so a message or link can't send the frame elsewhere.
 */
export function safePreviewPath(path: unknown): string | null {
  if (typeof path !== "string" || !path.startsWith("/") || path.length > 2048) return null;
  if (path.startsWith("//") || path.includes("\\") || /[\u0000-\u001f\u007f]/.test(path)) return null;
  let url: URL;
  try {
    url = new URL(path, "http://preview.invalid");
  } catch {
    return null;
  }
  if (url.origin !== "http://preview.invalid" || url.pathname.startsWith("/api/") || url.pathname === "/api") return null;
  url.searchParams.delete(PREVIEW_QUERY);
  return `${url.pathname}${url.search}${url.hash}`;
}

// ------------------------------------------------------------------ origins

/**
 * Editor origins allowed to drive the preview, as patterns: an exact origin (`https://app.srikit.in`), a one-label
 * subdomain wildcard (`https://*.srikit.in`) and/or any port (`http://*.localhost:*`). Same `*.` syntax as the API's
 * CORS_ORIGINS. Patterns are also valid CSP `frame-ancestors` sources.
 */
export function originRegex(pattern: string): RegExp | null {
  const m = /^(https?):\/\/(\*\.)?([a-z0-9.-]+)(?::(\d{1,5}|\*))?$/i.exec(pattern.trim());
  if (!m) return null;
  const [, scheme, wild, host, port] = m;
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const portRe = port === "*" ? "(?::\\d{1,5})?" : port ? `:${port}` : "";
  return new RegExp(`^${scheme!.toLowerCase()}://${wild ? "[a-z0-9-]+\\." : ""}${esc(host!.toLowerCase())}${portRe}$`);
}

/** True when `origin` (an exact `scheme://host[:port]`, as in MessageEvent.origin) matches one of the patterns. */
export function isAllowedOrigin(origin: unknown, patterns: readonly string[]): boolean {
  if (typeof origin !== "string" || !origin || origin === "null" || origin.length > 255) return false;
  const o = origin.toLowerCase();
  return patterns.some((p) => originRegex(p)?.test(o) ?? false);
}

/**
 * The editor origins for this deployment: `PREVIEW_EDITOR_ORIGINS` (comma-separated patterns) when set; else, in
 * development, any port on localhost / *.localhost / 127.0.0.1 (the shop apps run on :3000–:3008); in production the
 * platform root domain and its subdomains over https (the shop apps are `<slug>.<root>` / `app.<root>`).
 */
export function editorOrigins(env: { PREVIEW_EDITOR_ORIGINS?: string; NODE_ENV?: string; NEXT_PUBLIC_ROOT_DOMAIN?: string } = process.env): string[] {
  const configured = (env.PREVIEW_EDITOR_ORIGINS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => originRegex(s) !== null);
  if (configured.length) return configured;
  const root = (env.NEXT_PUBLIC_ROOT_DOMAIN || "localhost").toLowerCase().replace(/^\.+|\.+$/g, "");
  if (env.NODE_ENV !== "production") return ["http://localhost:*", "http://*.localhost:*", "http://127.0.0.1:*", ...(root !== "localhost" ? [`http://${root}:*`, `http://*.${root}:*`] : [])];
  return [`https://${root}`, `https://*.${root}`];
}

/** `frame-ancestors` value for preview responses. */
export const frameAncestors = (patterns: readonly string[]) => ["'self'", ...patterns].join(" ");
