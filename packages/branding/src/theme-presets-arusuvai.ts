import type { ThemePreset } from "./theme";

/**
 * The rebuilt restaurant demo shop of the series: Arusuvai Unavagam, KK Nagar, Madurai (arusuvai.localhost:3003), trade `restaurant`
 * on the restaurant app (RS): a full-service family restaurant with tables, QR ordering and a family hall (the rebuilt
 * demo shop that replaced the old `annapoorna`). A banana-leaf look: a pale leaf-green page (#f2f6e4) with pomegranate-red
 * (#9a1f4b) buttons and a leaf-green tint, a bold Tamil-friendly display face (Catamaran) over
 * Mukta Malar (Tamil-first, so the Tamil words read as well as the English), square-cornered buttons, a glass header that
 * hides on scroll-down, a full-width hero, editorial dish cards with the Add button on hover, landscape pictures, boxed
 * sections with a waves edge, underlined headings, side-thumbnail product pages in tabs, a filter sidebar and a
 * load-more menu, and the standard page with a phone tab bar (diners scan a table QR on the phone).
 * Why this and not another food look: bistro (burnt orange on cream), madras-cafe (terracotta, kolam, Baloo), night-kitchen
 * (neon orange on pine-black), signboard (teal on cream, Rubik) and crisp-greens (grocery green) are each a different
 * colour family and none combines a leaf-green page with a red button, a Catamaran face and editorial cards.
 * Page layout: standard + tabs (shared with crisp-greens and lagoon-paws; differs from each in most options).
 * Registered in STORE_PRESETS (theme-presets-stores.ts); only a type import from theme.ts.
 */
export const BANANA_LEAF_PRESET: ThemePreset = {
  id: "banana-leaf",
  name: "Banana Leaf",
  description:
    "Pomegranate red on a pale banana-leaf green page, Catamaran over Mukta Malar, a glass header, a full-width hero, editorial dish cards with Add on hover, boxed sections with a waves edge, underlined headings, a filter sidebar with load-more menu pages and a phone tab bar. Family restaurants, messes and unavagams with table ordering.",
  colors: { primary: "#9a1f4b", accent: "#e1ebc4", background: "#f2f6e4", foreground: "#1d2a14" },
  fontSans: "Mukta Malar",
  fontHeading: "Catamaran",
  radius: 0.25,
  mode: "light",
  theme: {
    header: "classic",
    headerStyle: "glass",
    sticky: "scroll-up",
    megaMenu: "columns",
    announcement: "dismissible",
    footer: "centered",
    hero: "full",
    card: "editorial",
    cardHover: "zoom",
    cardButton: "hover",
    imageRatio: "landscape",
    buttons: "square",
    density: "comfortable",
    sections: "boxed",
    motif: "waves",
    headings: "underline",
    productLayout: "thumbs-side",
    productDetails: "tabs",
    stickyBuy: "on",
    productTrust: "off",
    related: "grid",
    listingFilters: "sidebar",
    listingColumns: "3",
    listingView: "grid",
    listingPaging: "load-more",
    categoryHeader: "banner",
    subcategories: "chips",
    compare: "off",
    pageLayout: "standard",
    mobileNav: "tabs",
  },
};
