import { BUSINESS_TYPES, isGeneralPack, PACKS } from "@rbms/verticals";
import type { BusinessType } from "@rbms/verticals";

export type { BusinessType };
/** Every trade with a pack of its own (the general catch-all packs are not a trade). */
export const ALL_TRADES: readonly BusinessType[] = BUSINESS_TYPES.filter((id) => !isGeneralPack(id));

/** The groups used on /industries (same grouping as the product guide). */
export const TRADE_GROUPS: { key: string; ids: BusinessType[] }[] = [
  { key: "food", ids: ["grocery", "bakery", "fresh", "organic", "restaurant", "cloud_kitchen", "tea_stall", "catering"] },
  { key: "fashion", ids: ["fashion", "footwear", "jewellery", "cosmetics", "home_decor", "furniture", "florist_pooja", "crackers", "textiles_wholesale"] },
  { key: "health", ids: ["pharmacy", "optical", "salon", "spa", "gym"] },
  { key: "tools", ids: ["hardware", "electronics", "mobile_accessories", "repair", "stationery", "toys", "sports", "pet_shop", "tailoring", "paints", "electricals", "tiles_sanitary", "print_shop", "agri_inputs", "auto_parts"] },
  { key: "services", ids: ["pet_grooming", "photo_studio", "laundry", "event_decor", "ac_service", "two_wheeler_service", "car_service"] },
  { key: "classes", ids: ["school", "tuition", "dance_music", "yoga", "driving_school"] },
];

/** Featured on the home page as full cards; the rest become name chips. */
export const HOME_TRADES: BusinessType[] = ["grocery", "pharmacy", "restaurant", "tea_stall", "bakery", "fashion", "footwear", "jewellery", "electronics", "repair", "hardware", "stationery", "cosmetics", "salon", "tailoring", "gym"];

export const tradeName = (id: BusinessType, locale: string) => (locale === "ta" ? PACKS[id].nameTa : PACKS[id].name);

/** Demo shops that exist in the seed data (apps/api/src/demo-stores), by trade. */
export const DEMO_SLUG: Partial<Record<BusinessType, string>> = {
  fashion: "arasan",
  restaurant: "arusuvai",
  cosmetics: "azhagu",
  fresh: "cauvery",
  stationery: "ezhuthaani",
  mobile_accessories: "kaipesi",
  home_decor: "kalaiyagam",
  sports: "maidhanam",
  florist_pooja: "malligai",
  furniture: "maram",
  hardware: "murugan",
  footwear: "padham",
  toys: "pambaram",
  bakery: "porunai",
  repair: "quickfix",
  pet_shop: "sellam",
  spa: "sukham",
  electronics: "techzone",
  tailoring: "thaiyal",
  tea_stall: "theneer",
  school: "thamarai",
  crackers: "thiruvizha",
  pharmacy: "thunai",
};
