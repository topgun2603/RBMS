import type { ThemePreset } from "./theme";

/**
 * Store #22 of the "20+ stores" series: Thunai Pharmacy & Wellness, a neighbourhood pharmacy in Fairlands, Salem
 * (thunai.localhost:3003; counter and admin thunai.localhost:3006), trade `pharmacy`, app PH. It replaces the earlier
 * half-built demo pharmacy on the trade's own look. A calm clinical look for people who come back every month:
 * saline blue (a denim-teal no other preset uses) on a cool, near-white page, a pale-ice accent, Jost headings over Hind
 * Madurai (whose Tamil matches its Latin), a split bar (menu left, logo in the middle, search / account / cart right)
 * with a quiet frosted background and category columns in the mega menu, filled boxed tiles with a square picture and
 * an Add button always showing (a repeat order is two taps), pill buttons, tinted sections with a wave motif, an
 * underline heading, a product page with every detail open on one scroll (uses, composition, storage: a medicine's
 * leaflet is read, not hidden in a tab), a filters drawer on a four-column grid, numbered pages and compare on (two
 * glucometers or BP monitors side by side). Page layout: rail + phone tabs (a category rail down the side of a long
 * catalogue; the bottom tab bar for the monthly reorder from the phone). The home has no hero: it opens with "what do
 * you need today?".
 * Why not pharma-clean (the trade's default, emerald, classic bar, tabbed leaflet) or care (cyan, minimal cards): this
 * one is a different structure end to end, not a recolour.
 * Registered in STORE_PRESETS (theme-presets-stores.ts); only a type import from theme.ts.
 */
export const SALINE_BLUE_PRESET: ThemePreset = {
  id: "saline-blue",
  name: "Saline Blue",
  description:
    "Saline blue on a cool near-white page with a pale-ice accent, Jost headings over Hind Madurai, a split bar, filled square cards with an Add button always showing, pill buttons, tinted sections, a one-scroll medicine page, a filters drawer and compare. Pharmacies, clinics, diagnostic labs and wellness stores.",
  colors: { primary: "#1d5f8a", accent: "#dcebf4", background: "#f5f9fc", foreground: "#14232e" },
  fontSans: "Hind Madurai",
  fontHeading: "Jost",
  radius: 0.75,
  mode: "light",
  theme: {
    header: "split",
    headerStyle: "glass",
    sticky: "always",
    megaMenu: "columns",
    announcement: "ticker",
    footer: "columns",
    hero: "split",
    card: "boxed",
    cardHover: "lift",
    cardButton: "always",
    imageRatio: "square",
    buttons: "pill",
    density: "comfortable",
    sections: "tinted",
    motif: "waves",
    headings: "underline",
    productLayout: "thumbs-side",
    productDetails: "open",
    stickyBuy: "on",
    productTrust: "on",
    related: "grid",
    listingFilters: "drawer",
    listingColumns: "4",
    listingView: "grid",
    listingPaging: "pages",
    categoryHeader: "simple",
    subcategories: "chips",
    compare: "on",
    pageLayout: "rail",
    mobileNav: "tabs",
  },
};
