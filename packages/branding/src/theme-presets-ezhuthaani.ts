import type { ThemePreset } from "./theme";

/**
 * Store #8 of the "20+ stores" series: Ezhuthaani Books & Stationery, Palayamkottai, Tirunelveli
 * (ezhuthaani.localhost:3003), trade `stationery`. A playful-academic "copybook" look, like a school notebook rather
 * than a boutique or a market: ink-blue (fountain-pen ink) buttons and links on a ruled paper-white page, a
 * pencil-yellow tint for alternate sections and badges, a sturdy textbook slab serif (Zilla Slab) over a plain,
 * very readable body (Lato), graph-paper grid on brand blocks and highlighter-underlined section headings. The
 * structure is built for list shoppers who buy many small things at once: a frosted classic header that stays on
 * top with a column mega menu (category → type), a compact hero, index-card tiles (framed, rounded) with Add always
 * visible, five columns and a top filter bar on listings that open as a list (pages, ruling and class read best in
 * rows) with infinite paging and chips, thumbnails under the picture and every detail open on the product page, a
 * rail of related items and compare for calculators and bags. Registered in STORE_PRESETS (theme-presets-stores.ts);
 * only a type import from theme.ts, so there is no runtime import cycle.
 */
export const COPYBOOK_PRESET: ThemePreset = {
  id: "copybook",
  name: "Copybook",
  description:
    "Ink blue and pencil yellow on ruled paper white, a textbook slab serif, graph-paper blocks, highlighter headings, index-card tiles with Add always shown and listings that open as rows. Stationery, books and school supplies.",
  colors: { primary: "#1f3a93", accent: "#fdeaa0", background: "#fffdf6", foreground: "#141a33" },
  fontSans: "Lato",
  fontHeading: "Zilla Slab",
  radius: 0.5,
  mode: "light",
  theme: {
    header: "classic",
    headerStyle: "glass",
    sticky: "always",
    megaMenu: "columns",
    announcement: "dismissible",
    footer: "columns",
    hero: "compact",
    card: "framed",
    cardHover: "lift",
    cardButton: "always",
    imageRatio: "square",
    buttons: "rounded",
    density: "compact",
    sections: "tinted",
    motif: "grid",
    headings: "underline",
    productLayout: "thumbs-below",
    productDetails: "open",
    stickyBuy: "on",
    productTrust: "on",
    related: "rail",
    listingFilters: "top-bar",
    listingColumns: "5",
    listingView: "list",
    listingPaging: "infinite",
    categoryHeader: "simple",
    subcategories: "chips",
    compare: "on",
  },
};
