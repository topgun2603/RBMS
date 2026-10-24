import { readFileSync } from "node:fs";
import type { ReactElement } from "react";
import { join } from "node:path";
import { ImageResponse } from "next/og";
import { API_ORIGIN, PUBLIC_API_ORIGIN, tenantFromHost, upstreamTenantHeaders } from "../lib/tenant";
import { cacheTags } from "../lib/cache-tags";
import { LOCALE_COOKIE, normalizeLocale, translatorFor, type Locale } from "../lib/messages";
import {
  brandColors,
  buildManifest,
  iconVersion,
  initials,
  isPwaIconFile,
  PWA_ICON_BASE,
  PWA_ICON_FILES,
  readableOn,
  shortHash,
  swCacheable,
  swStrategy,
  type BrandColors,
  type PwaIconFile,
} from "../lib/pwa";
import type { StoreConfig } from "../types";

/**
 * Installable storefront (PWA) route handlers, mounted by apps/store:
 *   app/manifest.webmanifest/route.ts → manifestHandler
 *   app/app-icon/[file]/route.ts      → appIconHandler (192.png, 512.png, maskable-512.png, apple-touch-icon.png)
 *   app/sw.js/route.ts                → serviceWorkerHandler
 *   app/offline.html/route.ts         → offlinePageHandler
 * Each resolves the shop from the request host exactly like the pages (x-tenant / x-forwarded-host); a host without a
 * shop (unknown subdomain, unverified domain, store switched off) gets a 404 like the store.
 */

/** The `store` setting that hides the install banner (default on; older APIs don't send it). */
export type PwaStoreConfig = StoreConfig & { installBanner?: boolean };

interface BrandingLite {
  appName?: string;
  logoUrl?: string | null;
  logoDarkUrl?: string | null;
  tokens?: { colors?: Record<string, unknown>; mode?: unknown };
}

export interface PwaShop {
  key: string;
  name: string;
  businessType: string;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  colors: BrandColors;
  locale: Locale;
}

function requestHost(req: Request): string {
  return req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? new URL(req.url).host;
}

function cookieLocale(req: Request): Locale {
  const m = new RegExp(`(?:^|;\\s*)${LOCALE_COOKIE}=([^;]+)`).exec(req.headers.get("cookie") ?? "");
  return normalizeLocale(m?.[1] ? decodeURIComponent(m[1]) : undefined);
}

/** The shop on the request host (null → 404), from the same cached API calls as the pages. */
export async function pwaShop(req: Request): Promise<PwaShop | null> {
  const host = requestHost(req);
  const tenant = upstreamTenantHeaders(host);
  if (!Object.keys(tenant).length) return null;
  const key = tenantFromHost(host) ?? host;
  const headers = { accept: "application/json", ...tenant };
  const get = async <T,>(path: string, revalidate: number): Promise<T | null> => {
    try {
      const res = await fetch(`${API_ORIGIN}/v1${path}`, { headers, next: { revalidate, tags: cacheTags(key, path) } });
      return res.ok ? ((await res.json()) as T) : null;
    } catch {
      return null;
    }
  };
  const [config, branding] = await Promise.all([get<PwaStoreConfig>("/store/config", 30), get<BrandingLite>("/branding", 60)]);
  if (!config?.shop) return null;
  return {
    key,
    name: config.shop.name?.trim() || branding?.appName?.trim() || "Store",
    businessType: config.shop.businessType ?? "",
    logoUrl: config.shop.logoUrl ?? branding?.logoUrl ?? null,
    logoDarkUrl: branding?.logoDarkUrl ?? null,
    colors: brandColors(branding?.tokens),
    locale: cookieLocale(req),
  };
}

const notFound = () => new Response("Not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });

// ------------------------------------------------------------------ manifest

/** `GET /manifest.webmanifest`: the shop's web app manifest. */
export async function manifestHandler(req: Request): Promise<Response> {
  const shop = await pwaShop(req);
  if (!shop) return notFound();
  const t = translatorFor(shop.locale, shop.businessType);
  const manifest = buildManifest({
    name: shop.name,
    businessType: shop.businessType,
    locale: shop.locale,
    colors: shop.colors,
    description: t("pwa.description", { name: shop.name }),
    logoUrl: shop.logoUrl,
  });
  return new Response(JSON.stringify(manifest), {
    headers: {
      "content-type": "application/manifest+json; charset=utf-8",
      "cache-control": "public, max-age=600, stale-while-revalidate=86400",
      vary: "cookie",
    },
  });
}

// ------------------------------------------------------------------ icons

const LOGO_TYPES = /^image\/(png|jpeg|gif|svg\+xml)$/;
const LOGO_MAX_BYTES = 3 * 1024 * 1024;

/** `p`, or `fallback` after `ms` (an upstream that never answers can't hold up an icon). */
function within<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((r) => setTimeout(() => r(fallback), ms))]);
}

/** The logo as a data: URI the icon renderer can draw (PNG / JPEG / GIF / SVG; WebP & co. → null → lettermark). */
function logoData(url: string | null): Promise<string | null> {
  return within(fetchLogo(url), 6000, null);
}

async function fetchLogo(url: string | null): Promise<string | null> {
  if (!url) return null;
  const abs = /^https?:/i.test(url) ? url : `${API_ORIGIN}${url.startsWith("/") ? "" : "/"}${url}`;
  try {
    const res = await fetch(abs, { signal: AbortSignal.timeout(5000), next: { revalidate: 3600 } });
    if (!res.ok) return null;
    const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (!LOGO_TYPES.test(type)) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (!buf.length || buf.length > LOGO_MAX_BYTES) return null;
    return `data:${type};base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

function BagGlyph({ size, color }: { size: number; color: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z" />
      <path d="M3 6h18" />
      <path d="M16 10a4 4 0 0 1-8 0" />
    </svg>
  );
}

/**
 * One icon. `any` icons are a rounded tile; maskable and Apple icons fill the square (the OS cuts its own shape), with
 * the mark inside the maskable safe zone (the centre 80% circle).
 */
function iconElement(shop: Pick<PwaShop, "name" | "colors">, file: PwaIconFile, logo: string | null) {
  const { size, maskable } = PWA_ICON_FILES[file];
  const fullBleed = maskable || file === "apple-touch-icon.png";
  const radius = fullBleed ? 0 : Math.round(size * 0.22);
  if (logo) {
    const box = Math.round(size * (maskable ? 0.6 : fullBleed ? 0.76 : 0.78));
    return (
      <div style={{ width: size, height: size, display: "flex", alignItems: "center", justifyContent: "center", background: shop.colors.background, borderRadius: radius }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={logo} width={box} height={box} style={{ objectFit: "contain" }} alt="" />
      </div>
    );
  }
  const ink = readableOn(shop.colors.primary);
  const text = initials(shop.name);
  const scale = maskable ? 0.78 : 1;
  return (
    <div
      style={{
        width: size,
        height: size,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: shop.colors.primary,
        borderRadius: radius,
        color: ink,
        fontSize: Math.round(size * (text.length > 1 ? 0.42 : 0.52) * scale),
        fontFamily: '"Plus Jakarta Sans"',
        fontWeight: 700,
        letterSpacing: text.length > 1 ? -Math.round(size * 0.01) : 0,
        lineHeight: 1,
      }}
    >
      {text || <BagGlyph size={Math.round(size * 0.5 * scale)} color={ink} />}
    </div>
  );
}

/**
 * Plus Jakarta Sans Bold (the store's face) for the initials, fetched once per server from Google Fonts as TTF (the
 * renderer can't read woff2); null when unreachable → the renderer's bundled Noto Sans.
 */
let iconFontData: ArrayBuffer | null = null;
let iconFontLoading: Promise<ArrayBuffer | null> | null = null;
let iconFontStarted = 0;

async function loadIconFont(): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch("https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@700", { cache: "no-store", signal: AbortSignal.timeout(4000) }).then((r) => (r.ok ? r.text() : ""));
    const url = /src:\s*url\(([^)]+)\)\s*format\('(?:truetype|opentype)'\)/.exec(css)?.[1];
    if (!url) return null;
    const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(6000) });
    return res.ok ? await res.arrayBuffer() : null;
  } catch {
    return null;
  }
}

/** Never waits more than 5 s (a stuck download can't hold up icons); retried at most once a minute after a failure. */
async function iconFont(): Promise<ArrayBuffer | null> {
  if (iconFontData) return iconFontData;
  const now = Date.now();
  if (!iconFontLoading || now - iconFontStarted > 60_000) {
    iconFontStarted = now;
    const loading: Promise<ArrayBuffer | null> = loadIconFont().then((f) => {
      if (f) iconFontData = f;
      return f;
    });
    iconFontLoading = loading;
  }
  return within(iconFontLoading, 5000, null);
}

async function renderPng(el: ReactElement, size: number, withFont: boolean): Promise<ArrayBuffer> {
  const font = withFont ? await iconFont() : null;
  return new ImageResponse(el, {
    width: size,
    height: size,
    ...(font ? { fonts: [{ name: "Plus Jakarta Sans", data: font, weight: 700 as const, style: "normal" as const }] } : {}),
  }).arrayBuffer();
}

/**
 * One icon as PNG bytes: the logo (a data: URI) when there is one and it renders, else the lettermark. `withFont`
 * false skips the brand font download (tests).
 */
export async function renderAppIcon(shop: Pick<PwaShop, "name" | "colors">, file: PwaIconFile, logo: string | null, withFont = true): Promise<ArrayBuffer> {
  const { size } = PWA_ICON_FILES[file];
  if (logo) {
    try {
      return await renderPng(iconElement(shop, file, logo), size, false);
    } catch {
      /* a logo the renderer can't draw: the lettermark */
    }
  }
  return renderPng(iconElement(shop, file, null), size, withFont);
}

/** `GET /app-icon/<file>`: the shop's app icon (logo, else a lettermark on the brand colour), PNG. */
export async function appIconHandler(req: Request, ctx: { params: Promise<{ file: string }> }): Promise<Response> {
  const { file } = await ctx.params;
  if (!isPwaIconFile(file)) return notFound();
  const shop = await pwaShop(req);
  if (!shop) return notFound();
  const darkBg = readableOn(shop.colors.background) === "#ffffff";
  const logo = await logoData((darkBg && shop.logoDarkUrl) || shop.logoUrl);
  const png = await renderAppIcon(shop, file, logo);
  return new Response(png, {
    headers: {
      "content-type": "image/png",
      // The manifest links icons with ?v=<hash of name, colours, logo>, so a long cache is safe.
      "cache-control": "public, max-age=86400, stale-while-revalidate=604800",
      etag: `"${iconVersion(shop)}-${file}"`,
    },
  });
}

// ------------------------------------------------------------------ service worker

let buildIdCache: string | null = null;

/** SR_BUILD_ID, else the Next build id (`.next/BUILD_ID`, written by next build), else "dev". */
export function storeBuildId(): string {
  if (buildIdCache) return buildIdCache;
  const env = process.env.SR_BUILD_ID?.trim();
  if (env) return (buildIdCache = env);
  // next dev never registers the worker (client/pwa), and .next may hold an older production build.
  if (process.env.NODE_ENV === "development") return (buildIdCache = "dev");
  try {
    const id = readFileSync(join(process.cwd(), ".next", "BUILD_ID"), "utf8").trim();
    if (id) return (buildIdCache = id);
  } catch {
    /* not a next build directory */
  }
  return (buildIdCache = "dev");
}

/** Where product images come from: the API's uploads path, plus a CDN (NEXT_PUBLIC_UPLOADS_URL) when one is set. */
export function uploadPrefixes(): string[] {
  const out = [`${PUBLIC_API_ORIGIN}/v1/uploads/`];
  const cdn = process.env.NEXT_PUBLIC_UPLOADS_URL?.trim();
  if (cdn) out.push(cdn.endsWith("/") ? cdn : `${cdn}/`);
  return out;
}

export const OFFLINE_URL = "/offline.html";

/**
 * The service worker script. One file for every shop (the rules don't depend on the shop); the cache names carry the
 * build id, so a deploy installs a new worker and `activate` deletes the old caches. The routing rules are the tested
 * lib/pwa functions, embedded by source.
 */
export function serviceWorkerSource(opts: { buildId: string; uploads: string[] }): string {
  const body = `
"use strict";
const VERSION = ${JSON.stringify(opts.buildId)};
const PREFIX = "sr-store-";
const STATIC_CACHE = PREFIX + "static-" + VERSION;
const IMAGE_CACHE = PREFIX + "images-" + VERSION;
const PAGE_CACHE = PREFIX + "pages-" + VERSION;
const KEEP = [STATIC_CACHE, IMAGE_CACHE, PAGE_CACHE];
const OFFLINE_URL = ${JSON.stringify(OFFLINE_URL)};
const PRECACHE = [OFFLINE_URL, ${JSON.stringify(`${PWA_ICON_BASE}/192.png`)}];
const UPLOADS = ${JSON.stringify(opts.uploads)};
const NO_CORS = new Set();
const LIMITS = { [IMAGE_CACHE]: 150, [PAGE_CACHE]: 30, [STATIC_CACHE]: 400 };
const swStrategy = ${swStrategy.toString()};
const swCacheable = ${swCacheable.toString()};

async function trim(name) {
  const max = LIMITS[name];
  if (!max) return;
  const cache = await caches.open(name);
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function put(name, req, res) {
  if (!swCacheable(res)) return;
  try {
    const cache = await caches.open(name);
    await cache.put(req, res);
    await trim(name);
  } catch (e) {
    /* quota or opaque: skip */
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(PAGE_CACHE)
      .then((cache) =>
        Promise.all(
          PRECACHE.map((url) =>
            fetch(url, { cache: "reload" })
              .then((res) => (res.ok ? cache.put(url, res) : undefined))
              .catch(() => undefined),
          ),
        ),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((n) => n.indexOf(PREFIX) === 0 && KEEP.indexOf(n) < 0).map((n) => caches.delete(n))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

async function cacheFirst(req, name) {
  const hit = await caches.match(req, { cacheName: name });
  if (hit) return hit;
  const res = await fetch(req);
  put(name, req, res.clone());
  return res;
}

async function staleWhileRevalidate(event, req, name, cors) {
  const hit = await caches.match(req, { cacheName: name });
  // Product images are plain <img> (no-cors → opaque, uncacheable); refetch them with CORS so they can be stored. An
  // image host that doesn't allow this store's origin (API CORS_ORIGINS) is remembered: plain, uncached fetches from then on.
  const host = new URL(req.url).origin;
  const net = (cors && !NO_CORS.has(host)
    ? fetch(new Request(req.url, { mode: "cors", credentials: "omit" })).catch(() => {
        NO_CORS.add(host);
        return fetch(req);
      })
    : fetch(req))
    .then((res) => {
      put(name, req, res.clone());
      return res;
    });
  if (hit) {
    event.waitUntil(net.catch(() => undefined));
    return hit;
  }
  return net;
}

async function networkFirstPage(req) {
  try {
    const res = await fetch(req);
    put(PAGE_CACHE, req, res.clone());
    return res;
  } catch (e) {
    const hit = await caches.match(req, { cacheName: PAGE_CACHE, ignoreVary: true });
    if (hit) return hit;
    const offline = await caches.match(OFFLINE_URL, { cacheName: PAGE_CACHE });
    return offline || new Response("Offline", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const strategy = swStrategy({ url: req.url, method: req.method, mode: req.mode, destination: req.destination, origin: self.location.origin, uploads: UPLOADS });
  if (strategy === "bypass") return;
  if (strategy === "network-first") event.respondWith(networkFirstPage(req));
  else if (strategy === "cache-first") event.respondWith(cacheFirst(req, STATIC_CACHE));
  else if (strategy === "stale-while-revalidate") {
    const sameOrigin = new URL(req.url).origin === self.location.origin;
    event.respondWith(staleWhileRevalidate(event, req, sameOrigin ? STATIC_CACHE : IMAGE_CACHE, !sameOrigin && req.mode === "no-cors"));
  }
});
`;
  return `/* srikit storefront service worker · build ${opts.buildId} · ${shortHash(body)} */${body}`;
}

/** `GET /sw.js`. Same script for every shop; not cached by the browser's HTTP cache (updates are checked each load). */
export async function serviceWorkerHandler(): Promise<Response> {
  return new Response(serviceWorkerSource({ buildId: storeBuildId(), uploads: uploadPrefixes() }), {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      "cache-control": "no-cache, max-age=0",
      "service-worker-allowed": "/",
    },
  });
}

// ------------------------------------------------------------------ offline page

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

/** The offline page's HTML: self-contained (inline styles, the precached app icon), in the shop's name and colours. */
export function offlinePageHtml(shop: Pick<PwaShop, "name" | "colors" | "locale" | "businessType">): string {
  const t = translatorFor(shop.locale, shop.businessType);
  const ink = readableOn(shop.colors.primary);
  const bgInk = readableOn(shop.colors.background) === "#ffffff" ? "#f5f5f5" : "#1a1a1a";
  return `<!doctype html>
<html lang="${shop.locale}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="${shop.colors.primary}">
<meta name="robots" content="noindex">
<title>${esc(t("pwa.offline.title"))} · ${esc(shop.name)}</title>
<style>
*{box-sizing:border-box}
html,body{margin:0;min-height:100%;background:${shop.colors.background};color:${bgInk};font-family:"Plus Jakarta Sans","Noto Sans Tamil",ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif}
main{min-height:100dvh;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:24px 16px;text-align:center}
img{width:72px;height:72px;border-radius:18px}
.name{font-weight:700;font-size:15px;opacity:.75;margin:0}
h1{font-size:22px;margin:8px 0 0}
p{max-width:340px;line-height:1.5;margin:0;opacity:.8}
button{margin-top:8px;border:0;border-radius:999px;padding:12px 24px;font:inherit;font-weight:600;background:${shop.colors.primary};color:${ink};cursor:pointer}
button:focus-visible{outline:3px solid ${shop.colors.primary};outline-offset:3px}
</style>
</head>
<body>
<main>
<img src="${PWA_ICON_BASE}/192.png" alt="">
<p class="name">${esc(shop.name)}</p>
<h1>${esc(t("pwa.offline.title"))}</h1>
<p>${esc(t("pwa.offline.body"))}</p>
<button type="button" onclick="location.reload()">${esc(t("pwa.offline.retry"))}</button>
</main>
<script>addEventListener("online",function(){location.reload()})</script>
</body>
</html>`;
}

/** `GET /offline.html`: what the service worker shows for a page it can't load. */
export async function offlinePageHandler(req: Request): Promise<Response> {
  const shop = await pwaShop(req);
  if (!shop) return notFound();
  return new Response(offlinePageHtml(shop), {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=0, must-revalidate", "x-robots-tag": "noindex" },
  });
}
