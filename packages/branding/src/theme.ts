import { z } from "zod";

/**
 * Store theme: the structural look beyond colours and fonts. Each option is a named variant the storefront renders
 * differently (header layout, product card, hero, image shape…), so two shops can look like different products, not
 * the same page in another colour. Stored inside the brand tokens (`tokens.theme`).
 */
export const THEME_OPTIONS = {
  /** classic: logo left, menu in the bar · centered: logo centred over the menu · minimal: slim bar, menu in a drawer · bold: brand-coloured bar */
  header: ["classic", "centered", "minimal", "bold"],
  /** slider: full-width slides · split: text beside the picture · full: tall full-bleed picture · compact: short banner */
  hero: ["slider", "split", "full", "compact"],
  /** standard: picture over text · minimal: no frame · framed: bordered tile · overlay: text over the picture */
  card: ["standard", "minimal", "framed", "overlay"],
  /** portrait 4:5 (clothing) · square 1:1 (packaged goods) · landscape 4:3 (food, rooms, services) */
  imageRatio: ["portrait", "square", "landscape"],
  buttons: ["rounded", "pill", "square"],
  density: ["comfortable", "compact"],
  /** plain: on the page · tinted: alternate sections on a brand tint · boxed: sections in cards */
  sections: ["plain", "tinted", "boxed"],
  /** Decorative pattern on brand blocks (hero without a picture, newsletter). */
  motif: ["none", "kolam", "dots", "waves", "grid"],
  /** Section headings: display (heading font, large) · uppercase (small caps, tracked) · underline (accent bar) */
  headings: ["display", "uppercase", "underline"],
} as const;

export type ThemeOptionKey = keyof typeof THEME_OPTIONS;
export type StoreTheme = { [K in ThemeOptionKey]: (typeof THEME_OPTIONS)[K][number] };

const option = <K extends ThemeOptionKey>(k: K) => z.enum(THEME_OPTIONS[k] as unknown as [StoreTheme[K], ...StoreTheme[K][]]);

export const storeThemeSchema = z.object({
  header: option("header"),
  hero: option("hero"),
  card: option("card"),
  imageRatio: option("imageRatio"),
  buttons: option("buttons"),
  density: option("density"),
  sections: option("sections"),
  motif: option("motif"),
  headings: option("headings"),
});

export const storeThemePatchSchema = storeThemeSchema.partial();
export type StoreThemePatch = z.output<typeof storeThemePatchSchema>;

/** The look stores had before themes (kept for shops that never chose one). */
export const DEFAULT_STORE_THEME: StoreTheme = {
  header: "classic",
  hero: "slider",
  card: "standard",
  imageRatio: "portrait",
  buttons: "pill",
  density: "comfortable",
  sections: "plain",
  motif: "kolam",
  headings: "display",
};

export const IMAGE_RATIO_CSS: Record<StoreTheme["imageRatio"], string> = { portrait: "4 / 5", square: "1 / 1", landscape: "4 / 3" };
const BUTTON_RADIUS: Record<StoreTheme["buttons"], string> = { rounded: "calc(var(--radius) + 0.125rem)", pill: "9999px", square: "0.125rem" };
const DENSITY_SCALE: Record<StoreTheme["density"], string> = { comfortable: "1", compact: "0.72" };

/** CSS variables for the theme (the structural variants are read from `data-sf-*` attributes). */
export function themeCssVariables(theme: StoreTheme): Record<string, string> {
  return {
    "--sf-image-ratio": IMAGE_RATIO_CSS[theme.imageRatio],
    "--sf-button-radius": BUTTON_RADIUS[theme.buttons],
    "--sf-density": DENSITY_SCALE[theme.density],
  };
}

/** `data-sf-*` attributes for the store root, e.g. `{ "data-sf-header": "centered" }`. */
export function themeDataAttributes(theme: StoreTheme): Record<string, string> {
  return Object.fromEntries((Object.keys(THEME_OPTIONS) as ThemeOptionKey[]).map((k) => [`data-sf-${k.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`, theme[k]]));
}

export interface ThemePreset {
  id: string;
  name: string;
  description: string;
  colors: { primary: string; secondary?: string; accent?: string; background?: string; foreground?: string };
  fontSans: string;
  fontHeading: string;
  radius: number;
  mode: "light" | "dark";
  theme: StoreTheme;
}

/**
 * Ready-made looks. A preset fills every token; the shop can then change any single part. Fonts are Google Fonts
 * (the storefront loads them).
 */
export const THEME_PRESETS: ThemePreset[] = [
  {
    id: "heritage",
    name: "Heritage",
    description: "Warm serif headings, kolam patterns and portrait photos: handloom, sarees and festive wear.",
    colors: { primary: "#9d174d", accent: "#fde7c8" },
    fontSans: "Plus Jakarta Sans",
    fontHeading: "Fraunces",
    radius: 0.75,
    mode: "light",
    theme: { ...DEFAULT_STORE_THEME },
  },
  {
    id: "boutique",
    name: "Boutique",
    description: "Editorial and airy: centred logo, tall pictures with names over them, square buttons.",
    colors: { primary: "#111111", accent: "#f3ede6", background: "#fcfaf7" },
    fontSans: "Jost",
    fontHeading: "Playfair Display",
    radius: 0,
    mode: "light",
    theme: { header: "centered", hero: "full", card: "overlay", imageRatio: "portrait", buttons: "square", density: "comfortable", sections: "plain", motif: "none", headings: "uppercase" },
  },
  {
    id: "fresh",
    name: "Fresh market",
    description: "Bright and friendly: square product tiles, compact banner, tinted aisles. Grocery, fruits and vegetables.",
    colors: { primary: "#15803d", accent: "#fef3c7", background: "#fbfdf8" },
    fontSans: "Nunito",
    fontHeading: "Nunito",
    radius: 1,
    mode: "light",
    theme: { header: "bold", hero: "compact", card: "framed", imageRatio: "square", buttons: "rounded", density: "compact", sections: "tinted", motif: "dots", headings: "underline" },
  },
  {
    id: "care",
    name: "Care",
    description: "Clean and trustworthy: crisp sans type, square pictures, quiet layout. Pharmacies, opticals and clinics.",
    colors: { primary: "#0e7490", accent: "#e0f2fe", background: "#f8fbfc" },
    fontSans: "Inter",
    fontHeading: "Manrope",
    radius: 0.5,
    mode: "light",
    theme: { header: "classic", hero: "split", card: "minimal", imageRatio: "square", buttons: "rounded", density: "comfortable", sections: "boxed", motif: "grid", headings: "underline" },
  },
  {
    id: "bistro",
    name: "Bistro",
    description: "Appetising and warm: wide food photos, big hero, soft wave patterns. Restaurants, cafés and bakeries.",
    colors: { primary: "#c2410c", accent: "#fff1e0", background: "#fffaf5" },
    fontSans: "DM Sans",
    fontHeading: "Fraunces",
    radius: 1,
    mode: "light",
    theme: { header: "centered", hero: "full", card: "standard", imageRatio: "landscape", buttons: "pill", density: "comfortable", sections: "tinted", motif: "waves", headings: "display" },
  },
  {
    id: "tech",
    name: "Tech",
    description: "Sharp and modern: dark surfaces, framed spec tiles, square corners. Electronics, mobiles and repairs.",
    colors: { primary: "#3b82f6", accent: "#1e293b", background: "#0b1220", foreground: "#e5e7eb" },
    fontSans: "Manrope",
    fontHeading: "Space Grotesk",
    radius: 0.25,
    mode: "dark",
    theme: { header: "minimal", hero: "split", card: "framed", imageRatio: "square", buttons: "square", density: "compact", sections: "boxed", motif: "grid", headings: "uppercase" },
  },
  {
    id: "luxe",
    name: "Luxe",
    description: "Black and gold, generous space, elegant serif. Jewellery, salons and spas.",
    colors: { primary: "#b08d3c", accent: "#1c1917", background: "#0f0d0b", foreground: "#f5f0e6" },
    fontSans: "Montserrat",
    fontHeading: "Cormorant Garamond",
    radius: 0,
    mode: "dark",
    theme: { header: "centered", hero: "split", card: "minimal", imageRatio: "portrait", buttons: "square", density: "comfortable", sections: "plain", motif: "none", headings: "display" },
  },
  {
    id: "power",
    name: "Power",
    description: "High energy: bold condensed headings, brand-coloured bar, wide photos. Gyms and fitness studios.",
    colors: { primary: "#dc2626", accent: "#18181b", background: "#09090b", foreground: "#fafafa" },
    fontSans: "Inter",
    fontHeading: "Oswald",
    radius: 0.25,
    mode: "dark",
    theme: { header: "bold", hero: "full", card: "overlay", imageRatio: "landscape", buttons: "square", density: "comfortable", sections: "plain", motif: "none", headings: "uppercase" },
  },
  {
    id: "workshop",
    name: "Workshop",
    description: "Practical and dense: square tiles, compact lists, sturdy type. Hardware, tools and building materials.",
    colors: { primary: "#b45309", accent: "#fef3c7", background: "#fafaf9" },
    fontSans: "Work Sans",
    fontHeading: "Work Sans",
    radius: 0.375,
    mode: "light",
    theme: { header: "bold", hero: "compact", card: "framed", imageRatio: "square", buttons: "rounded", density: "compact", sections: "plain", motif: "grid", headings: "uppercase" },
  },
  {
    id: "atelier",
    name: "Atelier",
    description: "Crafted and personal: split hero, portrait pictures, underlined headings. Tailors and designers.",
    colors: { primary: "#4338ca", accent: "#ede9fe", background: "#fdfcff" },
    fontSans: "Lato",
    fontHeading: "Libre Baskerville",
    radius: 0.5,
    mode: "light",
    theme: { header: "classic", hero: "split", card: "minimal", imageRatio: "portrait", buttons: "pill", density: "comfortable", sections: "boxed", motif: "kolam", headings: "underline" },
  },
];

export const themePreset = (id: string | null | undefined) => THEME_PRESETS.find((p) => p.id === id) ?? null;

/** Google Fonts offered in the store's appearance editor (body and headings; Tamil-ready faces included). */
export const STORE_FONTS = [
  "Inter",
  "Manrope",
  "DM Sans",
  "Plus Jakarta Sans",
  "Nunito",
  "Lato",
  "Jost",
  "Work Sans",
  "Montserrat",
  "Poppins",
  "Space Grotesk",
  "Oswald",
  "Fraunces",
  "Playfair Display",
  "Cormorant Garamond",
  "Libre Baskerville",
  "Noto Sans Tamil",
  "Hind Madurai",
  "Mukta Malar",
  "Catamaran",
  "Baloo Thambi 2",
] as const;
