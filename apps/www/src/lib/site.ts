/** Site-wide constants (pure; safe on server and client). */

/** Canonical origin of the marketing site (absolute URLs in OpenGraph, sitemap, JSON-LD). */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3005").replace(/\/+$/, "");

/** Server-side API origin. */
export const API_ORIGIN = (process.env.API_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4000").replace(/\/+$/, "");

/** The domain shops live under: `<slug>.<SHOP_DOMAIN>` (localhost in dev). Shown next to the slug field. */
export const SHOP_DOMAIN = (process.env.NEXT_PUBLIC_SHOP_DOMAIN || process.env.NEXT_PUBLIC_ROOT_DOMAIN || "localhost").replace(/^\.+|\.+$/g, "");

/**
 * Where each product's app opens for a shop, when the API doesn't hand us a URL: "BL=…,EC=…" with `{slug}`
 * (same format as the API's BILLING_PUBLIC_URL).
 */
const APP_URLS = process.env.NEXT_PUBLIC_APP_URLS || "BL=http://{slug}.localhost:3001,EC=http://{slug}.localhost:3002";

export type AppId = "BL" | "EC";

export function appUrlFor(appId: string | null | undefined, slug: string): string {
  const map = new Map(
    APP_URLS.split(",").map((p) => {
      const [k, ...rest] = p.split("=");
      return [k!.trim(), rest.join("=").trim()] as const;
    }),
  );
  const tpl = map.get(appId === "BL" ? "BL" : "EC") ?? map.get("EC") ?? "http://{slug}.localhost:3002";
  return tpl.replace("{slug}", slug).replace(/\/+$/, "");
}

/** `?app=` on links: billing | store (also accepts BL / EC). */
export function parseApp(v: string | null | undefined): AppId | null {
  const s = (v ?? "").trim().toLowerCase();
  if (s === "billing" || s === "bl") return "BL";
  if (s === "store" || s === "online-store" || s === "ec") return "EC";
  return null;
}
export const appParam = (a: AppId) => (a === "BL" ? "billing" : "store");

export const CONTACT_WHATSAPP = process.env.NEXT_PUBLIC_CONTACT_WHATSAPP || "";
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "hello@srirealtime.com";

export const BUSINESS_TYPES = ["grocery", "textiles", "jewellery", "electronics", "pharmacy", "hardware", "restaurant", "bakery", "stationery", "other"] as const;
