import { BUSINESS_TYPES, PACKS } from "@srirealtime/verticals";
import type { BusinessType } from "@srirealtime/verticals";

export type { BusinessType };
export const ALL_TRADES: readonly BusinessType[] = BUSINESS_TYPES;

/** The four groups used on /industries (same grouping as the product guide). */
export const TRADE_GROUPS: { key: string; ids: BusinessType[] }[] = [
  { key: "food", ids: ["grocery", "bakery", "fresh", "organic", "restaurant", "cloud_kitchen", "tea_stall"] },
  { key: "fashion", ids: ["fashion", "footwear", "jewellery", "cosmetics", "home_decor", "furniture", "florist_pooja", "crackers"] },
  { key: "health", ids: ["pharmacy", "optical", "salon", "spa", "gym"] },
  { key: "tools", ids: ["hardware", "electronics", "mobile_accessories", "repair", "stationery", "toys", "sports", "pet_shop", "tailoring", "school"] },
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
