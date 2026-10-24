import type { ThemePreset } from "./theme";

/**
 * Store #9 of the "20+ stores" series: Pambaram Toys & Games, Salem (pambaram.localhost:3003), trade `toys`. A
 * toy-box look in primary-colour pops: a clean white page with deep navy ink, crayon-red pill buttons and a sky-blue
 * tint surface, so red, blue and white read like a box of wooden blocks; polka dots on brand blocks; a rounded,
 * friendly display face (Fredoka) for headings over a soft, very legible body (Nunito), so it feels playful without
 * looking childish to the parents who buy. The structure is a shop for busy parents: a centred logo over the menu with
 * category pictures in the mega menu, a short banner hero that hands over to "Shop by age" at once, sections in
 * rounded cards, filled square tiles that lift with an always-visible Add button, quick top-bar filters (age, price)
 * with "load more", and an open product page with every picture in a grid and all details (age, safety marks,
 * batteries) shown without clicking. Registered in STORE_PRESETS (theme-presets-stores.ts); only a type import from
 * theme.ts, so there is no runtime import cycle.
 */
export const TOYBOX_PRESET: ThemePreset = {
  id: "toybox",
  name: "Toybox",
  description:
    "Crayon red, sky blue and navy on white, a rounded Fredoka display face, polka dots, rounded section cards, filled square tiles with an Add button, quick age and price filters and an open product page. Toy shops, gifts and kids' stores.",
  colors: { primary: "#c81e3a", accent: "#ddefff", background: "#ffffff", foreground: "#13214a" },
  fontSans: "Nunito",
  fontHeading: "Fredoka",
  radius: 1.25,
  mode: "light",
  theme: {
    header: "centered",
    headerStyle: "solid",
    sticky: "always",
    megaMenu: "images",
    announcement: "dismissible",
    footer: "newsletter",
    hero: "compact",
    card: "boxed",
    cardHover: "lift",
    cardButton: "always",
    imageRatio: "square",
    buttons: "pill",
    density: "comfortable",
    sections: "boxed",
    motif: "dots",
    headings: "underline",
    productLayout: "grid",
    productDetails: "open",
    stickyBuy: "on",
    productTrust: "on",
    related: "rail",
    listingFilters: "top-bar",
    listingColumns: "4",
    listingView: "grid",
    listingPaging: "load-more",
    categoryHeader: "simple",
    subcategories: "chips",
    compare: "off",
  },
};
