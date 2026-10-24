import type { ThemePreset } from "./theme";

/**
 * Store #2 of the series: Porunai Sweets & Bakery, Tirunelveli (porunai.localhost:3003). A festive sweet-stall look:
 * ivory paper, deep maroon and saffron like a sweet box, a decorative Indian display serif (Eczar) over a friendly
 * rounded body (Nunito), sweet-box lace (the `scallop` motif) on brand blocks, pill buttons and tall portrait tiles
 * in filled cards. Registered in STORE_PRESETS (theme-presets-stores.ts); only a type import, no runtime cycle.
 */
export const MITHAI_PRESET: ThemePreset = {
  id: "mithai",
  name: "Mithai",
  description:
    "Ivory and deep maroon with saffron, a decorative display serif, sweet-box lace edges, pill buttons and tall filled tiles. Sweet stalls, bakeries and festival gifting.",
  colors: { primary: "#7a1f2b", accent: "#fde3ad", background: "#fff8ec", foreground: "#2e1510" },
  fontSans: "Nunito",
  fontHeading: "Eczar",
  radius: 1,
  mode: "light",
  theme: {
    header: "centered",
    headerStyle: "solid",
    sticky: "scroll-up",
    megaMenu: "images",
    announcement: "bar",
    footer: "centered",
    hero: "slider",
    card: "boxed",
    cardHover: "lift",
    cardButton: "always",
    imageRatio: "portrait",
    buttons: "pill",
    density: "comfortable",
    sections: "tinted",
    motif: "scallop",
    headings: "display",
    productLayout: "thumbs-below",
    productDetails: "open",
    stickyBuy: "on",
    productTrust: "on",
    related: "grid",
    listingFilters: "top-bar",
    listingColumns: "3",
    listingView: "grid",
    listingPaging: "pages",
    categoryHeader: "banner",
    subcategories: "chips",
    compare: "off",
    // Page layout: the counters, search and cart in a left menu on desktop (a sweet-shop price board), and a bottom
    // tab bar on phones for the festival-week repeat orders.
    pageLayout: "sidebar",
    mobileNav: "tabs",
  },
};
