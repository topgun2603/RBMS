import type { ThemePreset } from "./theme";

/**
 * Store #11 of the "20+ stores" series: Thiruvizha Crackers, Sivakasi (thiruvizha.localhost:3003), trade `crackers`.
 * A festive night-sky look, the only one in the series that reads like Deepavali night itself: a deep midnight-indigo
 * page (dark mode) lit by a firework-pink brand colour, a violet-indigo surface on boxed sections and a scatter of
 * star-dust dots on brand blocks; a wide, bold display face with energy (Unbounded) over a Tamil-ready body (Catamaran,
 * so Latin and Tamil share one rhythm). Structure: a split header (menu left, logo centred) that hides while you scroll
 * down, a plain rotating offer bar, overlay cards (name and price over the picture, like a lit box on a dark shelf)
 * that lift on hover with Add always visible, compact boxed sections, a full-width slider gallery on the product page
 * with accordion details, a "price list" listing that opens as rows (Sivakasi dealers sell from price lists) in three
 * columns with dropdown filters on top and infinite scroll, and compare on (gift boxes are compared by contents).
 * Chosen over a "temple gold on maroon" look (temple-gold, mithai and zari already own warm gold); this one is the
 * cool night sky with pink bursts. Registered in STORE_PRESETS (theme-presets-stores.ts); only a type import from
 * theme.ts, so there is no runtime import cycle.
 */
export const STARBURST_PRESET: ThemePreset = {
  id: "starburst",
  name: "Starburst",
  description:
    "Firework pink on a midnight-indigo night sky with star-dust dots, a wide energetic display face, a split header that hides on scroll, overlay cards that lift and a price-list listing in rows. Crackers, fireworks and festival stores.",
  colors: {
    primary: "#ff5fa8",
    accent: "#271c57",
    background: "#0c0a24",
    foreground: "#f6f1ff",
  },
  fontSans: "Catamaran",
  fontHeading: "Unbounded",
  radius: 1,
  mode: "dark",
  theme: {
    header: "split",
    headerStyle: "solid",
    sticky: "scroll-up",
    megaMenu: "images",
    announcement: "bar",
    footer: "centered",
    hero: "full",
    card: "overlay",
    cardHover: "lift",
    cardButton: "always",
    imageRatio: "square",
    buttons: "pill",
    density: "compact",
    sections: "boxed",
    motif: "dots",
    headings: "display",
    productLayout: "slider",
    productDetails: "accordion",
    stickyBuy: "on",
    productTrust: "on",
    related: "grid",
    listingFilters: "top-bar",
    listingColumns: "3",
    listingView: "list",
    listingPaging: "infinite",
    categoryHeader: "simple",
    subcategories: "chips",
    compare: "on",
  },
};
