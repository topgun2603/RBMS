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
const APP_URLS = process.env.NEXT_PUBLIC_APP_URLS || "BL=http://{slug}.localhost:3001,EC=http://{slug}.localhost:3002,PH=http://{slug}.localhost:3006,RS=http://{slug}.localhost:3007,SV=http://{slug}.localhost:3008,SC=http://{slug}.localhost:3009";

export type AppId = "BL" | "EC" | "PH" | "RS" | "SV" | "SC";
export const APP_IDS: readonly AppId[] = ["BL", "EC", "PH", "RS", "SV", "SC"];

export function appUrlFor(appId: string | null | undefined, slug: string): string {
  const map = new Map(
    APP_URLS.split(",").map((p) => {
      const [k, ...rest] = p.split("=");
      return [k!.trim(), rest.join("=").trim()] as const;
    }),
  );
  const tpl = map.get(APP_IDS.includes(appId as AppId) ? (appId as AppId) : "EC") ?? map.get("EC") ?? "http://{slug}.localhost:3002";
  return tpl.replace("{slug}", slug).replace(/\/+$/, "");
}

/** `?app=` on links: billing | store | pharmacy | restaurant (also accepts BL / EC / PH / RS). */
export function parseApp(v: string | null | undefined): AppId | null {
  const s = (v ?? "").trim().toLowerCase();
  if (s === "billing" || s === "bl") return "BL";
  if (s === "store" || s === "online-store" || s === "ec") return "EC";
  if (s === "pharmacy" || s === "medical" || s === "ph") return "PH";
  if (s === "restaurant" || s === "rs") return "RS";
  if (s === "services" || s === "salon" || s === "gym" || s === "sv") return "SV";
  if (s === "school" || s === "sc") return "SC";
  return null;
}
const APP_PARAMS: Record<AppId, string> = { BL: "billing", EC: "store", PH: "pharmacy", RS: "restaurant", SV: "services", SC: "school" };
export const appParam = (a: AppId) => APP_PARAMS[a];

/**
 * Where /login may send a sign-in back after a phone check for another app (`?return=`, docs/firebase-auth.md):
 * comma-separated origins, `*` = one subdomain label (same format as the API's CORS_ORIGINS). Only the shop apps and
 * admin; never the storefronts, which run shop-supplied content.
 */
export const PHONE_RETURN_ORIGINS = (
  process.env.NEXT_PUBLIC_PHONE_RETURN_ORIGINS ||
  "http://localhost:3000,http://localhost:3001,http://*.localhost:3001,http://localhost:3002,http://*.localhost:3002,http://localhost:3004,http://*.localhost:3004,http://localhost:3006,http://*.localhost:3006,http://localhost:3007,http://*.localhost:3007,http://localhost:3008,http://*.localhost:3008"
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const CONTACT_WHATSAPP = process.env.NEXT_PUBLIC_CONTACT_WHATSAPP || "";
export const CONTACT_EMAIL = process.env.NEXT_PUBLIC_CONTACT_EMAIL || "hello@srirealtime.com";

/** The trades a shop can pick at sign-up: the 15 business packs (@rbms/verticals). */
export { BUSINESS_TYPES, PACKS } from "@rbms/verticals";

/**
 * Demo storefronts, e.g. "https://{slug}.srikit.in". Unset = no demo links are shown (never defaulted to localhost).
 * Read at build/start time, so set it in .env.local / the deploy environment.
 */
export const DEMO_STORE_URL = (process.env.NEXT_PUBLIC_DEMO_STORE_URL || "").trim();
export const demoStoreUrl = (slug: string): string | null => (DEMO_STORE_URL.includes("{slug}") ? DEMO_STORE_URL.replace("{slug}", slug) : null);
