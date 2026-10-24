import type { ThemePreset } from "./theme";

/**
 * Store #18 of the "20+ stores" series: Vaasam Biryani Kitchen, Karapakkam, OMR, Chennai (vaasam.localhost:3003), trade
 * `cloud_kitchen` on the restaurant app (RS). A delivery-app look: a night-kitchen page (pine-black, #0f1613, not the
 * brown-black of street-bold) with a hot chilli-orange (#ff6a1a) brand bar, a ticker of the lunch-rush offer, framed
 * square dish tiles with an always-visible Add button, pill buttons, compact spacing, dotted brand blocks, rows instead
 * of a grid on listings (a menu you scan like a delivery app, with the filters in a bar above it), a category rail
 * beside the menu and a bottom tab bar on phones.
 * Why this and not another warm look: bistro (burnt orange on cream), madras-cafe (terracotta on cream with kolam),
 * annapoorna's trade look and street-bold (amber on brown-black) are all warm and either light or brown; this one is a
 * cool pine-black night page with a neon-bright orange, a chunky grotesque display face (Bricolage Grotesque, like an app's
 * wordmark) over Poppins, and an app structure (rail + tabs + list rows) none of them has.
 * Page layout: rail + tabs (three looks use it; this one differs from each in most options).
 * Registered in STORE_PRESETS (theme-presets-stores.ts); only a type import from theme.ts.
 */
export const NIGHT_KITCHEN_PRESET: ThemePreset = {
  id: "night-kitchen",
  name: "Night Kitchen",
  description:
    "Chilli orange on a pine-black night page, Bricolage Grotesque over Poppins, a brand-colour bar with a lunch-rush ticker, framed square dish tiles with Add always showing, pill buttons, compact rows on menu pages with a category rail and a phone tab bar. Cloud kitchens, biryani and meal-box delivery brands.",
  colors: { primary: "#ff6a1a", accent: "#27342d", background: "#0f1613", foreground: "#f3f6f1" },
  fontSans: "Poppins",
  fontHeading: "Bricolage Grotesque",
  radius: 0.75,
  mode: "dark",
  theme: {
    header: "bold",
    headerStyle: "solid",
    sticky: "always",
    megaMenu: "columns",
    announcement: "ticker",
    footer: "minimal",
    hero: "compact",
    card: "framed",
    cardHover: "rich",
    cardButton: "always",
    imageRatio: "square",
    buttons: "pill",
    density: "compact",
    sections: "tinted",
    motif: "dots",
    headings: "display",
    productLayout: "grid",
    productDetails: "open",
    stickyBuy: "on",
    productTrust: "on",
    related: "rail",
    listingFilters: "top-bar",
    listingColumns: "3",
    listingView: "list",
    listingPaging: "infinite",
    categoryHeader: "none",
    subcategories: "chips",
    compare: "off",
    pageLayout: "rail",
    mobileNav: "tabs",
  },
};
