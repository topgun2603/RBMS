import type { ThemePreset } from "./theme";

/**
 * Store #17 of the "20+ stores" series: Maidhanam Sports, Bells Road, Triplicane, Chennai (maidhanam.localhost:3003),
 * trade `sports`. A day-match look: a turf-green bar over a chalk-white page, chalk lines everywhere (the `grid` motif
 * drawn like the creases and boundary of a net pitch, framed product tiles like a box on a scoresheet, an accent rule
 * under every heading like a freshly limed crease) and a scoreboard-amber accent for the panels and badges. Maidhanam
 * (மைதானம்) is Tamil for the ground; the shop sits two streets from Chepauk.
 * Why this and not a floodlit dark look: the five other athletic looks are all dark or neon (power: red on black;
 * gym-iron: red on oxblood; industrial: hi-vis yellow on charcoal; street-bold: amber on brown-black; stride: cobalt and
 * volt lime), so a sports store that reads as daylight cricket, chalk and grass, is the one look nobody has. The green
 * is a deep pitch green (#0d5c34), darker and bluer than the grocery greens (fresh, crisp-greens), and the page is
 * chalk white, not cream; the amber is kept to the accent panels so the primary stays green.
 * The structure is a scoreboard, not a gym poster: a brand-green bold bar that hides while scrolling down, a column
 * mega menu of sports and their sub-sections (bats, balls, pads…), a dismissible offer ribbon (match-day offers), a
 * newsletter-band footer (team-kit and season offers), a slider hero (one slide per sport), framed square tiles with
 * the full hover and Add on hover, square buttons, compact spacing, boxed sections, the chalk-line `grid` motif,
 * underlined headings, a full-width picture slider on the product page with the details all open (weight, grip,
 * willow grade in view, not behind tabs), a related grid, a Filters drawer over three columns with infinite scroll,
 * simple category headers, sub-category chips and compare on (bats and rackets are bought by comparing).
 * Type: Big Shoulders Display (a condensed stadium-signage face, like the numbers on a manual scoreboard) over
 * Catamaran, whose Tamil glyphs match its Latin, so Tamil pages keep one voice.
 * Page layout: magazine (the home reads like a printed match programme: numbered "01 —" section kickers, feature
 * tiles in the grids), no bottom tab bar. Every page-layout combination was taken when this store was built;
 * magazine + off is shared only with thari (store #5), which differs from this look in most options and has a
 * different home (magazine + tabs stays unique to walnut-linen).
 * Registered in STORE_PRESETS (theme-presets-stores.ts); only a type import from theme.ts.
 */
export const TURF_CHALK_PRESET: ThemePreset = {
  id: "turf-chalk",
  name: "Turf & Chalk",
  description:
    "Pitch green and scoreboard amber on chalk white, Big Shoulders Display over Catamaran, chalk-line grid motif, framed square tiles, square buttons, boxed compact sections and an open product page with compare. Sports shops, team-kit suppliers and academies.",
  colors: { primary: "#0d5c34", accent: "#ffe08a", background: "#f7f8f1", foreground: "#0b1d13" },
  fontSans: "Catamaran",
  fontHeading: "Big Shoulders Display",
  radius: 0.25,
  mode: "light",
  theme: {
    header: "bold",
    headerStyle: "solid",
    sticky: "scroll-up",
    megaMenu: "columns",
    announcement: "dismissible",
    footer: "newsletter",
    hero: "slider",
    card: "framed",
    cardHover: "rich",
    cardButton: "hover",
    imageRatio: "square",
    buttons: "square",
    density: "compact",
    sections: "boxed",
    motif: "grid",
    headings: "underline",
    productLayout: "slider",
    productDetails: "open",
    stickyBuy: "on",
    productTrust: "on",
    related: "grid",
    listingFilters: "drawer",
    listingColumns: "3",
    listingView: "grid",
    listingPaging: "infinite",
    categoryHeader: "simple",
    subcategories: "chips",
    compare: "on",
    // Page layout: a match programme (numbered section kickers, feature tiles); no bottom tab bar (all eight layout + nav combinations are taken, so this shares magazine + off with thari, which has a different look and home).
    pageLayout: "magazine",
    mobileNav: "off",
  },
};
