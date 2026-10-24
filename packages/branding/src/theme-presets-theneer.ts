import type { ThemePreset } from "./theme";

/**
 * Store #19 of the "20+ stores" series: Theneer Kadai, a tea stall and juice bar on a Mylapore street corner, Chennai
 * (theneer.localhost:3003), trade `tea_stall`. A painted-signboard look: enamel-board teal over a warm paper page with a
 * marigold-yellow accent (the lettering on a tea-kadai shutter), rounded Rubik headings over Mukta Malar (whose Tamil
 * matches its Latin), a slim solid bar with the menu in a drawer, a scrolling ticker for the daily offers, a dotted
 * motif like the steam and sugar-crystal dots on a glass, filled boxed tiles with an always-visible Add (a counter
 * order is one tap), pill buttons, compact spacing, tinted sections, and a centred footer with address and timings.
 * Why this and not another café brown: madras-cafe (the trade's default) is a cream-and-brown filter-coffee house and
 * bistro a terracotta dining room; a street counter that serves a hundred glasses an hour is bright, loud and
 * quick to read, so it gets teal and marigold, tinted bands, a list view on phones' menu and a bottom tab bar.
 * Page layout: rail + tabs (a category rail beside the menu on desktop, a chip strip on phones, and the bottom tab
 * bar for people ordering from the queue).
 * Registered in STORE_PRESETS (theme-presets-stores.ts); only a type import from theme.ts.
 */
export const SIGNBOARD_PRESET: ThemePreset = {
  id: "signboard",
  name: "Signboard",
  description:
    "Enamel-board teal and marigold on warm paper, Rubik over Mukta Malar, dotted steam motif, filled boxed tiles with an always-on Add, pill buttons, tinted compact sections and a ticker. Tea stalls, juice bars, snack counters and street-food shops.",
  colors: { primary: "#077886", accent: "#ffd23f", background: "#fff8e7", foreground: "#12262c" },
  fontSans: "Mukta Malar",
  fontHeading: "Rubik",
  radius: 1,
  mode: "light",
  theme: {
    header: "minimal",
    headerStyle: "solid",
    sticky: "always",
    megaMenu: "off",
    announcement: "ticker",
    footer: "centered",
    hero: "compact",
    card: "boxed",
    cardHover: "lift",
    cardButton: "always",
    imageRatio: "square",
    buttons: "pill",
    density: "compact",
    sections: "tinted",
    motif: "dots",
    headings: "display",
    productLayout: "thumbs-below",
    productDetails: "accordion",
    stickyBuy: "on",
    productTrust: "off",
    related: "rail",
    listingFilters: "top-bar",
    listingColumns: "4",
    listingView: "grid",
    listingPaging: "load-more",
    categoryHeader: "simple",
    subcategories: "chips",
    compare: "off",
    pageLayout: "rail",
    mobileNav: "tabs",
  },
};
