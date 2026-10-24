import type { ThemePreset } from "./theme";

/**
 * Store #3 of the "20+ stores" series: Cauvery Fresh Market, Trichy (cauvery.localhost:3003). A crisp daily-market
 * look for fruits, vegetables, meat and fish: a near-white leaf-tinted page, leaf-green buttons and links, a soft
 * citrus-peach surface, rounded geometric headings over a friendly body face, pill buttons on clean standard cards
 * with the add button always showing, five-across square tiles and a filter bar on top for quick ordering, a solid
 * sticky header and every product detail open on the page (no tabs to dig through). Registered in STORE_PRESETS
 * (theme-presets-stores.ts); only a type import from theme.ts, so there is no runtime import cycle.
 */
export const CRISP_GREENS: ThemePreset = {
  id: "crisp-greens",
  name: "Crisp Greens",
  description:
    "Leaf green on a near-white page with a citrus-peach surface, rounded Poppins headings, pill buttons and clean square tiles five across with the add button always on. Fruits, vegetables, meat and fish sold by weight.",
  colors: { primary: "#1a7f37", accent: "#fff0e8", background: "#f6fbf3", foreground: "#10261a" },
  fontSans: "Nunito",
  fontHeading: "Poppins",
  radius: 1,
  mode: "light",
  theme: {
    header: "classic",
    headerStyle: "solid",
    sticky: "always",
    megaMenu: "images",
    announcement: "bar",
    footer: "columns",
    hero: "slider",
    card: "standard",
    cardHover: "lift",
    cardButton: "always",
    imageRatio: "square",
    buttons: "pill",
    density: "compact",
    sections: "boxed",
    motif: "none",
    headings: "display",
    productLayout: "thumbs-below",
    productDetails: "open",
    stickyBuy: "on",
    productTrust: "on",
    related: "rail",
    listingFilters: "top-bar",
    listingColumns: "5",
    listingView: "grid",
    listingPaging: "infinite",
    categoryHeader: "simple",
    subcategories: "chips",
    compare: "off",
    // Page layout: the standard page with an app-like bottom tab bar on phones (Home, Categories, Search, Cart,
    // Account) for the daily morning order; the home's category shelf does the department browsing.
    pageLayout: "standard",
    mobileNav: "tabs",
  },
};
