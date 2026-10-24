import type { ThemePreset } from "./theme";

/**
 * Store #7 of the "20+ stores" series: Padham Footwear, Vellore (padham.localhost:3003), trade `footwear`. A bold,
 * sporty sneaker-wall look rather than another warm, cream boutique (8 of the light presets already sit on cream or
 * ivory, and a tan-on-cream "leather craft" look would land next to earthen, heritage and tailor-atelier): a cool
 * chalk-white page with near-black ink, electric cobalt for buttons and links and a volt-lime tint for surfaces, the
 * wide athletic grotesk Archivo in uppercase over Inter, a frosted classic header with an image mega menu and a ticker
 * for the school-season offers, a split hero, landscape tiles (shoes are wider than tall) in boxed cards that lift on
 * hover with the add button on hover, a product page that lays the pictures out in a grid with an accordion of
 * details, a top filter bar over four columns with infinite scroll, and a footer led by the newsletter. Registered in
 * STORE_PRESETS (theme-presets-stores.ts); only a type import from theme.ts, so there is no runtime import cycle.
 */
export const STRIDE_PRESET: ThemePreset = {
  id: "stride",
  name: "Stride",
  description:
    "Electric cobalt and volt lime on chalk white with near-black ink, a wide athletic uppercase grotesk, a split hero, landscape tiles in boxed cards that lift, a grid product gallery and infinite listings. Footwear, sports and sneaker stores.",
  colors: { primary: "#2a3bd6", accent: "#e4f86b", background: "#f6f6f3", foreground: "#0c0c0e" },
  fontSans: "Inter",
  fontHeading: "Archivo",
  radius: 0.75,
  mode: "light",
  theme: {
    header: "classic",
    headerStyle: "glass",
    sticky: "always",
    megaMenu: "images",
    announcement: "ticker",
    footer: "newsletter",
    hero: "split",
    card: "boxed",
    cardHover: "lift",
    cardButton: "hover",
    imageRatio: "landscape",
    buttons: "pill",
    density: "compact",
    sections: "boxed",
    motif: "none",
    headings: "uppercase",
    productLayout: "grid",
    productDetails: "accordion",
    stickyBuy: "on",
    productTrust: "on",
    related: "rail",
    listingFilters: "top-bar",
    listingColumns: "4",
    listingView: "grid",
    listingPaging: "infinite",
    categoryHeader: "simple",
    subcategories: "chips",
    compare: "off",
  },
};
