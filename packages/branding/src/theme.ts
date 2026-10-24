import { z } from "zod";
import { STORE_PRESETS } from "./theme-presets-stores";
import { TRADE_PRESETS } from "./theme-presets-trades";

/**
 * Store theme: the structural look beyond colours and fonts. Each option is a named variant the storefront renders
 * differently (header layout, product card, hero, image shape…), so two shops can look like different products, not
 * the same page in another colour. Stored inside the brand tokens (`tokens.theme`).
 */
export const THEME_OPTIONS = {
  /**
   * classic: logo left, menu in the bar · centered: logo centred over the menu · minimal: slim bar, menu in a drawer
   * (also on desktop) · bold: brand-coloured bar · split: menu left, logo centred, icons right
   */
  header: ["classic", "centered", "minimal", "bold", "split"],
  /** glass: frosted, see-through bar · solid: opaque bar · transparent: over a full-width home banner, solid once scrolled */
  headerStyle: ["glass", "solid", "transparent"],
  /** always: stays on top · scroll-up: hides while scrolling down, back on scrolling up · never: scrolls away */
  sticky: ["always", "scroll-up", "never"],
  /** The "Shop" menu: images (category pictures + featured collection) · columns (category lists with sub-categories) · off */
  megaMenu: ["images", "columns", "off"],
  /** Offer ribbon: dismissible (rotating, can be closed) · bar (rotating, always there) · ticker (scrolling line) */
  announcement: ["dismissible", "bar", "ticker"],
  /** columns: link columns + newsletter card · centered: logo, links row, socials · newsletter: big signup band · minimal: one line */
  footer: ["columns", "centered", "newsletter", "minimal"],
  /** slider: full-width slides · split: text beside the picture · full: tall full-bleed picture · compact: short banner */
  hero: ["slider", "split", "full", "compact"],
  /**
   * standard: picture over text · minimal: no frame · framed: bordered tile · overlay: text over the picture ·
   * boxed: filled card, picture edge to edge · editorial: large picture, centred serif name
   */
  card: ["standard", "minimal", "framed", "overlay", "boxed", "editorial"],
  /** Card hover: rich (lift, zoom and second photo) · zoom · swap (second photo) · lift · none */
  cardHover: ["rich", "zoom", "swap", "lift", "none"],
  /** Add / quick-view buttons: hover (slide up on hover; framed cards show theirs) · always (under every card) · none */
  cardButton: ["hover", "always", "none"],
  /** portrait 4:5 (clothing) · square 1:1 (packaged goods) · landscape 4:3 (food, rooms, services) */
  imageRatio: ["portrait", "square", "landscape"],
  buttons: ["rounded", "pill", "square"],
  density: ["comfortable", "compact"],
  /** plain: on the page · tinted: alternate sections on a brand tint · boxed: sections in cards */
  sections: ["plain", "tinted", "boxed"],
  /**
   * Decorative pattern on brand blocks (hero without a picture, newsletter). stripes: diagonal hazard stripes ·
   * scallop: sweet-box lace (scalloped edge and dotted rows in the accent colour).
   */
  motif: ["none", "kolam", "dots", "waves", "grid", "stripes", "scallop"],
  /** Section headings: display (heading font, large) · uppercase (small caps, tracked) · underline (accent bar) */
  headings: ["display", "uppercase", "underline"],
  /**
   * Product page gallery: thumbs-side (thumbnails beside the picture) · thumbs-below · grid (all pictures in two
   * columns, details stay in view) · slider (full-width slider, details below)
   */
  productLayout: ["thumbs-side", "thumbs-below", "grid", "slider"],
  /** Description / details / shipping: accordion · tabs · open (all shown, one after another) */
  productDetails: ["accordion", "tabs", "open"],
  /** Phone buy bar that sticks to the bottom once the main button scrolls away. */
  stickyBuy: ["on", "off"],
  /** Trust badges (secure payment, COD, returns) under the buy buttons. */
  productTrust: ["on", "off"],
  /** "You may also like": rail (swipe row) · grid · off */
  related: ["rail", "grid", "off"],
  /**
   * Category, search and all-products pages. Filters: sidebar (beside the products on desktop, a sheet on phones) ·
   * top-bar (dropdowns in a bar above the products) · drawer (a Filters button opens a panel, on every screen)
   */
  listingFilters: ["sidebar", "top-bar", "drawer"],
  /** Product columns on a desktop listing (phones always show two). */
  listingColumns: ["2", "3", "4", "5"],
  /** First view of a listing: grid (tiles) · list (rows with a bigger text column); shoppers can switch. */
  listingView: ["grid", "list"],
  /** More products: pages (numbered) · load-more (a button) · infinite (as you scroll); all keep crawlable page links. */
  listingPaging: ["pages", "load-more", "infinite"],
  /** Top of a category page: simple (name and text) · banner (the category picture behind the name) · none (just the products) */
  categoryHeader: ["simple", "banner", "none"],
  /** Sub-categories of a category as chips above its products. */
  subcategories: ["chips", "off"],
  /** "Compare" on product cards and pages, a compare tray and a side-by-side compare page. */
  compare: ["on", "off"],
} as const;

export type ThemeOptionKey = keyof typeof THEME_OPTIONS;

/**
 * Page-level layout modes (Settings → Appearance → Page layout): how the whole store is laid out, beyond the header,
 * cards and listing options above. Kept apart from THEME_OPTIONS so presets don't have to set them: a theme without
 * them is the standard layout (DEFAULT_LAYOUT_THEME).
 */
export const LAYOUT_OPTIONS = {
  /**
   * standard: header on top, pages full width · rail: a sticky category rail beside home, category and product pages
   * (marketplace style; a category strip on phones) · sidebar: the header becomes a vertical menu on the left on
   * desktop · magazine: editorial pages: feature tiles in product grids, numbered section headings, wide type.
   */
  pageLayout: ["standard", "rail", "sidebar", "magazine"],
  /** Phones: off (the header's menu) · tabs (an app-like bottom tab bar: Home, Categories, Search, Cart, Account). */
  mobileNav: ["off", "tabs"],
} as const;
export type LayoutOptionKey = keyof typeof LAYOUT_OPTIONS;
export type LayoutTheme = { [K in LayoutOptionKey]: (typeof LAYOUT_OPTIONS)[K][number] };
export const DEFAULT_LAYOUT_THEME: LayoutTheme = { pageLayout: "standard", mobileNav: "off" };

export type StoreTheme = { [K in ThemeOptionKey]: (typeof THEME_OPTIONS)[K][number] } & Partial<LayoutTheme>;

const option = <K extends ThemeOptionKey>(k: K) => z.enum(THEME_OPTIONS[k] as unknown as [StoreTheme[K], ...StoreTheme[K][]]);

/** Options added after the first themes: optional in stored themes (older full themes still parse), default = the old look. */
const later = <K extends ThemeOptionKey>(k: K, v: StoreTheme[K]) => option(k).default(v);

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
  headerStyle: later("headerStyle", "glass"),
  sticky: later("sticky", "always"),
  megaMenu: later("megaMenu", "images"),
  announcement: later("announcement", "dismissible"),
  footer: later("footer", "columns"),
  cardHover: later("cardHover", "rich"),
  cardButton: later("cardButton", "hover"),
  productLayout: later("productLayout", "thumbs-side"),
  productDetails: later("productDetails", "accordion"),
  stickyBuy: later("stickyBuy", "on"),
  productTrust: later("productTrust", "on"),
  related: later("related", "rail"),
  listingFilters: later("listingFilters", "sidebar"),
  listingColumns: later("listingColumns", "4"),
  listingView: later("listingView", "grid"),
  listingPaging: later("listingPaging", "pages"),
  categoryHeader: later("categoryHeader", "simple"),
  subcategories: later("subcategories", "off"),
  compare: later("compare", "off"),
  // Page layout: optional (no default, so older themes and presets stay exactly as they were).
  pageLayout: z.enum(LAYOUT_OPTIONS.pageLayout).optional(),
  mobileNav: z.enum(LAYOUT_OPTIONS.mobileNav).optional(),
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
  headerStyle: "glass",
  sticky: "always",
  megaMenu: "images",
  announcement: "dismissible",
  footer: "columns",
  cardHover: "rich",
  cardButton: "hover",
  productLayout: "thumbs-side",
  productDetails: "accordion",
  stickyBuy: "on",
  productTrust: "on",
  related: "rail",
  listingFilters: "sidebar",
  listingColumns: "4",
  listingView: "grid",
  listingPaging: "pages",
  categoryHeader: "simple",
  subcategories: "off",
  compare: "off",
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

/** `data-sf-page-layout` / `data-sf-mobile-nav` for the store root (defaults filled in). */
export function layoutDataAttributes(theme: Partial<LayoutTheme> | null | undefined): Record<string, string> {
  const t = { ...DEFAULT_LAYOUT_THEME, ...(theme ?? {}) };
  return { "data-sf-page-layout": t.pageLayout, "data-sf-mobile-nav": t.mobileNav };
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
    theme: {
      header: "centered",
      hero: "full",
      card: "overlay",
      imageRatio: "portrait",
      buttons: "square",
      density: "comfortable",
      sections: "plain",
      motif: "none",
      headings: "uppercase",
      headerStyle: "transparent",
      sticky: "scroll-up",
      megaMenu: "images",
      announcement: "bar",
      footer: "centered",
      cardHover: "swap",
      cardButton: "hover",
      productLayout: "grid",
      productDetails: "accordion",
      stickyBuy: "on",
      productTrust: "off",
      related: "grid",
      listingFilters: "top-bar",
      listingColumns: "3",
      listingView: "grid",
      listingPaging: "load-more",
      categoryHeader: "banner",
      subcategories: "chips",
      compare: "off",
    },
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
    theme: {
      header: "bold",
      hero: "compact",
      card: "framed",
      imageRatio: "square",
      buttons: "rounded",
      density: "compact",
      sections: "tinted",
      motif: "dots",
      headings: "underline",
      headerStyle: "solid",
      sticky: "always",
      megaMenu: "columns",
      announcement: "ticker",
      footer: "newsletter",
      cardHover: "lift",
      cardButton: "always",
      productLayout: "thumbs-below",
      productDetails: "tabs",
      stickyBuy: "on",
      productTrust: "on",
      related: "rail",
      listingFilters: "sidebar",
      listingColumns: "5",
      listingView: "grid",
      listingPaging: "infinite",
      categoryHeader: "simple",
      subcategories: "chips",
      compare: "off",
    },
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
    theme: {
      header: "classic",
      hero: "split",
      card: "minimal",
      imageRatio: "square",
      buttons: "rounded",
      density: "comfortable",
      sections: "boxed",
      motif: "grid",
      headings: "underline",
      headerStyle: "solid",
      sticky: "always",
      megaMenu: "columns",
      announcement: "bar",
      footer: "columns",
      cardHover: "zoom",
      cardButton: "always",
      productLayout: "thumbs-below",
      productDetails: "tabs",
      stickyBuy: "on",
      productTrust: "on",
      related: "grid",
      listingFilters: "sidebar",
      listingColumns: "4",
      listingView: "list",
      listingPaging: "pages",
      categoryHeader: "simple",
      subcategories: "chips",
      compare: "on",
    },
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
    theme: {
      header: "centered",
      hero: "full",
      card: "standard",
      imageRatio: "landscape",
      buttons: "pill",
      density: "comfortable",
      sections: "tinted",
      motif: "waves",
      headings: "display",
      headerStyle: "transparent",
      sticky: "scroll-up",
      megaMenu: "images",
      announcement: "ticker",
      footer: "newsletter",
      cardHover: "zoom",
      cardButton: "hover",
      productLayout: "slider",
      productDetails: "open",
      stickyBuy: "on",
      productTrust: "on",
      related: "rail",
      listingFilters: "top-bar",
      listingColumns: "3",
      listingView: "grid",
      listingPaging: "load-more",
      categoryHeader: "banner",
      subcategories: "chips",
      compare: "off",
    },
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
    theme: {
      header: "minimal",
      hero: "split",
      card: "framed",
      imageRatio: "square",
      buttons: "square",
      density: "compact",
      sections: "boxed",
      motif: "grid",
      headings: "uppercase",
      headerStyle: "glass",
      sticky: "always",
      megaMenu: "columns",
      announcement: "bar",
      footer: "columns",
      cardHover: "lift",
      cardButton: "always",
      productLayout: "thumbs-side",
      productDetails: "tabs",
      stickyBuy: "on",
      productTrust: "on",
      related: "grid",
      listingFilters: "sidebar",
      listingColumns: "4",
      listingView: "grid",
      listingPaging: "load-more",
      categoryHeader: "simple",
      subcategories: "chips",
      compare: "on",
    },
  },
  {
    id: "luxe",
    name: "Luxe",
    description: "Black and gold, generous space, elegant serif names under tall pictures. Jewellery, salons and spas.",
    colors: { primary: "#b08d3c", accent: "#1c1917", background: "#0f0d0b", foreground: "#f5f0e6" },
    fontSans: "Montserrat",
    fontHeading: "Cormorant Garamond",
    radius: 0,
    mode: "dark",
    theme: {
      header: "centered",
      hero: "split",
      card: "editorial",
      imageRatio: "portrait",
      buttons: "square",
      density: "comfortable",
      sections: "plain",
      motif: "none",
      headings: "display",
      headerStyle: "solid",
      sticky: "scroll-up",
      megaMenu: "images",
      announcement: "dismissible",
      footer: "centered",
      cardHover: "swap",
      cardButton: "hover",
      productLayout: "grid",
      productDetails: "accordion",
      stickyBuy: "on",
      productTrust: "off",
      related: "rail",
      listingFilters: "drawer",
      listingColumns: "3",
      listingView: "grid",
      listingPaging: "load-more",
      categoryHeader: "banner",
      subcategories: "off",
      compare: "off",
    },
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
    theme: {
      header: "bold",
      hero: "full",
      card: "overlay",
      imageRatio: "landscape",
      buttons: "square",
      density: "comfortable",
      sections: "plain",
      motif: "none",
      headings: "uppercase",
      headerStyle: "solid",
      sticky: "always",
      megaMenu: "images",
      announcement: "ticker",
      footer: "newsletter",
      cardHover: "zoom",
      cardButton: "hover",
      productLayout: "slider",
      productDetails: "tabs",
      stickyBuy: "on",
      productTrust: "on",
      related: "rail",
      listingFilters: "drawer",
      listingColumns: "3",
      listingView: "grid",
      listingPaging: "infinite",
      categoryHeader: "banner",
      subcategories: "chips",
      compare: "off",
    },
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
    theme: {
      header: "bold",
      hero: "compact",
      card: "boxed",
      imageRatio: "square",
      buttons: "rounded",
      density: "compact",
      sections: "plain",
      motif: "grid",
      headings: "uppercase",
      headerStyle: "solid",
      sticky: "always",
      megaMenu: "columns",
      announcement: "bar",
      footer: "minimal",
      cardHover: "none",
      cardButton: "always",
      productLayout: "thumbs-below",
      productDetails: "open",
      stickyBuy: "on",
      productTrust: "on",
      related: "grid",
      listingFilters: "sidebar",
      listingColumns: "5",
      listingView: "list",
      listingPaging: "pages",
      categoryHeader: "simple",
      subcategories: "chips",
      compare: "on",
    },
  },
  {
    id: "atelier",
    name: "Atelier",
    description: "Crafted and personal: logo between the menu and icons, split hero, portrait pictures. Tailors and designers.",
    colors: { primary: "#4338ca", accent: "#ede9fe", background: "#fdfcff" },
    fontSans: "Lato",
    fontHeading: "Libre Baskerville",
    radius: 0.5,
    mode: "light",
    theme: {
      header: "split",
      hero: "split",
      card: "minimal",
      imageRatio: "portrait",
      buttons: "pill",
      density: "comfortable",
      sections: "boxed",
      motif: "kolam",
      headings: "underline",
      headerStyle: "glass",
      sticky: "always",
      megaMenu: "images",
      announcement: "dismissible",
      footer: "centered",
      cardHover: "swap",
      cardButton: "hover",
      productLayout: "thumbs-side",
      productDetails: "open",
      stickyBuy: "on",
      productTrust: "on",
      related: "rail",
      listingFilters: "top-bar",
      listingColumns: "3",
      listingView: "grid",
      listingPaging: "pages",
      categoryHeader: "banner",
      subcategories: "off",
      compare: "off",
    },
  },
  ...TRADE_PRESETS,
  ...STORE_PRESETS,
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
  "Archivo",
  "Oswald",
  "Barlow",
  "Barlow Condensed",
  "Eczar",
  "Fraunces",
  "Playfair Display",
  "Cormorant Garamond",
  "Libre Baskerville",
  "Bodoni Moda",
  "Zilla Slab",
  "Syne",
  "Fredoka",
  "Noto Sans Tamil",
  "Hind Madurai",
  "Mukta Malar",
  "Catamaran",
  "Baloo Thambi 2",
  "Unbounded",
  "Arima",
  "JetBrains Mono",
  "Cinzel",
  "Alegreya",
  "Quicksand",
  "Big Shoulders Display",
  "Rubik",
  "Bricolage Grotesque",
] as const;
