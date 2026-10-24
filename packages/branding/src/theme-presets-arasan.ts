import type { ThemePreset } from "./theme";

/**
 * Store #6 of the "20+ stores" series: Arasan Menswear, Coimbatore (arasan.localhost:3003), trade `fashion`. A
 * confident, tailored men's-shop look, like a suit counter rather than a boutique: a crisp cool-white page, deep navy
 * ink and buttons with a tan-leather tint surface, a wide geometric sans (Montserrat) in tracked capitals over a clean
 * grotesque body (DM Sans), a navy bar header with a picture mega menu, sharp square buttons and frameless square
 * tiles four across with a second-photo swap, a geometric grid motif on brand blocks, a filter sidebar with
 * sub-category chips and endless scrolling, the product gallery with thumbnails at the side and a one-line footer.
 * Registered in STORE_PRESETS (theme-presets-stores.ts); only a type import from theme.ts, so there is no runtime
 * import cycle.
 */
export const TAILORED_PRESET: ThemePreset = {
  id: "tailored",
  name: "Tailored",
  description:
    "Deep navy on crisp white with a tan-leather surface, wide geometric capitals, a navy bar header with a picture mega menu, sharp square buttons and frameless square tiles four across. Menswear, suiting and men's accessories.",
  colors: { primary: "#14213d", accent: "#eadbc6", background: "#f8f8f6", foreground: "#111318" },
  fontSans: "DM Sans",
  fontHeading: "Montserrat",
  radius: 0,
  mode: "light",
  theme: {
    header: "bold",
    headerStyle: "solid",
    sticky: "always",
    megaMenu: "images",
    announcement: "dismissible",
    footer: "minimal",
    hero: "split",
    card: "minimal",
    cardHover: "swap",
    cardButton: "hover",
    imageRatio: "square",
    buttons: "square",
    density: "compact",
    sections: "plain",
    motif: "grid",
    headings: "uppercase",
    productLayout: "thumbs-side",
    productDetails: "accordion",
    stickyBuy: "on",
    productTrust: "on",
    related: "rail",
    listingFilters: "sidebar",
    listingColumns: "4",
    listingView: "grid",
    listingPaging: "infinite",
    categoryHeader: "simple",
    subcategories: "chips",
    compare: "off",
  },
};
