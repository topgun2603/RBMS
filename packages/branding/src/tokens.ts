import { z } from "zod";
import { contrastRatio, hexToOklchString, mix, NEAR_BLACK, readableForeground, relativeLuminance, WHITE } from "./color";
import { DEFAULT_STORE_THEME, storeThemePatchSchema, storeThemeSchema, themeCssVariables } from "./theme";

export const hexColor = z
  .string()
  .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #1a2b3c")
  .transform((v) => v.toLowerCase());

/** Font family names are emitted into CSS, so only plain names are allowed. */
export const fontName = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z0-9 -]+$/, "Font names may contain letters, digits, spaces and hyphens");

export const BRAND_MODES = ["light", "dark", "system"] as const;
export type BrandMode = (typeof BRAND_MODES)[number];

export const brandTokensSchema = z.object({
  colors: z.object({
    primary: hexColor,
    secondary: hexColor.optional(),
    accent: hexColor.optional(),
    background: hexColor.optional(),
    foreground: hexColor.optional(),
  }),
  /** Corner radius in rem. */
  radius: z.number().min(0).max(1.5).default(0.625),
  fontSans: fontName.default("Inter"),
  fontHeading: fontName.optional(),
  mode: z.enum(BRAND_MODES).default("light"),
  /** Storefront structure (header, cards, hero, image shape…); see theme.ts. */
  theme: storeThemeSchema.default(DEFAULT_STORE_THEME),
  /** The preset the shop started from (informational; every value is stored in the other fields). */
  preset: z.string().trim().max(40).optional(),
});

export type BrandTokens = z.output<typeof brandTokensSchema>;
export type BrandTokensInput = z.input<typeof brandTokensSchema>;

/** A partial update. `null` removes an optional value (including one coming from the defaults). */
export const brandTokensPatchSchema = z.object({
  colors: z
    .object({
      primary: hexColor.optional(),
      secondary: hexColor.nullable().optional(),
      accent: hexColor.nullable().optional(),
      background: hexColor.nullable().optional(),
      foreground: hexColor.nullable().optional(),
    })
    .optional(),
  radius: z.number().min(0).max(1.5).optional(),
  fontSans: fontName.optional(),
  fontHeading: fontName.nullable().optional(),
  mode: z.enum(BRAND_MODES).optional(),
  theme: storeThemePatchSchema.optional(),
  preset: z.string().trim().max(40).nullable().optional(),
});

export type BrandTokensPatch = z.output<typeof brandTokensPatchSchema>;

export const DEFAULT_BRAND_TOKENS: BrandTokens = {
  colors: { primary: "#2563eb" },
  radius: 0.625,
  fontSans: "Inter",
  mode: "light",
  theme: { ...DEFAULT_STORE_THEME },
};

type ColorKey = keyof BrandTokens["colors"];
const OPTIONAL_COLORS = ["secondary", "accent", "background", "foreground"] as const satisfies readonly ColorKey[];

/** Combines two patches; later values win, nulls are kept so they still remove defaults. */
export function combinePatches(a: BrandTokensPatch | null | undefined, b: BrandTokensPatch | null | undefined): BrandTokensPatch {
  const out: BrandTokensPatch = { ...(a ?? {}), ...(b ?? {}) };
  if (a?.colors || b?.colors) out.colors = { ...(a?.colors ?? {}), ...(b?.colors ?? {}) };
  if (a?.theme || b?.theme) out.theme = { ...(a?.theme ?? {}), ...(b?.theme ?? {}) };
  for (const k of Object.keys(out) as (keyof BrandTokensPatch)[]) if (out[k] === undefined) delete out[k];
  return out;
}

/** Applies patches over full tokens. `null` deletes optional fields. */
export function mergeTokens(base: BrandTokens, ...patches: (BrandTokensPatch | null | undefined)[]): BrandTokens {
  const out: BrandTokens = { ...base, colors: { ...base.colors }, theme: { ...(base.theme ?? DEFAULT_STORE_THEME) } };
  for (const p of patches) {
    if (!p) continue;
    if (p.colors?.primary) out.colors.primary = p.colors.primary;
    for (const k of OPTIONAL_COLORS) {
      const v = p.colors?.[k];
      if (v === null) delete out.colors[k];
      else if (v !== undefined) out.colors[k] = v;
    }
    if (p.radius !== undefined) out.radius = p.radius;
    if (p.fontSans !== undefined) out.fontSans = p.fontSans;
    if (p.fontHeading === null) delete out.fontHeading;
    else if (p.fontHeading !== undefined) out.fontHeading = p.fontHeading;
    if (p.mode !== undefined) out.mode = p.mode;
    if (p.theme) for (const [k, v] of Object.entries(p.theme)) if (v !== undefined) (out.theme as Record<string, string>)[k] = v;
    if (p.preset === null) delete out.preset;
    else if (p.preset !== undefined) out.preset = p.preset;
  }
  return out;
}

export const fontStack = (name: string) => `"${name}", ui-sans-serif, system-ui, sans-serif`;

interface ColorPair {
  name: string;
  background: string;
  foreground: string;
}

/** Surfaces and the foreground used on them, with foregrounds auto-computed where not given. */
function colorPairs(tokens: BrandTokens): ColorPair[] {
  const { colors } = tokens;
  const pairs: ColorPair[] = [{ name: "primary", background: colors.primary, foreground: readableForeground(colors.primary) }];
  if (colors.secondary) pairs.push({ name: "secondary", background: colors.secondary, foreground: readableForeground(colors.secondary) });
  if (colors.accent) pairs.push({ name: "accent", background: colors.accent, foreground: readableForeground(colors.accent) });
  if (colors.background) {
    pairs.push({ name: "background", background: colors.background, foreground: colors.foreground ?? readableForeground(colors.background) });
  }
  return pairs;
}

/**
 * Cards, popovers, muted panels and borders that go with a custom page background, so a dark background doesn't keep
 * the base theme's white cards (with the light text meant for the page). Dark: surfaces a little lighter than the page;
 * light: cards near white over the tinted page.
 */
export function surfaceVariables(background: string, foreground: string): Record<string, string> {
  const dark = relativeLuminance(background) < 0.2;
  const card = dark ? mix(background, foreground, 0.06) : mix(background, WHITE, 0.7);
  const muted = mix(background, foreground, dark ? 0.1 : 0.05);
  const border = mix(background, foreground, dark ? 0.16 : 0.12);
  const out = (hex: string) => hexToOklchString(hex);
  return {
    "--card": out(card),
    "--card-foreground": out(foreground),
    "--popover": out(card),
    "--popover-foreground": out(foreground),
    "--muted": out(muted),
    "--muted-foreground": out(mix(foreground, background, 0.38)),
    "--border": out(border),
    "--input": out(border),
    // Status colours: a custom dark background doesn't switch on the UI's .dark palette, so use its brighter inks.
    ...(dark
      ? {
          "--destructive": "oklch(0.68 0.19 22)",
          "--success": "oklch(0.72 0.15 155)",
          "--warning": "oklch(0.8 0.15 80)",
          "--info": "oklch(0.72 0.13 250)",
          "--success-ink": "oklch(0.83 0.13 155)",
          "--warning-ink": "oklch(0.86 0.13 85)",
          "--danger-ink": "oklch(0.8 0.13 22)",
          "--info-ink": "oklch(0.82 0.1 250)",
        }
      : {}),
  };
}

/**
 * shadcn CSS variables for the tokens, values in oklch. Secondary/accent/background/foreground are only
 * emitted when set, so the UI's base theme (including its dark variant) supplies the rest.
 */
export function toCssVariables(tokens: BrandTokens): Record<string, string> {
  const { colors } = tokens;
  const vars: Record<string, string> = {};
  if (colors.background) vars["--background"] = hexToOklchString(colors.background);
  if (colors.background || colors.foreground) {
    vars["--foreground"] = hexToOklchString(colors.foreground ?? readableForeground(colors.background!));
  }
  if (colors.background) Object.assign(vars, surfaceVariables(colors.background, colors.foreground ?? readableForeground(colors.background)));
  vars["--primary"] = hexToOklchString(colors.primary);
  vars["--primary-foreground"] = hexToOklchString(readableForeground(colors.primary));
  if (colors.secondary) {
    vars["--secondary"] = hexToOklchString(colors.secondary);
    vars["--secondary-foreground"] = hexToOklchString(readableForeground(colors.secondary));
  }
  if (colors.accent) {
    vars["--accent"] = hexToOklchString(colors.accent);
    vars["--accent-foreground"] = hexToOklchString(readableForeground(colors.accent));
  }
  vars["--ring"] = vars["--primary"];
  vars["--radius"] = `${tokens.radius}rem`;
  vars["--font-sans"] = fontStack(tokens.fontSans);
  vars["--font-heading"] = fontStack(tokens.fontHeading ?? tokens.fontSans);
  Object.assign(vars, themeCssVariables(tokens.theme ?? DEFAULT_STORE_THEME));
  return vars;
}

/** A CSS rule block with the variables plus `color-scheme` for the chosen mode. */
export function toCssText(tokens: BrandTokens, selector = ":root"): string {
  const scheme = tokens.mode === "system" ? "light dark" : tokens.mode;
  const lines = [`  color-scheme: ${scheme};`];
  for (const [k, v] of Object.entries(toCssVariables(tokens))) lines.push(`  ${k}: ${v};`);
  return `${selector} {\n${lines.join("\n")}\n}\n`;
}

export const MIN_CONTRAST = 4.5;

/** Human-readable warnings for every colour pair below WCAG AA (4.5:1). */
export function contrastWarnings(tokens: BrandTokens): string[] {
  const out: string[] = [];
  const check = (what: string, bg: string, fg: string) => {
    const ratio = contrastRatio(bg, fg);
    if (ratio < MIN_CONTRAST) {
      out.push(`${what}: contrast ${ratio.toFixed(2)}:1 (${fg} on ${bg}) is below ${MIN_CONTRAST}:1`);
    }
  };
  for (const p of colorPairs(tokens)) check(`Text on ${p.name}`, p.background, p.foreground);

  // Primary is also used for links and outlines on the page background.
  const pageBg = tokens.colors.background ?? (tokens.mode === "light" ? WHITE : tokens.mode === "dark" ? NEAR_BLACK : null);
  if (pageBg) check("Primary on background", pageBg, tokens.colors.primary);
  return out;
}
