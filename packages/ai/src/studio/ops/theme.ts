import { brandTokensSchema, contrastWarnings, mergeTokens, type BrandTokens, type BrandTokensPatch } from "@srirealtime/branding/tokens";
import { LAYOUT_OPTIONS, STORE_FONTS, THEME_OPTIONS, THEME_PRESETS, themePreset, storeThemePatchSchema } from "@srirealtime/branding/theme";
import { z } from "zod";
import { AREA, fail, type BrandingArea } from "../areas";
import type { Bi, StudioEnv, StudioState } from "../types";
import { defineOp, hex } from "./util";

const area = AREA.branding;
const FONT = z.enum(STORE_FONTS as unknown as [string, ...string[]]);

export const effectiveTokens = (st: StudioState, env: StudioEnv): BrandTokens => mergeTokens(env.brandDefaults as BrandTokens, st.get<BrandingArea>(area).tokens);

function save(st: StudioState, env: StudioEnv, next: BrandTokensPatch): Bi[] {
  const cur = st.get<BrandingArea>(area);
  const before = effectiveTokens(st, env);
  const merged = mergeTokens(env.brandDefaults as BrandTokens, next);
  const ok = brandTokensSchema.safeParse(merged);
  if (!ok.success) fail("invalid_theme", "Those look settings do not fit together.", "அந்தத் தோற்ற அமைப்புகள் பொருந்தவில்லை.");
  st.set(area, { ...cur, tokens: next } satisfies BrandingArea);
  const had = new Set(contrastWarnings(before));
  const fresh = contrastWarnings(merged).filter((w) => !had.has(w));
  return fresh.length ? [{ en: "Some text may be hard to read on these colours (contrast is low). Check the preview.", ta: "இந்த நிறங்களில் சில எழுத்துகள் படிக்கக் கடினமாக இருக்கலாம் (மாறுபாடு குறைவு). முன்னோட்டத்தைப் பாருங்கள்." }] : [];
}

const presetIds = THEME_PRESETS.map((p) => p.id);

/** The stored tokens a preset gives (same as picking it in Settings > Appearance; the shop keeps its page layout and phone navigation). */
export function presetTokens(presetId: string, prevTheme: Record<string, unknown>): BrandTokensPatch {
  const p = themePreset(presetId);
  if (!p) fail("unknown_preset", `There is no look called "${presetId}".`, `"${presetId}" என்ற தோற்றம் இல்லை.`);
  return {
    colors: { primary: p.colors.primary, accent: p.colors.accent ?? null, background: p.colors.background ?? null, foreground: p.colors.foreground ?? null, secondary: null },
    fontSans: p.fontSans,
    fontHeading: p.fontHeading === p.fontSans ? null : p.fontHeading,
    radius: p.radius,
    mode: p.mode,
    theme: { ...p.theme, pageLayout: p.theme.pageLayout ?? (prevTheme.pageLayout as never), mobileNav: p.theme.mobileNav ?? (prevTheme.mobileNav as never) },
    preset: p.id,
  };
}

export const applyPreset = defineOp({
  kind: "theme.apply_preset",
  group: "theme",
  label: { en: "Use a ready-made look", ta: "தயார் தோற்றத்தைப் பயன்படுத்து" },
  changes: { en: "Colours, fonts, corners and the store layout options", ta: "நிறங்கள், எழுத்துருக்கள், மூலைகள், கடை அமைப்பு விருப்பங்கள்" },
  risk: "low",
  permission: null,
  fullAccess: true,
  features: ["storefront"],
  visual: true,
  schema: z.object({ presetId: z.enum(presetIds as [string, ...string[]]) }),
  help: `presetId: one of the preset ids from list_presets (${presetIds.length} ready-made looks)`,
  areas: () => [area],
  target: () => "theme:all",
  describe: (p) => ({ en: `Use the "${themePreset(p.presetId)?.name}" look`, ta: `"${themePreset(p.presetId)?.name}" தோற்றத்தைப் பயன்படுத்து` }),
  run(p, st, env) {
    const prev = effectiveTokens(st, env).theme as Record<string, unknown>;
    return save(st, env, presetTokens(p.presetId, prev));
  },
});

const nullableHex = hex.nullable();
export const setColors = defineOp({
  kind: "theme.set_colors",
  group: "theme",
  label: { en: "Change store colours", ta: "கடையின் நிறங்களை மாற்று" },
  changes: { en: "Main, accent, background and text colours", ta: "முதன்மை, அலங்கார, பின்னணி, எழுத்து நிறங்கள்" },
  risk: "low",
  permission: null,
  fullAccess: true,
  features: ["storefront"],
  visual: true,
  schema: z
    .object({ primary: hex.optional(), secondary: nullableHex.optional(), accent: nullableHex.optional(), background: nullableHex.optional(), foreground: nullableHex.optional() })
    .refine((v) => Object.values(v).some((x) => x !== undefined), "Give at least one colour"),
  help: 'primary?, secondary?, accent?, background?, foreground?: hex "#rrggbb" (null removes an optional colour). Dark green = e.g. "#14532d"',
  areas: () => [area],
  target: () => "theme:colors",
  describe: (p) => {
    const parts = Object.entries(p).filter(([, v]) => v !== undefined).map(([k, v]) => `${k} ${v ?? "none"}`);
    return { en: `Set colours: ${parts.join(", ")}`, ta: `நிறங்களை அமை: ${parts.join(", ")}` };
  },
  run(p, st, env) {
    const cur = st.get<BrandingArea>(area).tokens;
    const colors = { ...(cur.colors ?? {}) } as Record<string, string | null | undefined>;
    for (const [k, v] of Object.entries(p)) if (v !== undefined) colors[k] = v === null ? null : v.toLowerCase();
    return save(st, env, { ...cur, colors: colors as never });
  },
});

export const setTypography = defineOp({
  kind: "theme.set_typography",
  group: "theme",
  label: { en: "Change fonts", ta: "எழுத்துருக்களை மாற்று" },
  changes: { en: "Body and heading fonts", ta: "உரை மற்றும் தலைப்பு எழுத்துருக்கள்" },
  risk: "low",
  permission: null,
  fullAccess: true,
  features: ["storefront"],
  visual: true,
  schema: z.object({ fontSans: FONT.optional(), fontHeading: FONT.nullable().optional() }).refine((v) => v.fontSans !== undefined || v.fontHeading !== undefined, "Give a font"),
  help: `fontSans?, fontHeading? (null = same as body): one of ${STORE_FONTS.join(", ")}`,
  areas: () => [area],
  target: () => "theme:fonts",
  describe: (p) => ({ en: `Fonts: ${[p.fontSans && `body ${p.fontSans}`, p.fontHeading !== undefined && `headings ${p.fontHeading ?? "same as body"}`].filter(Boolean).join(", ")}`, ta: `எழுத்துருக்கள்: ${[p.fontSans && `உரை ${p.fontSans}`, p.fontHeading !== undefined && `தலைப்பு ${p.fontHeading ?? "உரையைப் போல"}`].filter(Boolean).join(", ")}` }),
  run(p, st, env) {
    const cur = st.get<BrandingArea>(area).tokens;
    const next: BrandTokensPatch = { ...cur };
    if (p.fontSans !== undefined) next.fontSans = p.fontSans;
    if (p.fontHeading !== undefined) next.fontHeading = p.fontHeading;
    return save(st, env, next);
  },
});

export const setShape = defineOp({
  kind: "theme.set_shape",
  group: "theme",
  label: { en: "Corners and light/dark mode", ta: "மூலைகள், ஒளி/இருள் பயன்முறை" },
  changes: { en: "How round the corners are, and light, dark or automatic mode", ta: "மூலைகளின் வட்டம், ஒளி/இருள்/தானியங்கி பயன்முறை" },
  risk: "low",
  permission: null,
  fullAccess: true,
  features: ["storefront"],
  visual: true,
  schema: z.object({ radius: z.number().min(0).max(1.5).optional(), mode: z.enum(["light", "dark", "system"]).optional() }).refine((v) => v.radius !== undefined || v.mode !== undefined, "Give a value"),
  help: "radius? 0 (square) to 1.5 (very round) in rem; mode? light | dark | system",
  areas: () => [area],
  target: () => "theme:shape",
  describe: (p) => ({ en: `Corners and mode: ${[p.radius !== undefined && `radius ${p.radius}`, p.mode && `${p.mode} mode`].filter(Boolean).join(", ")}`, ta: `மூலைகள், பயன்முறை: ${[p.radius !== undefined && `வட்டம் ${p.radius}`, p.mode && `${p.mode} முறை`].filter(Boolean).join(", ")}` }),
  run(p, st, env) {
    const cur = st.get<BrandingArea>(area).tokens;
    const next: BrandTokensPatch = { ...cur };
    if (p.radius !== undefined) next.radius = p.radius;
    if (p.mode !== undefined) next.mode = p.mode;
    return save(st, env, next);
  },
});

const optionKeys = [...Object.keys(THEME_OPTIONS), ...Object.keys(LAYOUT_OPTIONS)];
export const setOptions = defineOp({
  kind: "theme.set_options",
  group: "theme",
  label: { en: "Change the store layout", ta: "கடையின் அமைப்பை மாற்று" },
  changes: { en: "Header, banner, product cards, listing, product page, page layout and phone tab bar", ta: "ஹெடர், பேனர், பொருள் அட்டைகள், பட்டியல், பொருள் பக்கம், பக்க அமைப்பு, கைபேசி டேப் பட்டை" },
  risk: "low",
  permission: null,
  fullAccess: true,
  features: ["storefront"],
  visual: true,
  schema: z
    .object({ options: z.record(z.string(), z.string()) })
    .superRefine((v, ctx) => {
      if (Object.keys(v.options).length === 0) ctx.addIssue({ code: "custom", message: "Give at least one option" });
      for (const [k, val] of Object.entries(v.options)) {
        const allowed = (THEME_OPTIONS as Record<string, readonly string[]>)[k] ?? (LAYOUT_OPTIONS as Record<string, readonly string[]>)[k];
        if (!allowed) ctx.addIssue({ code: "custom", message: `"${k}" is not a layout option` });
        else if (!allowed.includes(val)) ctx.addIssue({ code: "custom", message: `"${val}" is not allowed for ${k} (use ${allowed.join(", ")})` });
      }
    }),
  help: `options: { <option>: <value> } with the allowed values from list_theme_options. Options: ${optionKeys.join(", ")}`,
  areas: () => [area],
  target: () => "theme:options",
  describe: (p) => ({ en: `Layout: ${Object.entries(p.options).map(([k, v]) => `${k} = ${v}`).join(", ")}`, ta: `அமைப்பு: ${Object.entries(p.options).map(([k, v]) => `${k} = ${v}`).join(", ")}` }),
  run(p, st, env) {
    const parsed = storeThemePatchSchema.safeParse(p.options);
    if (!parsed.success) fail("invalid_value", "That layout option is not allowed.", "அந்த அமைப்பு விருப்பம் ஏற்கப்படாது.");
    const cur = st.get<BrandingArea>(area).tokens;
    return save(st, env, { ...cur, theme: { ...(cur.theme ?? {}), ...parsed.data } });
  },
});

export const setShopName = defineOp({
  kind: "brand.set_name",
  group: "theme",
  label: { en: "Change the shop name shown", ta: "காட்டப்படும் கடை பெயரை மாற்று" },
  changes: { en: "The name in the store header, emails and the app", ta: "கடை ஹெடர், மின்னஞ்சல்கள், செயலியில் உள்ள பெயர்" },
  risk: "medium",
  permission: null,
  fullAccess: true,
  features: ["storefront"],
  visual: true,
  schema: z.object({ appName: z.string().trim().min(1).max(80) }),
  help: "appName: the name to show (1-80 characters)",
  areas: () => [area],
  target: () => "brand:name",
  describe: (p) => ({ en: `Show the shop name "${p.appName}"`, ta: `கடை பெயரை "${p.appName}" என்று காட்டு` }),
  run(p, st) {
    st.set(area, { ...st.get<BrandingArea>(area), appName: p.appName } satisfies BrandingArea);
  },
});

export const THEME_OPS = [applyPreset, setColors, setTypography, setShape, setOptions, setShopName];
