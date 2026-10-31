import type { ThemePreset } from "./theme";

/**
 * The look of Thamarai Vidyalaya Matriculation Higher Secondary School (thamarai.localhost:3003), trade `school`, app
 * SV: a temple-town private school website. An ivory page, deep lotus maroon for buttons and links, a pale lotus-pink
 * accent, Playfair Display headings over Hind Madurai (a humanist sans whose Tamil matches its Latin), a solid centred
 * bar that hides while scrolling down, a full-bleed hero, boxed cards without an Add button (programmes and news are
 * read, not carried home), the kolam motif on brand blocks, pill buttons, plain sections, an open one-scroll detail
 * page, top-bar filters and a link-column footer. Why not campus-navy (the trade's own look: navy, Baskerville, split
 * hero, framed cards, tinted sections, a left-aligned classic bar): this one is warm, centred and ceremonial.
 */
export const THAMARAI_LOTUS_PRESET: ThemePreset = {
  id: "thamarai-lotus",
  name: "Thamarai Lotus",
  description:
    "Ivory page with deep lotus-maroon buttons and a pale lotus-pink accent, Playfair Display headings over Hind Madurai, a centred solid bar, a full-bleed hero, boxed programme cards without Add buttons and kolam-patterned brand blocks. Schools, colleges and institutes that want a warm, traditional look.",
  colors: { primary: "#7a1f3d", accent: "#f8e1e6", background: "#fdf9f1", foreground: "#2b1319" },
  fontSans: "Hind Madurai",
  fontHeading: "Playfair Display",
  radius: 0.75,
  mode: "light",
  theme: {
    header: "centered",
    headerStyle: "solid",
    sticky: "scroll-up",
    megaMenu: "off",
    announcement: "ticker",
    footer: "columns",
    hero: "full",
    card: "boxed",
    cardHover: "lift",
    cardButton: "none",
    imageRatio: "landscape",
    buttons: "pill",
    density: "comfortable",
    sections: "plain",
    motif: "kolam",
    headings: "display",
    productLayout: "grid",
    productDetails: "open",
    stickyBuy: "off",
    productTrust: "off",
    related: "grid",
    listingFilters: "top-bar",
    listingColumns: "3",
    listingView: "grid",
    listingPaging: "pages",
    categoryHeader: "banner",
    subcategories: "chips",
    compare: "off",
    pageLayout: "standard",
    mobileNav: "off",
  },
};
