"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { adminBrandingCss } from "@rbms/web";
import { api } from "./api";
import type { Branding } from "./types";

interface BrandingValue {
  branding: Branding | undefined;
  loading: boolean;
}

const BrandingContext = React.createContext<BrandingValue>({ branding: undefined, loading: true });

export const brandingQueryKey = ["branding", "platform"] as const;

/**
 * Loads the platform's branding (GET /v1/branding without a tenant) and injects its `css` (overrides of --primary,
 * --radius, fonts... on :root) as an unlayered <style>, which beats the layered defaults from @rbms/ui. Also
 * updates the favicon and document title. The admin is the platform's console, so it keeps the platform look whichever
 * shop is selected; a shop's own branding is shown only in the Branding page's preview.
 */
export function BrandingProvider({ children }: { children: React.ReactNode }) {
  const { data, isLoading } = useQuery({
    queryKey: brandingQueryKey,
    queryFn: () => api.get<Branding>("/branding", undefined, { tenant: null }),
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
      {/* Light/dark aware: see adminBrandingCss (the primary stays readable in dark mode). */}
      {data?.css ? <style id="sr-branding" dangerouslySetInnerHTML={{ __html: adminBrandingCss(data.css) }} /> : null}
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
