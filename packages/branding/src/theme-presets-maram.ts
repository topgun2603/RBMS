import type { ThemePreset } from "./theme";

/**
 * Store #14 of the "20+ stores" series: Maram Furniture & Woodworks, Coimbatore (maram.localhost:3003), trade
 * `furniture`. A furniture-showroom look: a walnut-and-linen gallery with an architect's drawing sheet behind it.
 * Walnut brown (primary: the bar, buttons and links, the colour of polished teak and rosewood), a sage-tinted linen
 * (accent: tinted cards, price chips) on a warm stone-white page with charcoal ink. Chosen over a terracotta or deep
 * green primary because the series already holds the greens (crisp-greens, earthen, farm-market, pharma-clean) and the
 * burnt oranges (madras-cafe, patisserie, fixit-pro); no other preset is a wood brown, so the colour itself reads as
 * timber. Against the nearby "warm" looks it changes the structure, not just the tint: unlike boutique and heritage
 * (portrait fashion cards), earthen (sidebar, kolam) and zari (magazine silk) it is a landscape-first showroom:
 * a slim minimal bar with the menu in a drawer and a glass finish, an image mega menu of rooms, editorial cards with a
 * second photo on hover and no Add button (nobody adds a sofa to the cart from a tile), landscape 4:3 pictures three
 * to a row (with the magazine feature tile every sixth; two columns made that tile a full-width poster), square
 * buttons, generous spacing, the drafting-sheet `grid` motif, a product page whose pictures sit in two columns while the details stay open beside them, compare on (sofas and mattresses are compared),
 * a filter drawer, banner category headers and a newsletter footer. Type: Cinzel, inscriptional Roman capitals
 * (carved lettering on a lintel, an architectural serif), over Jost, a geometric Bauhaus sans; Tamil falls back to
 * Noto Sans Tamil. Page layout: magazine with the bottom tab bar on phones, a combination no other store uses (Thari
 * is magazine without tabs): numbered room chapters on the home, feature tiles in the grids, and the Categories sheet
 * of rooms one tap away on a phone. Registered in STORE_PRESETS (theme-presets-stores.ts); only a type import from
 * theme.ts.
 */
export const WALNUT_LINEN_PRESET: ThemePreset = {
  id: "walnut-linen",
  name: "Walnut & Linen",
  description:
    "Walnut brown and sage-tinted linen on a stone-white page, Cinzel capitals over Jost, landscape editorial cards three to a row, a drafting-grid motif, a minimal glass bar and a gallery product page. Furniture showrooms, woodworks and interiors.",
  colors: { primary: "#5a3825", accent: "#e2e5d8", background: "#f7f4ee", foreground: "#1c1813" },
  fontSans: "Jost",
  fontHeading: "Cinzel",
  radius: 0,
  mode: "light",
  theme: {
    header: "minimal",
    headerStyle: "glass",
    sticky: "scroll-up",
    megaMenu: "images",
    announcement: "dismissible",
    footer: "newsletter",
    hero: "split",
    card: "editorial",
    cardHover: "swap",
    cardButton: "none",
    imageRatio: "landscape",
    buttons: "square",
    density: "comfortable",
    sections: "plain",
    motif: "grid",
    headings: "display",
    productLayout: "grid",
    productDetails: "open",
    stickyBuy: "on",
    productTrust: "on",
    related: "rail",
    listingFilters: "drawer",
    listingColumns: "3",
    listingView: "grid",
    listingPaging: "load-more",
    categoryHeader: "banner",
    subcategories: "chips",
    compare: "on",
    // Page layout: editorial chapters (numbered section headings, feature tiles) with an app-like tab bar on phones,
    // whose Categories sheet is the showroom's rooms.
    pageLayout: "magazine",
    mobileNav: "tabs",
  },
};
