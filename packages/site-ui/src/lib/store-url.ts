"use client";

import { useTenantSlug } from "@rbms/web";

/** Default storefront URL template; `{slug}` is the shop's subdomain. Override with NEXT_PUBLIC_STORE_URL. */
export const DEFAULT_STORE_URL = "http://{slug}.localhost:3003";
/** Root domain of the hosted store addresses (`<slug>.srikit.in`). */
export const DEFAULT_STORE_DOMAIN = "srikit.in";

const template = () => (process.env.NEXT_PUBLIC_STORE_URL || DEFAULT_STORE_URL).replace(/\/+$/, "");

/** "http://anbu.localhost:3003" + path. */
export function storeUrlFor(slug: string, path = "/", tpl: string = template()): string {
  const base = (tpl.includes("{slug}") ? tpl.replace("{slug}", slug) : tpl).replace(/\/+$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  return p === "/" ? `${base}/` : `${base}${p}`;
}

/** Hosted address shown on the Domain page, e.g. "anbu.srikit.in". */
export const storeDomainFor = (slug: string) => `${slug}.${process.env.NEXT_PUBLIC_STORE_DOMAIN || DEFAULT_STORE_DOMAIN}`;

/** Storefront URL builder for the current shop (null before the shop is known). */
export function useStoreUrl(): ((path?: string) => string) | null {
  const slug = useTenantSlug();
  if (!slug) return null;
  return (path = "/") => storeUrlFor(slug, path);
}
