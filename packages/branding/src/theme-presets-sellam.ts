import type { ThemePreset } from "./theme";

/**
 * Store #16 of the "20+ stores" series: Sellam Pet Store, Anna Nagar, Chennai (sellam.localhost:3003), trade
 * `pet_shop`. A friendly, clean "pet clinic meets play-pen" look: deep lagoon teal (the colour of a fresh water bowl and
 * a groomer's apron) with soft coral surfaces on a warm cream page, so it reads as clean and caring first and playful
 * second. Chosen over a sunny-orange look because orange already belongs to bistro / fixit-pro (#c2410c), madras-cafe,
 * workshop and street-bold, and over a brighter cyan because care (#0e7490, cyan on ice blue) and gadget-neon hold
 * that end; zari's teal (#0b4a4f) is a near-black bottle green on ivory with square editorial cards and Bodoni, a
 * silk-saree look. Kept well away from toybox (crayon red / sky blue on white, boxed square tiles, polka dots),
 * crisp-greens (grocery green, slider, boxed sections) and berry-bold (berry on blush, Syne uppercase).
 * The structure is a calm, friendly shop for pet parents: a split header (menu left, logo centred, icons right) in
 * a solid bar that stays on top, category pictures in the mega menu (dogs, cats, birds, fish), a dismissible
 * offer ribbon, the newsletter-band footer ("monthly food refill" reminders), split banners, plain picture-over-text
 * cards in landscape 4:3 (a dog on a lawn, a cat on a sofa: pet photos are wide, not packshots), a soft lift on hover
 * with the Add button sliding up, pill buttons, comfortable spacing, sections on alternating coral tints with a "waves"
 * motif (water bowls and fish tanks), large display headings, thumbnails below the product picture with an accordion of
 * details (feeding guide, ingredients, shelf life), a grid of related items, a Filters drawer over four columns
 * with numbered pages, a picture banner on category pages, sub-category chips and no compare.
 * Page layout: standard (full-width pages, header on top) with the app-like bottom tab bar on phones: pet food is a
 * monthly refill bought on the phone (Home, Categories, Search, Cart, Account one thumb away). Every page-layout
 * combination was already taken when this store was built (standard + off by kalaiyagam, store #15); standard + tabs
 * is shared only with cauvery (crisp-greens), which differs from this look in 15 of 28 options. Type: Quicksand (rounded,
 * friendly, clean at 700) for headings over Plus Jakarta Sans for body text. Registered in STORE_PRESETS
 * (theme-presets-stores.ts); only a type import from theme.ts.
 */
export const LAGOON_PAWS_PRESET: ThemePreset = {
  id: "lagoon-paws",
  name: "Lagoon Paws",
  description:
    "Lagoon teal and soft coral on warm cream, rounded Quicksand headings, a split header, landscape pet-photo cards that lift, coral-tinted wave sections, an accordion product page and a Filters drawer. Pet shops, vets' counters and grooming studios.",
  colors: { primary: "#0b6b66", accent: "#ffe0d4", background: "#fffaf2", foreground: "#14302e" },
  fontSans: "Plus Jakarta Sans",
  fontHeading: "Quicksand",
  radius: 1,
  mode: "light",
  theme: {
    header: "split",
    headerStyle: "solid",
    sticky: "always",
    megaMenu: "images",
    announcement: "dismissible",
    footer: "newsletter",
    hero: "split",
    card: "standard",
    cardHover: "lift",
    cardButton: "hover",
    imageRatio: "landscape",
    buttons: "pill",
    density: "comfortable",
    sections: "tinted",
    motif: "waves",
    headings: "display",
    productLayout: "thumbs-below",
    productDetails: "accordion",
    stickyBuy: "on",
    productTrust: "on",
    related: "grid",
    listingFilters: "drawer",
    listingColumns: "4",
    listingView: "grid",
    listingPaging: "pages",
    categoryHeader: "banner",
    subcategories: "chips",
    compare: "off",
    // Page layout: standard pages and a bottom tab bar on phones (food refills are re-ordered from the phone).
    pageLayout: "standard",
    mobileNav: "tabs",
  },
};
