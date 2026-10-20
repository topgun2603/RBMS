"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@srirealtime/web";
import { ak } from "./appearance";

/** What Settings → Branding edits: the shop's identity, used by its store, bills, emails and this app. */
export interface BrandDraft {
  logoUrl: string;
  logoDarkUrl: string;
  faviconUrl: string;
  colors: { primary: string; accent: string | null; background: string | null; foreground: string | null };
  fontSans: string;
  fontHeading: string;
  mode: "light" | "dark" | "system";
}

export interface BrandResponse {
  appName: string;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  faviconUrl: string | null;
  tokens: {
    colors: { primary: string; accent?: string; background?: string; foreground?: string };
    fontSans: string;
    fontHeading?: string;
    mode: "light" | "dark" | "system";
  };
}

export function brandDraftFrom(b: BrandResponse): BrandDraft {
  const tk = b.tokens;
  return {
    logoUrl: b.logoUrl ?? "",
    logoDarkUrl: b.logoDarkUrl ?? "",
    faviconUrl: b.faviconUrl ?? "",
    colors: { primary: tk.colors.primary, accent: tk.colors.accent ?? null, background: tk.colors.background ?? null, foreground: tk.colors.foreground ?? null },
    fontSans: tk.fontSans,
    fontHeading: tk.fontHeading ?? tk.fontSans,
    mode: tk.mode,
  };
}

/** The same branding record Appearance reads (one query, so both pages stay in step). */
export function useBrand() {
  return useQuery({ queryKey: ak.branding, queryFn: () => api.get<BrandResponse>("/branding") });
}

export function useSaveBrand() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (d: BrandDraft) =>
      api.put<BrandResponse>("/branding", {
        logoUrl: d.logoUrl || null,
        logoDarkUrl: d.logoDarkUrl || null,
        faviconUrl: d.faviconUrl || null,
        tokens: {
          colors: d.colors,
          fontSans: d.fontSans,
          fontHeading: d.fontHeading === d.fontSans ? null : d.fontHeading,
          mode: d.mode,
        },
      }),
    onSuccess: (b) => {
      qc.setQueryData(ak.branding, b);
      // The app shell's own branding (["branding", slug]) follows the new logo and colours too.
      void qc.invalidateQueries({ queryKey: ["branding"] });
    },
  });
}
