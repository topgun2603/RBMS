import type { ThemePreset } from "./theme";

/**
 * Store #12 of the "20+ stores" series: Malligai Flowers & Pooja Stores, Madurai (malligai.localhost:3003), trade
 * `florist_pooja`. A temple-street poo kadai look in the three colours of every archanai plate and gopuram tier:
 * kumkum vermilion (primary, the bar and buttons), manjal turmeric yellow (accent: price chips, tinted cards) and
 * malli jasmine white (the page). Chosen over a soft lotus-pink-and-leaf look because the series already has three pink
 * or berry looks (salon-blush, berry-bold, starburst) and three greens (crisp-greens, earthen, farm-market), and over a
 * maroon-and-gold temple look because porunai's `mithai` (maroon/saffron) and the trade's `temple-gold` (dark maroon)
 * hold that ground. Unlike kirana-fresh (red over pale cream, 5 tight columns) the yellow here is a saturated turmeric
 * used as a surface, not a tint, and the structure is a rate-board one: a split header with the logo in the middle (the
 * gopuram over the street), no mega menu, a fixed "today's rates" bar, sections as boxed cards on the jasmine page,
 * framed square tiles that lift with the Add button always there (jasmine is bought in a hurry before the temple), a
 * list-first listing in three columns like a written rate list, a full-width product slider and tabbed details, no
 * trust badges (flowers can't be returned), and a centred footer. The page layout is the category rail without bottom
 * tabs (a combination no other store uses), so Loose flowers / Strings / Garlands sit beside every page like the
 * counters of the shop. Type: Arima, a Tamil-and-Latin display face with a hand-lettered warmth (temple signboards), over Mukta Malar, so English and Tamil headings come from one family.
 * Registered in STORE_PRESETS (theme-presets-stores.ts); only a type import from theme.ts.
 */
export const KUMKUM_MANJAL_PRESET: ThemePreset = {
  id: "kumkum-manjal",
  name: "Kumkum & Manjal",
  description:
    "Kumkum vermilion and turmeric yellow on jasmine white, a split header with the logo in the middle, boxed sections, framed square tiles with the Add button always on and a list-first rate-list listing. Flower shops, pooja stores and temple-street counters.",
  colors: { primary: "#a3201a", accent: "#f7cd4b", background: "#fffdf7", foreground: "#2a1410" },
  fontSans: "Mukta Malar",
  fontHeading: "Arima",
  radius: 0.5,
  mode: "light",
  theme: {
    header: "split",
    headerStyle: "solid",
    sticky: "scroll-up",
    megaMenu: "off",
    announcement: "bar",
    footer: "centered",
    hero: "compact",
    card: "framed",
    cardHover: "lift",
    cardButton: "always",
    imageRatio: "square",
    buttons: "rounded",
    density: "compact",
    sections: "boxed",
    motif: "kolam",
    headings: "underline",
    productLayout: "slider",
    productDetails: "tabs",
    stickyBuy: "on",
    productTrust: "off",
    related: "grid",
    listingFilters: "top-bar",
    listingColumns: "3",
    listingView: "list",
    listingPaging: "pages",
    categoryHeader: "simple",
    subcategories: "chips",
    compare: "off",
    // Page layout: a sticky category rail like the shop's counters (a chip strip of counters on phones), no tab bar.
    pageLayout: "rail",
    mobileNav: "off",
  },
};
