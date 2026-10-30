/*
 * Website-only shops (business packs with `site: true`, e.g. schools): the store is the shop's website, not a shop.
 * The header, phone tab bar, drawer and footer leave out the cart, wishlist, shopper account, order tracking and
 * product search, and the header shows the pack's main button instead (school: "Apply for admission").
 */
import { packFor } from "@rbms/verticals";

export const siteOnly = (businessType: string | null | undefined): boolean => !!packFor(businessType)?.site;

/** The header's main button on a website-only shop, or null for a shop. */
export function siteCta(businessType: string | null | undefined, locale: string | null | undefined): { label: string; href: string } | null {
  const pack = packFor(businessType);
  if (!pack?.site) return null;
  return { label: pack.copy[locale === "ta" ? "ta" : "en"].cta, href: pack.ctaHref ?? "/" };
}
