import type { ThemePreset } from "./theme";

/**
 * The look for the `school` trade (app SV): a school's website, not a shop. A calm, trustworthy academic feel: warm
 * paper page, deep campus navy for buttons and links, a warm parchment accent, Libre Baskerville (a classic book serif) headings over
 * Lato, a solid classic bar that stays put, a split hero (words beside a campus picture), a footer with link columns
 * (admissions, contact, policies), tinted sections, plain framed cards with no Add button and no compare (programmes
 * and news are read, not carried home), underlined section headings, a tabbed detail page, and the standard layout
 * with no bottom tab bar. Why not lotus-mist (spa, indigo, airy) or copybook (stationery): this one is formal, dense
 * with information and structured like a noticeboard.
 */
export const CAMPUS_NAVY_PRESET: ThemePreset = {
  id: "campus-navy",
  name: "Campus Navy",
  description:
    "Warm paper page with deep campus-navy buttons and a parchment accent, classic Libre Baskerville headings over Work Sans, a solid classic bar, a split hero, framed cards without Add buttons and a footer with link columns. Schools, colleges, coaching and play schools.",
  colors: { primary: "#1c3f73", accent: "#f4e9d0", background: "#fbf9f3", foreground: "#17233a" },
  fontSans: "Work Sans",
  fontHeading: "Libre Baskerville",
  radius: 0.5,
  mode: "light",
  theme: {
    header: "classic",
    headerStyle: "solid",
    sticky: "always",
    megaMenu: "columns",
    announcement: "bar",
    footer: "columns",
    hero: "split",
    card: "framed",
    cardHover: "lift",
    cardButton: "none",
    imageRatio: "landscape",
    buttons: "rounded",
    density: "comfortable",
    sections: "tinted",
    motif: "grid",
    headings: "underline",
    productLayout: "thumbs-below",
    productDetails: "tabs",
    stickyBuy: "off",
    productTrust: "off",
    related: "grid",
    listingFilters: "sidebar",
    listingColumns: "3",
    listingView: "list",
    listingPaging: "pages",
    categoryHeader: "simple",
    subcategories: "chips",
    compare: "off",
    pageLayout: "standard",
    mobileNav: "off",
  },
};
