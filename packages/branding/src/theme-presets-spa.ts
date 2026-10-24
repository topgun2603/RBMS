import type { ThemePreset } from "./theme";

/**
 * Store #21 of the "20+ stores" series: Sukham Ayur Spa, a spa and wellness centre in R.S. Puram, Coimbatore
 * (sukham.localhost:3003), trade `spa`, app SV. A calm look for a place people go to slow down: a warm linen page,
 * twilight-lotus indigo for buttons and links (a dusk-lavender no other preset uses), a sage-mist accent, light
 * Cormorant Garamond headings over Mukta Malar (whose Tamil matches its Latin), a slim frosted bar that hides while
 * scrolling down, the menu in a drawer, a full-bleed hero, large editorial treatment cards with no Add button (a
 * treatment is booked, not carried home), pill buttons, generous spacing, plain sections, a slider product page with
 * everything open on one scroll, top-bar filters, numbered pages, and a centred footer. Standard page layout and no
 * bottom tab bar: a spa guest visits once a fortnight, not every day. Why this and not luxe (the trade's default, gold on
 * ivory), salon-blush (rose) or the earthen look (Vayal, olive and clay): those are warm and decorated; this one is cool,
 * quiet and spacious.
 */
export const LOTUS_MIST_PRESET: ThemePreset = {
  id: "lotus-mist",
  name: "Lotus Mist",
  description:
    "Warm linen page with twilight-lotus indigo buttons and sage-mist accents, light Cormorant Garamond headings, a frosted slim bar, a full-bleed hero, large editorial treatment cards and a one-scroll product page. Spas, wellness centres, ayurveda clinics and massage studios.",
  colors: { primary: "#504d7d", accent: "#e8ecdf", background: "#f8f6f1", foreground: "#25233a" },
  fontSans: "Mukta Malar",
  fontHeading: "Cormorant Garamond",
  radius: 1,
  mode: "light",
  theme: {
    header: "minimal",
    headerStyle: "glass",
    sticky: "scroll-up",
    megaMenu: "off",
    announcement: "dismissible",
    footer: "centered",
    hero: "full",
    card: "editorial",
    cardHover: "zoom",
    cardButton: "none",
    imageRatio: "landscape",
    buttons: "pill",
    density: "comfortable",
    sections: "plain",
    motif: "waves",
    headings: "display",
    productLayout: "slider",
    productDetails: "open",
    stickyBuy: "on",
    productTrust: "off",
    related: "rail",
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
