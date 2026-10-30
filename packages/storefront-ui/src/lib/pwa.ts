/**
 * Installable storefront (PWA), the pure parts: the web app manifest for a shop, its lettermark icon, the service
 * worker's routing rules and the install banner's eligibility. Shared by the route handlers (server/pwa.ts), the
 * client (client/pwa.tsx) and tests. No Next / DOM imports.
 */

import { packFor, type BusinessType } from "@rbms/verticals";

// ------------------------------------------------------------------ names and colours

/** User-perceived characters (a Tamil letter with its vowel sign is one), so a cut never splits one. */
export function graphemes(s: string): string[] {
  try {
    return Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s), (x) => x.segment);
  } catch {
    return Array.from(s);
  }
}

/** A launcher label: the whole name when it fits in `max` characters, else whole words, else a cut on a grapheme. */
export function shortName(name: string, max = 12): string {
  const clean = name.replace(/\s+/g, " ").trim() || "Store";
  if (graphemes(clean).length <= max) return clean;
  const words = clean.split(" ");
  let out = "";
  for (const w of words) {
    const next = out ? `${out} ${w}` : w;
    if (graphemes(next).length > max) break;
    out = next;
  }
  // Drop a trailing connector ("Raja &" → "Raja").
  out = out.replace(/\s+(&|and|of|the|-|\||·)$/i, "").trim();
  if (out) return out;
  return graphemes(clean).slice(0, max).join("").trim();
}

const SMALL_WORDS = new Set(["the", "and", "of", "&", "-", "|", "·"]);

/**
 * Up to two initials for the lettermark icon ("IronFit Gym" → "IG", "Raja" → "R"). Latin letters and digits only (the
 * icon renderer's bundled font is Latin); a name with none (e.g. Tamil only) → "" and the icon shows a bag glyph.
 */
export function initials(name: string): string {
  const words = name
    .split(/[\s/]+/)
    .map((w) => w.replace(/[^A-Za-z0-9&|·-]/g, ""))
    .filter((w) => w && !SMALL_WORDS.has(w.toLowerCase()));
  const letters = words.map((w) => w.replace(/[^A-Za-z0-9]/g, "")[0]).filter(Boolean) as string[];
  return letters.slice(0, 2).join("").toUpperCase();
}

/** "#abc" / "#aabbcc" / "#aabbccdd" → lower-case "#aabbcc", anything else → null. */
export function normalizeHex(c: string | null | undefined): string | null {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec((c ?? "").trim());
  if (!m) return null;
  let h = m[1]!.toLowerCase();
  if (h.length === 3) h = h.replace(/./g, (x) => x + x);
  return `#${h.slice(0, 6)}`;
}

/** WCAG relative luminance of a hex colour. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
}

/** Black or white text, whichever reads better on `hex` (a neon green primary gets black initials). */
export function readableOn(hex: string): "#ffffff" | "#111111" {
  const l = luminance(normalizeHex(hex) ?? "#7c3aed");
  // Contrast with white vs with near-black (#111, luminance ≈ 0.0056).
  return (1.05 / (l + 0.05) >= (l + 0.05) / 0.0556 ? "#ffffff" : "#111111");
}

export const DEFAULT_PRIMARY = "#7c3aed";

export interface BrandColors {
  primary: string;
  background: string;
}

/** The manifest / theme-color colours from the shop's branding tokens (dark-mode shops default to a dark background). */
export function brandColors(tokens: { colors?: Record<string, unknown>; mode?: unknown } | null | undefined): BrandColors {
  const colors = tokens?.colors ?? {};
  const primary = normalizeHex(typeof colors.primary === "string" ? colors.primary : null) ?? DEFAULT_PRIMARY;
  const bg = normalizeHex(typeof colors.background === "string" ? colors.background : null);
  return { primary, background: bg ?? (tokens?.mode === "dark" ? "#0a0a0a" : "#ffffff") };
}

// ------------------------------------------------------------------ manifest

/** W3C manifest categories per business pack (typed on the pack ids, so a new pack must be listed here). */
export const PACK_CATEGORIES: Record<BusinessType, string[]> = {
  fashion: ["shopping", "lifestyle"],
  pharmacy: ["shopping", "health", "medical"],
  restaurant: ["food"],
  cloud_kitchen: ["food"],
  grocery: ["shopping", "food"],
  bakery: ["food", "shopping"],
  fresh: ["food", "shopping"],
  electronics: ["shopping"],
  repair: ["utilities", "shopping"],
  salon: ["lifestyle"],
  gym: ["fitness", "health", "sports"],
  jewellery: ["shopping", "lifestyle"],
  hardware: ["shopping"],
  optical: ["shopping", "health"],
  tailoring: ["shopping", "lifestyle"],
  organic: ["food", "shopping", "health"],
  footwear: ["shopping", "lifestyle"],
  stationery: ["shopping", "education", "books"],
  toys: ["shopping", "kids"],
  cosmetics: ["shopping", "beauty", "lifestyle"],
  crackers: ["shopping", "lifestyle"],
  florist_pooja: ["shopping", "lifestyle"],
  mobile_accessories: ["shopping", "utilities"],
  furniture: ["shopping", "lifestyle"],
  home_decor: ["shopping", "lifestyle"],
  pet_shop: ["shopping", "lifestyle"],
  sports: ["shopping", "sports", "fitness"],
  tea_stall: ["food"],
  spa: ["lifestyle", "health"],
  school: ["education"],
};

export function manifestCategories(businessType: string | null | undefined): string[] {
  // Through packFor so old free-text types and aliases ("organic store", "textiles") get their pack's categories.
  const pack = packFor(businessType);
  return pack ? PACK_CATEGORIES[pack.id] : ["shopping"];
}

/** Icon files served by `app/app-icon/[file]/route.ts`. */
export const PWA_ICON_FILES = {
  "192.png": { size: 192, maskable: false },
  "512.png": { size: 512, maskable: false },
  "maskable-512.png": { size: 512, maskable: true },
  "apple-touch-icon.png": { size: 180, maskable: false },
} as const;
export type PwaIconFile = keyof typeof PWA_ICON_FILES;
export const PWA_ICON_BASE = "/app-icon";

export function isPwaIconFile(f: string): f is PwaIconFile {
  return Object.prototype.hasOwnProperty.call(PWA_ICON_FILES, f);
}

/** Short stable hash (FNV-1a, base 36) — busts icon caches when the logo, colours or name change. */
export function shortHash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

export interface ManifestInput {
  name: string;
  businessType?: string | null;
  locale?: string | null;
  colors: BrandColors;
  description: string;
  /** Logo URL (or null): only feeds the icon version so a new logo refreshes installed icons. */
  logoUrl?: string | null;
}

export interface WebAppManifest {
  id: string;
  name: string;
  short_name: string;
  description: string;
  lang: string;
  dir: "ltr";
  start_url: string;
  scope: string;
  display: "standalone";
  orientation: "any";
  theme_color: string;
  background_color: string;
  categories: string[];
  icons: { src: string; sizes: string; type: "image/png"; purpose: "any" | "maskable" }[];
}

/** The icons' cache-busting version for a shop. */
export function iconVersion(i: Pick<ManifestInput, "name" | "colors" | "logoUrl">): string {
  return shortHash(`${i.name}|${i.colors.primary}|${i.colors.background}|${i.logoUrl ?? ""}`);
}

export function buildManifest(i: ManifestInput): WebAppManifest {
  const name = i.name.replace(/\s+/g, " ").trim() || "Store";
  const v = iconVersion(i);
  const icon = (file: "192.png" | "512.png" | "maskable-512.png") => {
    const spec = PWA_ICON_FILES[file];
    return {
      src: `${PWA_ICON_BASE}/${file}?v=${v}`,
      sizes: `${spec.size}x${spec.size}`,
      type: "image/png" as const,
      purpose: spec.maskable ? ("maskable" as const) : ("any" as const),
    };
  };
  return {
    id: "/",
    name,
    short_name: shortName(name),
    description: i.description,
    lang: i.locale === "ta" ? "ta-IN" : "en-IN",
    dir: "ltr",
    // ?source=pwa: the storefront's analytics records launches from the home screen as source "pwa" (client/analytics).
    start_url: "/?source=pwa",
    scope: "/",
    display: "standalone",
    orientation: "any",
    theme_color: i.colors.primary,
    background_color: i.colors.background,
    categories: manifestCategories(i.businessType),
    icons: [icon("192.png"), icon("512.png"), icon("maskable-512.png")],
  };
}

// ------------------------------------------------------------------ service worker rules

export type SwStrategy = "bypass" | "cache-first" | "stale-while-revalidate" | "network-first";

export interface SwRequestInfo {
  url: string;
  method: string;
  /** Request.mode ("navigate" for page loads). */
  mode?: string;
  /** Request.destination ("image", "font", "style"…). */
  destination?: string;
  /** The store's origin (self.location.origin). */
  origin: string;
  /** URL prefixes product images are served from (`<api>/v1/uploads/`, a CDN). */
  uploads: string[];
}

/**
 * How the service worker handles a request. Self-contained on purpose (no outer references): the worker script embeds
 * this function's source (server/pwa.ts), so what is tested here is what ships.
 *
 * - never touched (browser default): non-GET, other origins we don't know, the cart / checkout / account / order pages
 *   and any path under them, `/api/*`, token pages (track, booking, job), live preview, the worker itself, RSC fetches;
 * - cache-first: `/_next/static/*` (content-hashed), Google Fonts;
 * - stale-while-revalidate: product images from the uploads URL, the app icons;
 * - network-first with the offline page as fallback: page navigations.
 */
export function swStrategy(r: SwRequestInfo): SwStrategy {
  if (String(r.method).toUpperCase() !== "GET") return "bypass";
  let u: URL;
  try {
    u = new URL(r.url);
  } catch {
    return "bypass";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return "bypass";
  if (u.origin === r.origin) {
    const p = u.pathname;
    if (/^\/(cart|checkout|account|order|orders|api|track|track-repair|booking|job|preview)(\/|$)/.test(p)) return "bypass";
    if (u.searchParams.has("__preview") || u.searchParams.has("_rsc")) return "bypass";
    if (p === "/sw.js") return "bypass";
    if (p.indexOf("/_next/static/") === 0) return "cache-first";
    if (p.indexOf("/app-icon/") === 0) return "stale-while-revalidate";
    if (p.indexOf("/_next/") === 0) return "bypass";
    if (r.mode === "navigate") return "network-first";
    return "bypass";
  }
  if (u.hostname === "fonts.gstatic.com") return "cache-first";
  if (u.hostname === "fonts.googleapis.com") return "stale-while-revalidate";
  const href = u.href;
  for (let i = 0; i < r.uploads.length; i++) {
    const prefix = r.uploads[i];
    if (prefix && href.indexOf(prefix) === 0) {
      const isImage = r.destination === "image" || /\.(avif|webp|png|jpe?g|gif|svg)$/i.test(u.pathname);
      return isImage ? "stale-while-revalidate" : "bypass";
    }
  }
  return "bypass";
}

export interface SwResponseInfo {
  status: number;
  /** Response.type: "basic", "cors", "opaque"… */
  type: string;
  headers: { get(name: string): string | null };
}

/**
 * May the worker store this response? Only complete 200s whose headers allow it: never a response with set-cookie,
 * `cache-control: private / no-store`, or `vary: *`, and never an opaque response (unreadable, and padded to megabytes
 * in the quota). Self-contained (embedded in the worker like swStrategy).
 */
export function swCacheable(res: SwResponseInfo): boolean {
  if (res.status !== 200) return false;
  if (res.type !== "basic" && res.type !== "cors" && res.type !== "default") return false;
  if (res.headers.get("set-cookie")) return false;
  const cc = (res.headers.get("cache-control") || "").toLowerCase();
  if (/(^|[\s,])(private|no-store)([\s,=]|$)/.test(cc)) return false;
  if ((res.headers.get("vary") || "").trim() === "*") return false;
  return true;
}

// ------------------------------------------------------------------ install banner

/** Inline before the app: keeps an early `beforeinstallprompt` (it can fire before React hydrates) for the banner. */
export const PWA_EARLY_SCRIPT =
  "window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__srInstallPrompt=e;});";

export const INSTALL_DISMISS_KEY = "sr_pwa_dismissed";
export const INSTALL_VIEWS_KEY = "sr_pwa_views";
export const INSTALL_DISMISS_DAYS = 30;
export const INSTALL_MIN_PAGE_VIEWS = 2;

export type InstallUi = "none" | "prompt" | "ios";

export interface InstallState {
  /** The shop's "Show install app banner" setting (default on). */
  enabled: boolean;
  pathname: string;
  pagesViewed: number;
  /** Epoch ms of the last dismissal, or null. */
  dismissedAt: number | null;
  now: number;
  /** Already running as an installed app. */
  standalone: boolean;
  /** A captured `beforeinstallprompt` (Android / Chrome / Edge). */
  canPrompt: boolean;
  /** iOS Safari (no beforeinstallprompt; Share → Add to Home Screen). */
  ios: boolean;
}

/** Pages where the banner never shows (buying, paying, signing in). */
export function isQuietPath(pathname: string): boolean {
  return /^\/(cart|checkout|account|order|orders|track|booking|job|table)(\/|$)/.test(pathname);
}

/** Which install UI to show now. */
export function installUi(s: InstallState): InstallUi {
  if (!s.enabled || s.standalone) return "none";
  if (isQuietPath(s.pathname)) return "none";
  if (s.pagesViewed < INSTALL_MIN_PAGE_VIEWS) return "none";
  if (s.dismissedAt !== null && s.now - s.dismissedAt < INSTALL_DISMISS_DAYS * 86_400_000 && s.now >= s.dismissedAt) return "none";
  if (s.canPrompt) return "prompt";
  if (s.ios) return "ios";
  return "none";
}

/** iPhone / iPad Safari (not Chrome / Firefox / in-app browsers on iOS, which can't add to the home screen the same way). */
export function isIosSafari(ua: string, maxTouchPoints = 0): boolean {
  const iDevice = /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && maxTouchPoints > 1);
  if (!iDevice) return false;
  if (/CriOS|FxiOS|EdgiOS|OPiOS|GSA\/|FBAN|FBAV|Instagram|Line\//.test(ua)) return false;
  return /Safari\//.test(ua) && /Version\//.test(ua);
}
