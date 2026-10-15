"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { absoluteUrl, api } from "./api";
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
 * from @srirealtime/ui. Also sets the favicon and document title. Refetches on focus so a change
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

  return (
    <ShopContext.Provider value={value}>
      {data?.css ? <BrandingStyle css={data.css} /> : null}
      {children}
    </ShopContext.Provider>
  );
}

export function useShop(): ShopValue {
  const ctx = React.useContext(ShopContext);
  if (!ctx) throw new Error("useShop must be used inside <ShopProvider>");
  return ctx;
}

/** Same as useShop, but null outside a shop (public invoice page, "open your shop"). */
export const useOptionalShop = () => React.useContext(ShopContext);

/** Unlayered tenant CSS. `</style` is neutralised so the payload can't break out of the tag. */
export function BrandingStyle({ css }: { css: string }) {
  return <style id="sr-branding" dangerouslySetInnerHTML={{ __html: css.replace(/<\/style/gi, "<\\/style") }} />;
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
