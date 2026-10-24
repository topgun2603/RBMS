import type { ThemePreset } from "./theme";

/**
 * Store #10 of the "20+ stores" series: Azhagu Beauty, Coimbatore (azhagu.localhost:3003), trade `cosmetics`. A
 * modern, bold beauty-counter look, like a make-up bar rather than a salon or a boutique: a cool near-white page, deep
 * berry ink and pill buttons with a blush tint surface on alternate bands, a wide grotesque display face (Syne) in
 * tracked capitals over a clean geometric body (Manrope), the logo centred over the menu on a frosted bar with a
 * scrolling offers ticker and a picture mega menu, a short banner hero (the home opens on category rings), square product tiles on filled blush cards that zoom
 * on hover, a gallery of all pictures in two columns on the product page with every detail open (shades, ingredients,
 * how to use and shelf life in one read), a filter sidebar with sub-category chips, banner category headers and a big
 * newsletter footer band. Chosen over a "clinical-luxe" nude-and-serif look because the series already has three
 * soft serif looks (salon-blush, boutique, zari): this one shouts in colour and type instead. Registered in
 * STORE_PRESETS (theme-presets-stores.ts); only a type import from theme.ts, so there is no runtime import cycle.
 */
export const BERRY_BOLD_PRESET: ThemePreset = {
  id: "berry-bold",
  name: "Berry Bold",
  description:
    "Deep berry on cool white with blush bands, wide grotesque capitals, a centred logo over a frosted bar and a scrolling ticker, square tiles on filled blush cards and an all-pictures product gallery with every detail open. Cosmetics, make-up and beauty stores.",
  colors: { primary: "#6b1240", accent: "#f9dfe6", background: "#fdfafb", foreground: "#1f0d17" },
  fontSans: "Manrope",
  fontHeading: "Syne",
  radius: 0.75,
  mode: "light",
  theme: {
    header: "centered",
    headerStyle: "glass",
    sticky: "always",
    megaMenu: "images",
    announcement: "ticker",
    footer: "newsletter",
    hero: "compact",
    card: "boxed",
    cardHover: "zoom",
    cardButton: "hover",
    imageRatio: "square",
    buttons: "pill",
    density: "comfortable",
    sections: "tinted",
    motif: "none",
    headings: "uppercase",
    productLayout: "grid",
    productDetails: "open",
    stickyBuy: "on",
    productTrust: "on",
    related: "rail",
    listingFilters: "sidebar",
    listingColumns: "4",
    listingView: "grid",
    listingPaging: "load-more",
    categoryHeader: "banner",
    subcategories: "chips",
    compare: "off",
  },
};
