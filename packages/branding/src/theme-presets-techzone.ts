import type { ThemePreset } from "./theme";

/**
 * TechZone Mobiles, Cross Cut Road, Coimbatore (techzone.localhost:3003), trade `electronics`. A big-box electronics
 * retailer look, the opposite of the dark electronics looks (`tech` blue on navy, `gadget-neon` cyan on midnight,
 * Kaipesi's `carbon-spec` acid lime on carbon): shoppers compare prices and specs for a TV or an AC in daylight, so the
 * page is a light warm grey with deep fuchsia (the shop's sale-tag colour) as the one brand colour, a mint tint, and a
 * bold brand-coloured header bar. Fuchsia is a primary no other preset uses; QuickFix's `repair-bench` (violet on lavender,
 * rail, split header, drawer filters) is the nearest neighbour, so this look differs in almost every structural option.
 * The header is bold and hides on scroll down, over a mega menu with department pictures and a fixed offer bar; the
 * home banner is a slider; product tiles are minimal (no frame) square pictures that zoom, with Add on hover; buttons are
 * rounded, sections plain, headings in the display face; the product page is a full-width slider gallery with the specs in
 * tabs and a swipe rail of related products; a sidebar of filters beside a three-column listing numbered in pages; compare
 * is on (the point of an electronics shop). Page layout: the sidebar menu down the left on desktop (eleven departments
 * fit a menu better than a header; every page-layout combination is in use by now, and `sidebar` without phone tabs
 * is the one least like the other phone shops), the normal header on phones. Type: Space Grotesk headings over Catamaran, a
 * Tamil-ready body face. Registered in STORE_PRESETS (theme-presets-stores.ts); only a type import from theme.ts.
 */
export const BIG_BOX_PRESET: ThemePreset = {
  id: "big-box",
  name: "Big Box",
  description:
    "A bright big-box electronics look: warm grey page, deep fuchsia bar and buttons with a mint tint, a mega menu with department pictures, minimal zooming product tiles, a slider gallery with tabbed specs, a filter sidebar and compare on. Phones, TVs, appliances and gadgets.",
  colors: { primary: "#a21caf", accent: "#d5f5e8", background: "#f8f8f6", foreground: "#1b1224" },
  fontSans: "Catamaran",
  fontHeading: "Space Grotesk",
  radius: 0.375,
  mode: "light",
  theme: {
    header: "bold",
    headerStyle: "solid",
    sticky: "scroll-up",
    megaMenu: "images",
    announcement: "bar",
    footer: "centered",
    hero: "slider",
    card: "minimal",
    cardHover: "zoom",
    cardButton: "hover",
    imageRatio: "square",
    buttons: "rounded",
    density: "comfortable",
    sections: "plain",
    motif: "none",
    headings: "display",
    productLayout: "slider",
    productDetails: "tabs",
    stickyBuy: "on",
    productTrust: "on",
    related: "rail",
    listingFilters: "sidebar",
    listingColumns: "3",
    listingView: "grid",
    listingPaging: "pages",
    categoryHeader: "simple",
    subcategories: "chips",
    compare: "on",
    // Page layout: the departments as a fixed menu down the left on desktop, the normal header on phones.
    pageLayout: "sidebar",
    mobileNav: "off",
  },
};
