import type { ThemePreset } from "./theme";
import { MITHAI_PRESET } from "./theme-presets-porunai";
import { EARTHEN_PRESET } from "./theme-presets-vayal";
import { CRISP_GREENS } from "./theme-presets-cauvery";
import { ZARI_PRESET } from "./theme-presets-thari";
import { TAILORED_PRESET } from "./theme-presets-arasan";
import { BERRY_BOLD_PRESET } from "./theme-presets-azhagu";
import { COPYBOOK_PRESET } from "./theme-presets-ezhuthaani";
import { STRIDE_PRESET } from "./theme-presets-padham";
import { TOYBOX_PRESET } from "./theme-presets-pambaram";
import { STARBURST_PRESET } from "./theme-presets-thiruvizha";
import { KUMKUM_MANJAL_PRESET } from "./theme-presets-malligai";
import { CARBON_SPEC_PRESET } from "./theme-presets-kaipesi";
import { WALNUT_LINEN_PRESET } from "./theme-presets-maram";
import { POLISHED_BRASS_PRESET } from "./theme-presets-kalaiyagam";
import { LAGOON_PAWS_PRESET } from "./theme-presets-sellam";
import { TURF_CHALK_PRESET } from "./theme-presets-maidhanam";
import { NIGHT_KITCHEN_PRESET } from "./theme-presets-vaasam";
import { REPAIR_BENCH_PRESET } from "./theme-presets-quickfix";
import { BIG_BOX_PRESET } from "./theme-presets-techzone";
import { SIGNBOARD_PRESET } from "./theme-presets-theneer";
import { MADDER_THREAD_PRESET } from "./theme-presets-thaiyal";
import { LOTUS_MIST_PRESET } from "./theme-presets-spa";
import { SALINE_BLUE_PRESET } from "./theme-presets-thunai";
import { BANANA_LEAF_PRESET } from "./theme-presets-arusuvai";
import { CAMPUS_NAVY_PRESET } from "./theme-presets-school";
import { THAMARAI_LOTUS_PRESET } from "./theme-presets-thamarai";

/**
 * Store looks: one finished look per demo store in the "20+ stores" series (docs/verticals.md, "How to add a new store
 * look + demo shop"). Each one is a full preset like the trade presets (every colour, font and theme option set on
 * purpose) and must differ in structure, not just colour, from every other preset (theme-presets-stores.test.ts).
 * Owners pick them in Settings → Appearance like any other preset. Merged into THEME_PRESETS in theme.ts; only a type
 * import from theme.ts, so there is no runtime import cycle.
 */
export const STORE_PRESETS: ThemePreset[] = [
  {
    // Store #1: Murugan Hardwares (murugan.localhost:3003). A yard / site-office look: hi-vis yellow bar over
    // charcoal steel, condensed signage type, hazard-stripe brand blocks, spec tiles with compare.
    id: "industrial",
    name: "Industrial",
    description:
      "Hi-vis yellow on charcoal steel, condensed uppercase signage type, hazard-stripe blocks and framed spec tiles with compare. Hardware, tools and building materials.",
    colors: { primary: "#facc15", accent: "#262a30", background: "#121417", foreground: "#eef0f2" },
    fontSans: "Barlow",
    fontHeading: "Barlow Condensed",
    radius: 0,
    mode: "dark",
    theme: {
      header: "bold",
      headerStyle: "solid",
      sticky: "always",
      megaMenu: "columns",
      announcement: "ticker",
      footer: "columns",
      hero: "full",
      card: "framed",
      cardHover: "zoom",
      cardButton: "always",
      imageRatio: "square",
      buttons: "square",
      density: "compact",
      sections: "plain",
      motif: "stripes",
      headings: "uppercase",
      productLayout: "thumbs-side",
      productDetails: "tabs",
      stickyBuy: "on",
      productTrust: "on",
      related: "grid",
      listingFilters: "sidebar",
      listingColumns: "4",
      listingView: "grid",
      listingPaging: "load-more",
      categoryHeader: "banner",
      subcategories: "chips",
      compare: "on",
      // Page layout: the departments as a sticky rail beside every page (a chip strip on phones) and an app-like
      // bottom tab bar for site supervisors re-ordering from their phones.
      pageLayout: "rail",
      mobileNav: "tabs",
    },
  },
  // Store #2: Porunai Sweets & Bakery (theme-presets-porunai.ts).
  MITHAI_PRESET,
  EARTHEN_PRESET, // Store #4: Vayal Organics, Erode (theme-presets-vayal.ts).
  CRISP_GREENS, // Store #3: Cauvery Fresh Market, Trichy (theme-presets-cauvery.ts).
  ZARI_PRESET, // Store #5: Thari Silks, Kanchipuram (theme-presets-thari.ts).
  TAILORED_PRESET, // Store #6: Arasan Menswear, Coimbatore (theme-presets-arasan.ts).
  BERRY_BOLD_PRESET, // Store #10: Azhagu Beauty, Coimbatore (theme-presets-azhagu.ts).
  COPYBOOK_PRESET, // Store #8: Ezhuthaani Books & Stationery, Tirunelveli (theme-presets-ezhuthaani.ts).
  STRIDE_PRESET, // Store #7: Padham Footwear, Vellore (theme-presets-padham.ts).
  TOYBOX_PRESET, // Store #9: Pambaram Toys & Games, Salem (theme-presets-pambaram.ts).
  STARBURST_PRESET, // Store #11: Thiruvizha Crackers, Sivakasi (theme-presets-thiruvizha.ts).
  KUMKUM_MANJAL_PRESET, // Store #12: Malligai Flowers & Pooja Stores, Madurai (theme-presets-malligai.ts).
  CARBON_SPEC_PRESET, // Store #13: Kaipesi Mobile Accessories, Chennai (theme-presets-kaipesi.ts).
  WALNUT_LINEN_PRESET, // Store #14: Maram Furniture & Woodworks, Coimbatore (theme-presets-maram.ts).
  POLISHED_BRASS_PRESET, // Store #15: Kalaiyagam Décor & Gifts, Kumbakonam (theme-presets-kalaiyagam.ts).
  LAGOON_PAWS_PRESET, // Store #16: Sellam Pet Store, Anna Nagar, Chennai (theme-presets-sellam.ts).
  TURF_CHALK_PRESET, // Store #17: Maidhanam Sports, Triplicane, Chennai (theme-presets-maidhanam.ts).
  NIGHT_KITCHEN_PRESET, // Store #18: Vaasam Biryani Kitchen, OMR, Chennai (theme-presets-vaasam.ts).
  REPAIR_BENCH_PRESET, // QuickFix Mobile Care, Coimbatore (theme-presets-quickfix.ts).
  BIG_BOX_PRESET, // TechZone Mobiles, Coimbatore (theme-presets-techzone.ts).
  SIGNBOARD_PRESET, // Store #19: Theneer Kadai, Mylapore, Chennai (theme-presets-theneer.ts).
  MADDER_THREAD_PRESET, // Store #20: Thaiyal Tailors & Boutique, Madurai (theme-presets-thaiyal.ts).
  LOTUS_MIST_PRESET, // Store #21: Sukham Ayur Spa, R.S. Puram, Coimbatore (theme-presets-spa.ts).
  SALINE_BLUE_PRESET, // Store #22: Thunai Pharmacy & Wellness, Fairlands, Salem (theme-presets-thunai.ts).
  BANANA_LEAF_PRESET, // Arusuvai Unavagam, KK Nagar, Madurai (theme-presets-arusuvai.ts).
  CAMPUS_NAVY_PRESET, // The `school` trade: a school website (theme-presets-school.ts).
  THAMARAI_LOTUS_PRESET, // Thamarai Vidyalaya, the demo school (theme-presets-thamarai.ts).
];
