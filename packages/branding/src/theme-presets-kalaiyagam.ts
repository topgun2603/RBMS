import type { ThemePreset } from "./theme";

/**
 * Store #15 of the "20+ stores" series: Kalaiyagam Décor & Gifts, Big Street, Kumbakonam (kalaiyagam.localhost:3003),
 * trade `home_decor`. A lamp-lit gallery look: polished brass on a deep teal-black wall, with ivory type, the way a
 * Nachiarkoil lamp glows against the dark green-blue lime-plaster of a Chettinad hall. Chosen over a gallery-white
 * look with antique bronze because the series' newest store (maram, walnut-linen) already holds the warm brown on
 * stone-white; and the brass is set on teal, not on the plum-maroon of temple-gold or the warm black of luxe, the two
 * other gold-on-dark looks (whose ochre and old-gold primaries this brighter, greener brass also avoids). The
 * structure is a gallery wall, not a showroom or a boutique: a centred logo over the menu (a shop sign), a solid bar
 * that comes back on scrolling up, a column mega menu of crafts, a slow ticker of craft-town news, framed tiles (every
 * product hung in a thin brass frame) in portrait 4:5 (lamps, vases and dolls are tall) with the full hover (lift, zoom
 * and second photo) and Add on hover, rounded buttons, comfortable spacing, sections alternating on a teal tint, the
 * punched-brass `dots` motif, headings with an accent rule, thumbnails under the product picture, the details in an
 * accordion (care and craft notes), a related grid, sidebar filters over a three-column grid with numbered pages,
 * banner category headers and sub-category chips; no compare (nobody compares a Thanjavur painting by numbers). Type:
 * Alegreya (a calligraphic book serif, like the hand-lettered labels on a craft-shop shelf) over Hind Madurai, whose
 * Tamil glyphs match the Latin, so Tamil pages keep one voice. Page layout: standard without the tab bar: the home is
 * a single gallery to walk through, and gift shoppers come in from WhatsApp links rather than as daily repeat buyers.
 * Registered in STORE_PRESETS (theme-presets-stores.ts); only a type import from theme.ts.
 */
export const POLISHED_BRASS_PRESET: ThemePreset = {
  id: "polished-brass",
  name: "Polished Brass",
  description:
    "Polished brass and ivory on a deep teal-black wall, Alegreya over Hind Madurai, portrait tiles in thin brass frames, a centred shop sign, a craft-town ticker and teal-tinted sections. Home décor, brass, handicrafts and gifts.",
  colors: { primary: "#e2b04a", accent: "#15302f", background: "#0b1a1c", foreground: "#f4ecd8" },
  fontSans: "Hind Madurai",
  fontHeading: "Alegreya",
  radius: 0.375,
  mode: "dark",
  theme: {
    header: "centered",
    headerStyle: "solid",
    sticky: "scroll-up",
    megaMenu: "columns",
    announcement: "ticker",
    footer: "columns",
    hero: "split",
    card: "framed",
    cardHover: "rich",
    cardButton: "hover",
    imageRatio: "portrait",
    buttons: "rounded",
    density: "comfortable",
    sections: "tinted",
    motif: "dots",
    headings: "underline",
    productLayout: "thumbs-below",
    productDetails: "accordion",
    stickyBuy: "on",
    productTrust: "on",
    related: "grid",
    listingFilters: "sidebar",
    listingColumns: "3",
    listingView: "grid",
    listingPaging: "pages",
    categoryHeader: "banner",
    subcategories: "chips",
    compare: "off",
    // Page layout: the standard full-width pages (the home is one long gallery walk) and no bottom tab bar.
    pageLayout: "standard",
    mobileNav: "off",
  },
};
