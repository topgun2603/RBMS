import { describe, expect, it } from "vitest";
import { DEFAULT_STORE_THEME, THEME_OPTIONS, THEME_PRESETS, type ThemeOptionKey } from "@srirealtime/branding/theme";
import { differsFromPreset, draftFrom, draftFromPreset, resetToPreset } from "./appearance";
import { siteMessages } from "./messages";

const tokens = { colors: { primary: "#112233" }, fontSans: "Inter", radius: 0.5, mode: "light" as const };

describe("appearance editor", () => {
  it("labels every theme option and value in English and Tamil", () => {
    const missing: string[] = [];
    for (const k of Object.keys(THEME_OPTIONS) as ThemeOptionKey[]) {
      // Headings has its own label key (site.appearance.headings).
      const keys = [...(k === "headings" ? [] : [`site.appearance.opt.${k}.label`]), ...THEME_OPTIONS[k].map((v) => `site.appearance.opt.${k}.${v}`)];
      for (const key of keys) for (const l of ["en", "ta"] as const) if (!(siteMessages[l] as Record<string, string>)[key]) missing.push(`${l}:${key}`);
    }
    expect(missing).toEqual([]);
  });

  it("fills the newer options with today's look for a theme saved before them", () => {
    const d = draftFrom({ appName: "Anbu", logoUrl: null, tokens: { ...tokens, theme: { header: "bold", card: "overlay" } } });
    expect(d.theme).toEqual({ ...DEFAULT_STORE_THEME, header: "bold", card: "overlay" });
    expect(d.theme).toMatchObject({ headerStyle: "glass", footer: "columns", productLayout: "thumbs-side", stickyBuy: "on" });
  });

  it("a preset brings its header, card and product page choices", () => {
    const luxe = THEME_PRESETS.find((p) => p.id === "luxe")!;
    expect(draftFromPreset(luxe).theme).toMatchObject({ card: "editorial", footer: "centered", productLayout: "grid", sticky: "scroll-up" });
  });

  it("resets an edited look to its preset (keeping the shop's page layout unless the preset has one)", () => {
    const luxe = THEME_PRESETS.find((p) => p.id === "luxe")!;
    const picked = { ...draftFromPreset(luxe), theme: { ...draftFromPreset(luxe).theme, pageLayout: "rail" as const } };
    expect(differsFromPreset(picked, luxe)).toBe(false);
    const edited = { ...picked, colors: { ...picked.colors, primary: "#123456" }, theme: { ...picked.theme, card: "minimal" as const } };
    expect(differsFromPreset(edited, luxe)).toBe(true);
    const reset = resetToPreset(edited, luxe);
    expect(reset.colors.primary).toBe(luxe.colors.primary);
    expect(reset.theme.card).toBe(luxe.theme.card);
    expect(reset.theme.pageLayout).toBe(luxe.theme.pageLayout ?? "rail");
    expect(differsFromPreset(reset, luxe)).toBe(false);
  });
});
