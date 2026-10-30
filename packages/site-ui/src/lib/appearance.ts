"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_STORE_THEME, type StoreTheme, type ThemePreset } from "@rbms/branding/theme";
import { api } from "@rbms/web";

/** What the appearance editor edits: the brand tokens a store uses. */
export interface AppearanceDraft {
  colors: { primary: string; accent: string | null; background: string | null; foreground: string | null };
  fontSans: string;
  fontHeading: string;
  radius: number;
  mode: "light" | "dark" | "system";
  theme: StoreTheme;
  preset: string | null;
}

interface BrandingResponse {
  appName: string;
  logoUrl: string | null;
  tokens: {
    colors: { primary: string; accent?: string; background?: string; foreground?: string; secondary?: string };
    fontSans: string;
    fontHeading?: string;
    radius: number;
    mode: "light" | "dark" | "system";
    theme?: Partial<StoreTheme>;
    preset?: string;
  };
}

export const ak = { branding: ["site", "appearance", "branding"] as const, store: ["site", "settings", "store"] as const };

export function draftFrom(b: BrandingResponse): AppearanceDraft {
  const tk = b.tokens;
  return {
    colors: { primary: tk.colors.primary, accent: tk.colors.accent ?? null, background: tk.colors.background ?? null, foreground: tk.colors.foreground ?? null },
    fontSans: tk.fontSans,
    fontHeading: tk.fontHeading ?? tk.fontSans,
    radius: tk.radius,
    mode: tk.mode,
    theme: { ...DEFAULT_STORE_THEME, ...(tk.theme ?? {}) },
    preset: tk.preset ?? null,
  };
}

export function draftFromPreset(p: ThemePreset): AppearanceDraft {
  return {
    colors: { primary: p.colors.primary, accent: p.colors.accent ?? null, background: p.colors.background ?? null, foreground: p.colors.foreground ?? null },
    fontSans: p.fontSans,
    fontHeading: p.fontHeading,
    radius: p.radius,
    mode: p.mode,
    theme: { ...p.theme },
    preset: p.id,
  };
}

/**
 * "Reset to preset": the preset's colours, fonts and every option again. The page layout and phone navigation come
 * from the preset when it sets them; otherwise the shop's own stay (they are its structure, like when picking a preset).
 */
export function resetToPreset(draft: AppearanceDraft, p: ThemePreset): AppearanceDraft {
  const next = draftFromPreset(p);
  return { ...next, theme: { ...next.theme, pageLayout: next.theme.pageLayout ?? draft.theme.pageLayout, mobileNav: next.theme.mobileNav ?? draft.theme.mobileNav } };
}

/** True when the draft no longer matches its preset (colours, fonts or options were changed after picking it). */
export function differsFromPreset(draft: AppearanceDraft, p: ThemePreset): boolean {
  const { theme, ...rest } = resetToPreset(draft, p);
  const { theme: current, ...currentRest } = draft;
  const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
  return (
    !same(rest.colors, currentRest.colors) ||
    rest.fontSans !== currentRest.fontSans ||
    rest.fontHeading !== currentRest.fontHeading ||
    rest.radius !== currentRest.radius ||
    rest.mode !== currentRest.mode ||
    Object.entries(theme).some(([k, v]) => v !== undefined && (current as Record<string, unknown>)[k] !== v)
  );
}

export function useBrandingTokens() {
  return useQuery({ queryKey: ak.branding, queryFn: () => api.get<BrandingResponse>("/branding") });
}

export function useSaveAppearance() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (d: AppearanceDraft) =>
      api.put<BrandingResponse>("/branding", {
        tokens: {
          colors: d.colors,
          fontSans: d.fontSans,
          fontHeading: d.fontHeading === d.fontSans ? null : d.fontHeading,
          radius: d.radius,
          mode: d.mode,
          theme: d.theme,
          preset: d.preset,
        },
      }),
    onSuccess: (b) => {
      qc.setQueryData(ak.branding, b);
      // The admin shell's own branding (["branding", slug]) follows the new colours too.
      void qc.invalidateQueries({ queryKey: ["branding"] });
    },
  });
}

/** Saves the shop's trade: the pack id, and the owner's own words for it ("" when they picked a listed trade). */
export function useSaveBusinessType() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: { businessType: string; businessLabel: string }) => api.put("/settings/store/tenant", v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ak.store }),
  });
}

/** WCAG relative luminance → black or white text for a hex background (preview only; the server computes its own). */
export function readableOn(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const l = 0.2126 * ch[0]! + 0.7152 * ch[1]! + 0.0722 * ch[2]!;
  return l > 0.4 ? "#111111" : "#ffffff";
}
