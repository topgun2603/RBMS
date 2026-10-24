import type { ThemePreset } from "./theme";

/**
 * Store #20 of the "20+ stores" series: Thaiyal Tailors & Boutique, a family tailoring shop in Madurai
 * (thaiyal.localhost:3003), trade `tailoring`, app SV. An atelier look worked like handwork rather than the trade's
 * default: tailor-atelier ("Linen & Thread") is a denim-slate, bookish Baskerville page of portrait fittings, and
 * zari (Thari's silk saree house) is a deep-teal magazine. Thaiyal is a warm madder-rose (the red thread of a
 * hand-stitched blouse) on a parchment page the colour of pattern paper, with a chalk-peach accent, Fraunces headings
 * over Mukta Malar (whose Tamil matches its Latin), a centred glass header over a mega menu of garment pictures, a
 * full-bleed hero, bordered "pattern card" tiles with a second photo on hover (a blouse front, then its back),
 * portrait pictures, rounded buttons, sections boxed in cards, a faint pattern-grid motif, a gallery-grid product page
 * with tabbed details, a top filter bar and endless scrolling, and a centred footer (the Tamil newsletter heading of the band footer broke mid-word).
 * Page layout: sidebar + tabs (the menu down the left on desktop like a pattern book's index, the bottom tab bar on
 * phones for customers who check a job and book a fitting from the phone). Only Porunai used this pair before.
 * Registered in STORE_PRESETS (theme-presets-stores.ts); only a type import from theme.ts.
 */
export const MADDER_THREAD_PRESET: ThemePreset = {
  id: "madder-thread",
  name: "Madder & Thread",
  description:
    "Madder-rose on parchment pattern paper with a chalk-peach accent, Fraunces over Mukta Malar, a centred glass header with a picture mega menu, bordered portrait pattern cards that swap to a second photo, boxed sections and a pattern-grid motif. Tailors, boutiques, embroidery and alteration shops.",
  colors: { primary: "#7d2a3f", accent: "#efdccb", background: "#faf5ec", foreground: "#2a2220" },
  fontSans: "Mukta Malar",
  fontHeading: "Fraunces",
  radius: 0.5,
  mode: "light",
  theme: {
    header: "centered",
    headerStyle: "glass",
    sticky: "scroll-up",
    megaMenu: "images",
    announcement: "bar",
    footer: "centered",
    hero: "full",
    card: "framed",
    cardHover: "swap",
    cardButton: "hover",
    imageRatio: "portrait",
    buttons: "rounded",
    density: "comfortable",
    sections: "boxed",
    motif: "grid",
    headings: "display",
    productLayout: "grid",
    productDetails: "tabs",
    stickyBuy: "on",
    productTrust: "off",
    related: "rail",
    listingFilters: "top-bar",
    listingColumns: "3",
    listingView: "grid",
    listingPaging: "infinite",
    categoryHeader: "banner",
    subcategories: "chips",
    compare: "off",
    pageLayout: "sidebar",
    mobileNav: "tabs",
  },
};
