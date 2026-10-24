import type { ThemePreset } from "./theme";

/**
 * Store #4 of the "20+ stores" series: Vayal Organics, Erode (vayal.localhost:3003), trade `organic`. An earthy,
 * unhurried look: unbleached-paper page, forest-green ink with a turmeric tint, a bookish serif over a Tamil-friendly
 * humanist sans, soft filled cards with landscape (field / kitchen) pictures, kolam brand blocks and roomy, tinted
 * sections. Registered in STORE_PRESETS (theme-presets-stores.ts); only a type import from theme.ts.
 */
export const EARTHEN_PRESET: ThemePreset = {
  id: "earthen",
  name: "Earthen",
  description:
    "Unbleached paper, forest green and turmeric, a bookish serif with a warm Tamil-friendly sans, soft filled cards with landscape pictures and kolam blocks. Organic stores, millets, cold-pressed oils and naturals.",
  colors: { primary: "#355e3b", accent: "#f1e0b5", background: "#f7f2e6", foreground: "#2b2418" },
  fontSans: "Hind Madurai",
  fontHeading: "Libre Baskerville",
  radius: 1,
  mode: "light",
  theme: {
    header: "split",
    headerStyle: "glass",
    sticky: "scroll-up",
    megaMenu: "images",
    announcement: "bar",
    footer: "newsletter",
    hero: "split",
    card: "boxed",
    cardHover: "lift",
    cardButton: "always",
    imageRatio: "landscape",
    buttons: "pill",
    density: "comfortable",
    sections: "tinted",
    motif: "kolam",
    headings: "display",
    productLayout: "grid",
    productDetails: "accordion",
    stickyBuy: "on",
    productTrust: "on",
    related: "rail",
    listingFilters: "drawer",
    listingColumns: "3",
    listingView: "grid",
    listingPaging: "load-more",
    categoryHeader: "banner",
    subcategories: "off",
    compare: "off",
    // Page layout: a fixed left menu on desktop (pantry, search, cart: a farm-brand look) so the home can open on the
    // full-width farm story; phones keep the normal header.
    pageLayout: "sidebar",
    mobileNav: "off",
  },
};
