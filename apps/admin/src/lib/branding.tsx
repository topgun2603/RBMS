"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "./api";
import { useTenantSlug } from "./session";
import type { Branding } from "./types";

interface BrandingValue {
  branding: Branding | undefined;
  loading: boolean;
}

const BrandingContext = React.createContext<BrandingValue>({ branding: undefined, loading: true });

export const brandingQueryKey = (tenant: string | null) => ["branding", tenant] as const;

/**
 * Loads the current tenant's branding (GET /v1/branding with x-tenant) and injects its `css`
 * (overrides of --primary, --radius, fonts... on :root) as an unlayered <style>, which beats the
 * layered defaults from @srirealtime/ui. Also updates the favicon and document title.
 */
export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const tenant = useTenantSlug();
  const { data, isLoading } = useQuery({
    queryKey: brandingQueryKey(tenant),
    queryFn: () => api<Branding>("/branding"),
    staleTime: 5 * 60_000,
    retry: 1,
  });

  React.useEffect(() => {
    if (!data?.faviconUrl) return;
    let link = document.querySelector<HTMLLinkElement>("link[rel='icon'][data-sr-branding]");
    if (!link) {
      link = document.createElement("link");
      link.rel = "icon";
      link.dataset.srBranding = "";
      document.head.appendChild(link);
    }
    link.href = data.faviconUrl;
  }, [data?.faviconUrl]);

  React.useEffect(() => {
    if (data?.appName) document.title = `${data.appName} · Admin`;
  }, [data?.appName]);

  useWebFonts([data?.tokens.fontSans, data?.tokens.fontHeading]);

  const value = React.useMemo(() => ({ branding: data, loading: isLoading }), [data, isLoading]);

  return (
    <BrandingContext.Provider value={value}>
      {data?.css ? <style id="sr-branding" dangerouslySetInnerHTML={{ __html: data.css }} /> : null}
      {children}
    </BrandingContext.Provider>
  );
}

export const useBranding = () => React.useContext(BrandingContext);

/** Fonts the branding editor offers. All are on Google Fonts; the Tamil ones cover Tamil script. */
export const BRAND_FONTS = [
  "Inter",
  "Noto Sans Tamil",
  "Mukta Malar",
  "Hind Madurai",
  "Catamaran",
  "Baloo Thambi 2",
  "Poppins",
  "Roboto",
  "Open Sans",
  "Lato",
  "Montserrat",
  "Nunito Sans",
  "DM Sans",
  "Manrope",
  "Plus Jakarta Sans",
  "Work Sans",
] as const;

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

/**
 * Rewrites branding CSS so it applies inside `scope` only (for the live preview): `:root` and
 * `html` selectors become the scope class, `.dark` becomes `.dark <scope>`.
 */
export function scopeBrandingCss(css: string, scope: string): string {
  return css
    .replace(/:root\.dark|html\.dark|\.dark\s+:root/g, `.dark ${scope}`)
    .replace(/:root|\bhtml\b(?=[\s,{.:[])/g, scope)
    .replace(/(^|[\s,}])\.dark(?=\s*[,{])/g, `$1.dark ${scope}`);
}
