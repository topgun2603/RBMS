import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { cache } from "react";
import { normalizeLocale, LOCALE_COOKIE, translatorFor, type Locale, type Translator } from "../lib/messages";
import { API_ORIGIN, tenantFromHost, upstreamTenantHeaders } from "../lib/tenant";
import { previewTransform } from "./preview";
import { cacheTags } from "../lib/cache-tags";
import type { Branding, Menus, PricedCart, StoreConfig, StoreShell, StoreThemeView } from "../types";

/** Cookie holding the anonymous / shopper cart token (read on the server for the header count). */
export const CART_COOKIE = "sr_cart";

export class UpstreamError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "UpstreamError";
  }
}

export interface RequestInfo {
  /** Host as the shopper typed it (anbu.localhost:3003, www.shop.in). */
  host: string;
  /** Shop slug for `<slug>.<root>` hosts, null on custom domains. */
  slug: string | null;
  /** "https://anbu.srikit.in" — canonical URLs, JSON-LD, sitemap links. */
  baseUrl: string;
  locale: Locale;
  t: Translator;
  /** Headers that make the API resolve this shop. */
  tenantHeaders: Record<string, string>;
  cartToken: string | null;
}

/** Per-request facts about the shop (memoised for the request). */
export const getRequestInfo = cache(async (): Promise<RequestInfo> => {
  const h = await headers();
  const c = await cookies();
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "";
  const proto = (h.get("x-forwarded-proto") ?? "").split(",")[0]?.trim() || (/^(localhost|127\.|[^.]+\.localhost)/.test(host) ? "http" : "https");
  const locale = normalizeLocale(c.get(LOCALE_COOKIE)?.value);
  const cart = c.get(CART_COOKIE)?.value ?? null;
  return {
    host,
    slug: tenantFromHost(host),
    baseUrl: `${proto}://${host}`,
    locale,
    t: translatorFor(locale),
    tenantHeaders: upstreamTenantHeaders(host),
    cartToken: cart && /^[A-Za-z0-9_-]{16,64}$/.test(cart) ? cart : null,
  };
});

export interface GetOptions {
  /** Seconds to cache the response in Next's data cache (default 60). 0 = always fresh. */
  revalidate?: number;
  query?: Record<string, string | number | boolean | null | undefined | string[]>;
}

function buildUrl(path: string, query?: GetOptions["query"]): string {
  const url = new URL(`${API_ORIGIN}/v1${path.startsWith("/") ? path : `/${path}`}`);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x));
    else url.searchParams.set(k, String(v));
  }
  return url.toString();
}

/** GET a public API path for the current shop. Throws UpstreamError (404 included). */
export async function apiGet<T>(path: string, opts: GetOptions = {}): Promise<T> {
  const info = await getRequestInfo();
  const revalidate = opts.revalidate ?? 60;
  let res: Response;
  try {
    res = await fetch(buildUrl(path, opts.query), {
      headers: { accept: "application/json", "accept-language": info.locale, ...info.tenantHeaders },
      // Tagged per shop and resource: the API asks app/api/revalidate to clear them right after staff changes (lib/cache-tags);
      // `revalidate` stays the fallback.
      ...(revalidate > 0 ? { next: { revalidate, tags: cacheTags(info.slug ?? info.host, path) } } : { cache: "no-store" as const }),
    });
  } catch (err) {
    throw new UpstreamError(503, "network_error", err instanceof Error ? err.message : "API unreachable");
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: { code?: string; message?: string } } | null;
    throw new UpstreamError(res.status, body?.error?.code ?? `http_${res.status}`, body?.error?.message ?? res.statusText);
  }
  // Live preview: the unsaved home / brand tokens for staff previews (no-op for shoppers; server/preview.ts).
  return previewTransform(path, (await res.json()) as T);
}

/** Like apiGet, but 404 → null. */
export async function apiGetOrNull<T>(path: string, opts?: GetOptions): Promise<T | null> {
  try {
    return await apiGet<T>(path, opts);
  } catch (err) {
    if (err instanceof UpstreamError && err.status === 404) return null;
    throw err;
  }
}

/** Like apiGet, but any failure → fallback (optional sections: ratings, reviews, availability). */
export async function apiGetSafe<T>(path: string, fallback: T, opts?: GetOptions): Promise<T> {
  try {
    return await apiGet<T>(path, opts);
  } catch {
    return fallback;
  }
}

/**
 * Like apiGetSafe, for answers that are empty when something upstream is wrong or just changed (a home with no
 * sections, a tile count of 0): an empty cached answer is checked once more uncached, so it never sticks for the
 * revalidate period (the API restarting mid-seed, a store seeded right after its first visit). A failure is never
 * cached (Next's data cache keeps only 200 responses; the fallback is per request), and a non-empty answer keeps the
 * normal cache. See lib/cache-tags for the instant refresh after staff edits.
 */
export async function apiGetFresh<T>(path: string, fallback: T, isEmpty: (v: T) => boolean, opts: GetOptions = {}): Promise<T> {
  const first = await apiGetSafe<T>(path, fallback, opts);
  if (!isEmpty(first) || (opts.revalidate ?? 60) === 0) return first;
  return apiGetSafe<T>(path, first, { ...opts, revalidate: 0 });
}

/** Shop config, or null when the host has no shop (unknown subdomain / unverified domain). */
export const getConfig = cache(async (): Promise<StoreConfig | null> => {
  const info = await getRequestInfo();
  if (!info.slug && !info.tenantHeaders["x-forwarded-host"]) return null;
  return apiGetOrNull<StoreConfig>("/store/config", { revalidate: 30 });
});

/** The shop's config, or a 404 for hosts without a shop (unknown subdomain / unverified custom domain). */
export async function requireStore(): Promise<StoreConfig> {
  const c = await getConfig().catch(() => null);
  if (!c) notFound();
  return c;
}

export const getBranding = cache(async () => apiGetSafe<Branding | null>("/branding", null, { revalidate: 60 }));

/** Feature keys on for this shop (empty when the call fails: optional storefront sections then stay hidden). */
export const getFeatures = cache(async (): Promise<string[]> => {
  const r = await apiGetSafe<{ enabled?: string[] } | null>("/features", null, { revalidate: 30 });
  return Array.isArray(r?.enabled) ? r.enabled : [];
});

/** True when the shop has the feature on (see getFeatures). */
export async function hasFeature(key: string): Promise<boolean> {
  return (await getFeatures()).includes(key);
}

export const getMenus = cache(async () => apiGetSafe<Menus>("/cms/public/menus", { header: [], footer: [] }, { revalidate: 60 }));

/** The cart behind the cookie, fresh (null when there's none or it expired). */
export const getCart = cache(async (): Promise<PricedCart | null> => {
  const info = await getRequestInfo();
  if (!info.cartToken) return null;
  return apiGetSafe<PricedCart | null>(`/store/cart/${encodeURIComponent(info.cartToken)}`, null, { revalidate: 0 });
});

/** Branding CSS with the store's type stack appended as fallbacks (Plus Jakarta Sans + Noto Sans Tamil). */
export function storeCss(css: string | null | undefined): string {
  if (!css) return "";
  const fallback = `var(--font-jakarta, "Plus Jakarta Sans"), var(--font-noto-tamil, "Noto Sans Tamil"), ui-sans-serif, system-ui, sans-serif`;
  return css
    .replace(/(--font-(?:sans|heading)\s*:\s*)([^;]+);/g, (_m, k: string, v: string) => `${k}${v.replace(/,?\s*ui-sans-serif.*$/, "")}, ${fallback};`)
    .replace(/<\/style/gi, "<\\/style");
}

/** What every client component gets (shop basics + the initial cart badge). */
export async function getShell(config: StoreConfig, branding: Branding | null): Promise<StoreShell> {
  const info = await getRequestInfo();
  const [cart, features] = await Promise.all([getCart(), getFeatures()]);
  return {
    slug: config.shop.slug ?? info.slug ?? "",
    name: config.shop.name,
    logoUrl: config.shop.logoUrl ?? branding?.logoUrl ?? null,
    open: config.open,
    closedMessage: config.closedMessage,
    codEnabled: config.codEnabled,
    codMaxAmount: config.codMaxAmount,
    minOrderValue: config.minOrderValue,
    onlinePayments: config.onlinePayments,
    deliveryEnabled: config.deliveryEnabled,
    pickupEnabled: config.pickupEnabled,
    pickupNote: config.pickupNote,
    contactPhone: config.shop.contactPhone,
    contactEmail: config.shop.contactEmail,
    whatsapp: config.shop.social?.whatsapp ?? null,
    cartToken: cart ? cart.token : info.cartToken,
    cartCount: cart?.itemCount ?? 0,
    features,
    businessType: config.shop.businessType ?? "",
    theme: themeView(config.shop.theme),
  };
}

const THEME_DEFAULTS: StoreThemeView = {
  header: "classic",
  hero: "slider",
  card: "standard",
  imageRatio: "portrait",
  buttons: "pill",
  density: "comfortable",
  sections: "plain",
  motif: "kolam",
  headings: "display",
  headerStyle: "glass",
  sticky: "always",
  megaMenu: "images",
  announcement: "dismissible",
  footer: "columns",
  cardHover: "rich",
  cardButton: "hover",
  productLayout: "thumbs-side",
  productDetails: "accordion",
  stickyBuy: "on",
  productTrust: "on",
  related: "rail",
  listingFilters: "sidebar",
  listingColumns: "4",
  listingView: "grid",
  listingPaging: "pages",
  categoryHeader: "simple",
  subcategories: "off",
  compare: "off",
  pageLayout: "standard",
  mobileNav: "off",
};

/** The shop's theme variants with defaults for anything missing (older APIs send none). */
export function themeView(theme: Record<string, string> | null | undefined): StoreThemeView {
  return { ...THEME_DEFAULTS, ...(theme ?? {}) } as StoreThemeView;
}

/** The store translator with the shop's business-pack wording (search box, "new arrivals", newsletter). */
export const getStoreT = cache(async (): Promise<Translator> => {
  const [info, config] = await Promise.all([getRequestInfo(), getConfig().catch(() => null)]);
  return config?.shop.businessType ? translatorFor(info.locale, config.shop.businessType) : info.t;
});
