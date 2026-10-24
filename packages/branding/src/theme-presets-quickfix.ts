import type { ThemePreset } from "./theme";

/**
 * Demo store QuickFix Mobile Care, Gandhipuram, Coimbatore (quickfix.localhost:3003), trade `repair`, app SV.
 * A repair-first service desk, not a gadget shop: where Kaipesi's carbon-spec is a dark, dense, monospaced parts
 * counter (rail + tabs, accessories by model), QuickFix is a light, airy "job ticket" look: a cool paper page, deep
 * ticket violet for buttons and links, a lemon-yellow tag colour (the repair tag tied to every device) and condensed
 * Oswald headings under a friendly Tamil-ready Hind Madurai body. Services are sold by problem, so cards are plain
 * landscape tiles with a hover button, the listing opens a Filters drawer (device, problem, price) over three columns
 * that load by button, and the product page is a thumbnail-below gallery with tabbed details (what's included, time,
 * warranty). A split header with a ticker of offers, plain tinted sections with underlined headings, pill buttons and
 * no motif. Page layout: the category rail (repairs by device on the left, a chip strip on phones) but no bottom tab
 * bar: a repair customer visits once or twice a year, there is no repeat-basket to speed up. Violet is a primary no
 * other preset uses; Oswald over Hind Madurai is a new pair. Registered in STORE_PRESETS.
 */
export const REPAIR_BENCH_PRESET: ThemePreset = {
  id: "repair-bench",
  name: "Repair Bench",
  description:
    "Light cool-paper page with ticket-violet buttons and lemon repair-tag accents, condensed Oswald headings, plain landscape service tiles, a filters drawer, a tabbed product page and the category rail. Repair shops, service centres and technician businesses.",
  colors: { primary: "#5b21b6", accent: "#fde68a", background: "#faf9fc", foreground: "#17132a" },
  fontSans: "Hind Madurai",
  fontHeading: "Oswald",
  radius: 0.75,
  mode: "light",
  theme: {
    header: "split",
    headerStyle: "solid",
    sticky: "never",
    megaMenu: "off",
    announcement: "ticker",
    footer: "minimal",
    hero: "split",
    card: "standard",
    cardHover: "lift",
    cardButton: "hover",
    imageRatio: "landscape",
    buttons: "pill",
    density: "comfortable",
    sections: "tinted",
    motif: "none",
    headings: "underline",
    productLayout: "thumbs-below",
    productDetails: "tabs",
    stickyBuy: "on",
    productTrust: "on",
    related: "grid",
    listingFilters: "drawer",
    listingColumns: "3",
    listingView: "grid",
    listingPaging: "load-more",
    categoryHeader: "banner",
    subcategories: "chips",
    compare: "on",
    pageLayout: "rail",
    mobileNav: "off",
  },
};
