"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { absoluteUrl, api } from "./api";
import { adminBrandingCss } from "./branding-css";
import { BRANDING_BOOT_ID, BRANDING_CACHE_PREFIX, MAX_CACHED_BRANDING_CSS } from "./branding-boot";
import type { Branding, Tenant } from "./types";

interface ShopValue {
  tenant: Tenant;
  branding: Branding | undefined;
  /** Branded shop name: branding appName, else the tenant name. */
  shopName: string;
  logoUrl: string | null;
}

const ShopContext = React.createContext<ShopValue | null>(null);

export const brandingQueryKey = (slug: string) => ["branding", slug] as const;

/**
 * Loads the shop's branding (GET /v1/branding with x-tenant) and injects its `css` (overrides of
 * --primary, --radius, fonts... on :root) as an unlayered <style>, which beats the layered defaults
 * from @rbms/ui. Also sets the favicon and document title. Refetches on focus so a change
 * made in the admin shows up here on the next visit/refresh.
 */
export function ShopProvider({ tenant, appName, children }: { tenant: Tenant; appName?: string; children: React.ReactNode }) {
  const { data } = useQuery({
    queryKey: brandingQueryKey(tenant.slug),
    queryFn: () => api<Branding>("/branding", { anonymous: true }),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    retry: 1,
  });

  const shopName = data?.appName || tenant.name;
  const logoUrl = absoluteUrl(data?.logoUrl);

  useDocumentBranding({ title: shopName, icon: absoluteUrl(data?.faviconUrl) ?? logoUrl, suffix: appName ?? "" });
  useWebFonts([data?.tokens?.fontSans, data?.tokens?.fontHeading]);

  const value = React.useMemo<ShopValue>(() => ({ tenant, branding: data, shopName, logoUrl }), [tenant, data, shopName, logoUrl]);

  // Remember this shop's colours for the next visit's first paint (BRANDING_BOOT_SCRIPT), then drop the boot copy:
  // the live <style> below is the source of truth from here on.
  const loaded = data !== undefined;
  const css = data?.css ?? "";
  React.useEffect(() => {
    if (!loaded) return;
    saveBrandingCache(tenant.slug, css ? brandingStyleText(css) : null);
    document.getElementById(BRANDING_BOOT_ID)?.remove();
  }, [loaded, css, tenant.slug]);

  return (
    <ShopContext.Provider value={value}>
      {data?.css ? <BrandingStyle css={data.css} /> : null}
      {children}
    </ShopContext.Provider>
  );
}

/** The query ShopBranding runs: GET /v1/branding without the staff sign-in (a device token, when set, still goes along). */
export const shopBrandingQuery = (slug: string | null | undefined, via = "shop") => ({
  queryKey: [...brandingQueryKey(slug || "device"), "public", via] as const,
  queryFn: () => api<Branding>("/branding", { anonymous: true }),
  staleTime: 60_000,
});

/**
 * A shop's branding where ShopProvider isn't mounted: public routes such as POS terminal mode, where a paired device
 * has no staff session. Loads GET /v1/branding (x-tenant when the shop is known; a paired device's `x-device-token`
 * makes the API resolve its shop) and applies it exactly like ShopProvider: the light/dark-aware <style>
 * (adminBrandingCss), the first-paint cache for BRANDING_BOOT_SCRIPT (then the boot copy is dropped), fonts and the
 * title / favicon. `slug` (when known) keys the cache; `enabled: false` waits (e.g. until the device token is read).
 */
export function ShopBranding({
  slug,
  enabled = true,
  appName,
  via = "shop",
}: {
  slug: string | null | undefined;
  enabled?: boolean;
  appName?: string;
  /** How the shop is identified ("device" while a device token is sent): part of the query key, so a change refetches. */
  via?: string;
}) {
  const { data } = useQuery({ ...shopBrandingQuery(slug, via), enabled, refetchOnWindowFocus: true, retry: 1 });
  useDocumentBranding({ title: data?.appName, icon: absoluteUrl(data?.faviconUrl) ?? absoluteUrl(data?.logoUrl), suffix: appName ?? "" });
  useWebFonts([data?.tokens?.fontSans, data?.tokens?.fontHeading]);
  const loaded = data !== undefined;
  const css = data?.css ?? "";
  React.useEffect(() => {
    if (!loaded) return;
    if (slug) saveBrandingCache(slug, css ? brandingStyleText(css) : null);
    document.getElementById(BRANDING_BOOT_ID)?.remove();
  }, [loaded, css, slug]);
  return css ? <BrandingStyle css={css} /> : null;
}

export function useShop(): ShopValue {
  const ctx = React.useContext(ShopContext);
  if (!ctx) throw new Error("useShop must be used inside <ShopProvider>");
  return ctx;
}

/** Same as useShop, but null outside a shop (public invoice page, "open your shop"). */
export const useOptionalShop = () => React.useContext(ShopContext);

/**
 * Unlayered tenant CSS, made light/dark aware for the app's theme toggle (see adminBrandingCss: the storefront page
 * palette applies only in the mode it was designed for, and the primary stays readable in both).
 * `</style` is neutralised so the payload can't break out of the tag.
 */
export function BrandingStyle({ css }: { css: string }) {
  const html = React.useMemo(() => brandingStyleText(css), [css]);
  return <style id="sr-branding" dangerouslySetInnerHTML={{ __html: html }} />;
}

/** The <style> text for a shop's branding CSS (adminBrandingCss, with `</style` neutralised). */
export function brandingStyleText(css: string): string {
  return adminBrandingCss(css).replace(/<\/style/gi, "<\\/style");
}

// ---------------------------------------------------------------- first-paint cache

/** Stores (or with null, forgets) the transformed branding CSS of a shop. Storage errors are ignored. */
export function saveBrandingCache(slug: string, styleText: string | null) {
  try {
    const key = BRANDING_CACHE_PREFIX + slug;
    if (styleText && styleText.length <= MAX_CACHED_BRANDING_CSS) window.localStorage.setItem(key, styleText);
    else window.localStorage.removeItem(key);
  } catch {
    // storage blocked: the next visit just paints the default colours first
  }
}

/** Sets document.title ("Raja Textiles · Billing") and the favicon. */
export function useDocumentBranding({ title, icon, suffix = "" }: { title?: string | null; icon?: string | null; suffix?: string }) {
  React.useEffect(() => {
    if (title) document.title = suffix ? `${title} · ${suffix}` : title;
  }, [title, suffix]);

  React.useEffect(() => {
    if (!icon) return;
    let link = document.querySelector<HTMLLinkElement>("link[rel='icon'][data-sr-branding]");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      link.dataset.srBranding = "";
      document.head.appendChild(link);
    }
    link.href = icon;
  }, [icon]);
}

const SYSTEM_FONTS = new Set(["system-ui", "ui-sans-serif", "sans-serif", "Arial", "Helvetica"]);

/** Adds Google Fonts stylesheets for the given family names (once per family). */
export function useWebFonts(families: Array<string | null | undefined>) {
  const key = families.filter(Boolean).join("|");
  React.useEffect(() => {
    for (const family of key.split("|")) {
      if (!family || SYSTEM_FONTS.has(family) || !/^[A-Za-z0-9 -]+$/.test(family)) continue;
      const id = `sr-font-${family.replace(/\s+/g, "-").toLowerCase()}`;
      if (document.getElementById(id)) continue;
      const link = document.createElement("link");
      link.id = id;
      link.rel = "stylesheet";
      link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, "+")}:wght@400;500;600;700&display=swap`;
      document.head.appendChild(link);
    }
  }, [key]);
}

/** Font families named in a branding CSS string (`--font-sans: "Mukta Malar", ...`). */
export function fontsInCss(css: string | null | undefined): string[] {
  if (!css) return [];
  const out: string[] = [];
  for (const m of css.matchAll(/--font-(?:sans|heading)\s*:\s*["']?([^"',;]+)/g)) if (m[1]) out.push(m[1].trim());
  return out;
}
