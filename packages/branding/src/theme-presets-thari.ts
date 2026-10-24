import type { ThemePreset } from "./theme";

/**
 * Store #5 of the "20+ stores" series: Thari Silks, Kanchipuram (thari.localhost:3003), trade `fashion`. An editorial
 * silk-house look, like a bridal lookbook rather than a shop counter: a champagne-ivory page, deep peacock-teal ink
 * and buttons with an antique-gold tint surface, a high-contrast Didone (Bodoni Moda) over a clean geometric body
 * (Jost), a split header with the logo large in the middle over a full-bleed transparent-header hero, tall portrait
 * pictures with centred serif names and no buttons on the tiles, zari-butta dots on brand blocks, a full-width
 * gallery slider on the product page with tabbed details, and a centred footer that keeps every page link (size
 * guide, silk care, credits) in one row. Registered in STORE_PRESETS (theme-presets-stores.ts); only a type import
 * from theme.ts, so there is no runtime import cycle.
 */
export const ZARI_PRESET: ThemePreset = {
  id: "zari",
  name: "Zari",
  description:
    "Peacock teal and antique gold on champagne ivory, a high-contrast Didone serif, a centred logo over a full-bleed picture, tall editorial tiles without buttons, zari-butta dots and a large gallery slider. Silk sarees, bridal and handloom boutiques.",
  colors: { primary: "#0b4a4f", accent: "#f0e4c4", background: "#fbf7ef", foreground: "#1d1a16" },
  fontSans: "Jost",
  fontHeading: "Bodoni Moda",
  radius: 0,
  mode: "light",
  theme: {
    header: "split",
    headerStyle: "transparent",
    sticky: "scroll-up",
    megaMenu: "images",
    announcement: "bar",
    footer: "centered",
    hero: "full",
    card: "editorial",
    cardHover: "zoom",
    cardButton: "none",
    imageRatio: "portrait",
    buttons: "square",
    density: "comfortable",
    sections: "plain",
    motif: "dots",
    headings: "display",
    productLayout: "slider",
    productDetails: "tabs",
    stickyBuy: "on",
    productTrust: "on",
    related: "grid",
    listingFilters: "drawer",
    listingColumns: "3",
    listingView: "grid",
    listingPaging: "pages",
    categoryHeader: "banner",
    subcategories: "off",
    compare: "off",
    // Page layout: editorial pages (numbered display headings, feature tiles in product grids, a large product
    // title) for a lookbook-style saree boutique; phones keep the normal header.
    pageLayout: "magazine",
    mobileNav: "off",
  },
};
