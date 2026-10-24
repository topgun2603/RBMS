import type { ThemePreset } from "./theme";

/**
 * Store #13 of the "20+ stores" series: Kaipesi Mobile Accessories, Ritchie Street, Chennai (kaipesi.localhost:3003),
 * trade `mobile_accessories`. A spec-sheet look: matte carbon black with one acid-lime accent, like the backlit price
 * tags and the green "tested OK" stickers on a Ritchie Street counter, set in a monospaced heading face so wattages,
 * capacities and model sizes line up like a data sheet. Chosen over an electric-cyan look because the trade's own
 * `gadget-neon` (cyan on midnight navy, rounded, comfortable) and `tech` (blue on navy, glass header) hold the blue end
 * of dark electronics, and over a cobalt look because padham's `stride` is cobalt; acid lime on near-neutral carbon is
 * a colour no preset uses (industrial's hi-vis yellow sits on blue-grey steel, with a bold yellow bar and hazard
 * stripes). The structure is a dense catalogue: a solid classic header that hides on scroll, no mega menu (the
 * category rail does that job), a slim fixed offer bar, a compact banner, boxed tiles (picture edge to edge, filled
 * card) with no hover tricks and the Add button always on, square pictures, square buttons, compact density, plain
 * sections with a PCB "dots" motif, uppercase tracked headings, a two-column picture grid on the product page with the
 * details all open (a spec sheet, not tabs), a swipe rail of related items, a top filter bar over a list-first
 * five-column listing that loads as you scroll, no sub-category chips and compare on (chargers and power banks are
 * bought by comparing numbers). Page layout: the category rail beside every page (a chip strip on phones) and the
 * app-like bottom tab bar: accessory shoppers are on their phones, re-ordering a cable or a guard.
 * Type: JetBrains Mono for headings (monospaced spec labels: "65 W", "20000 mAh", "6.7-inch") over Archivo, a
 * grotesque that stays compact in dense cards. Registered in STORE_PRESETS (theme-presets-stores.ts); only a type
 * import from theme.ts.
 */
export const CARBON_SPEC_PRESET: ThemePreset = {
  id: "carbon-spec",
  name: "Carbon Spec",
  description:
    "Matte carbon black with a single acid-lime accent, monospaced spec headings, boxed square tiles with Add always on, an open spec-sheet product page and a list-first five-column listing. Mobile accessories, gadgets and spare parts.",
  colors: { primary: "#b5f23d", accent: "#1b1f1c", background: "#0d0f0e", foreground: "#e9ede6" },
  fontSans: "Archivo",
  fontHeading: "JetBrains Mono",
  radius: 0.125,
  mode: "dark",
  theme: {
    header: "classic",
    headerStyle: "solid",
    sticky: "scroll-up",
    megaMenu: "off",
    announcement: "bar",
    footer: "centered",
    hero: "compact",
    card: "boxed",
    cardHover: "none",
    cardButton: "always",
    imageRatio: "square",
    buttons: "square",
    density: "compact",
    sections: "plain",
    motif: "dots",
    headings: "uppercase",
    productLayout: "grid",
    productDetails: "open",
    stickyBuy: "on",
    productTrust: "on",
    related: "rail",
    listingFilters: "top-bar",
    listingColumns: "5",
    listingView: "list",
    listingPaging: "infinite",
    categoryHeader: "simple",
    subcategories: "off",
    compare: "on",
    // Page layout: the categories as a sticky rail (a chip strip on phones) and a bottom tab bar for phone shoppers.
    pageLayout: "rail",
    mobileNav: "tabs",
  },
};
