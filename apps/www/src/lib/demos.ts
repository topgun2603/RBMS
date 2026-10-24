import type { AppId } from "./site";
import type { BusinessType } from "./trades";

/** Live demo storefronts (seeded in apps/api/src/demo-stores). Thumbnails: public/demos/<slug>.webp. */
export interface DemoStore {
  slug: string;
  name: string;
  trade: BusinessType;
}
export const DEMO_STORES: readonly DemoStore[] = [
  { slug: "arusuvai", name: "Arusuvai Unavagam", trade: "restaurant" },
  { slug: "vaasam", name: "Vaasam Biryani Kitchen", trade: "cloud_kitchen" },
  { slug: "theneer", name: "Theneer Kadai", trade: "tea_stall" },
  { slug: "porunai", name: "Porunai Sweets & Bakery", trade: "bakery" },
  { slug: "cauvery", name: "Cauvery Fresh Market", trade: "fresh" },
  { slug: "vayal", name: "Vayal Organics", trade: "organic" },
  { slug: "thunai", name: "Thunai Pharmacy & Wellness", trade: "pharmacy" },
  { slug: "arasan", name: "Arasan Menswear", trade: "fashion" },
  { slug: "thari", name: "Thari Silks", trade: "fashion" },
  { slug: "padham", name: "Padham Footwear", trade: "footwear" },
  { slug: "azhagu", name: "Azhagu Beauty", trade: "cosmetics" },
  { slug: "kalaiyagam", name: "Kalaiyagam Décor & Gifts", trade: "home_decor" },
  { slug: "maram", name: "Maram Furniture & Woodworks", trade: "furniture" },
  { slug: "malligai", name: "Malligai Flowers & Pooja Stores", trade: "florist_pooja" },
  { slug: "thiruvizha", name: "Thiruvizha Crackers", trade: "crackers" },
  { slug: "murugan", name: "Murugan Hardwares", trade: "hardware" },
  { slug: "techzone", name: "TechZone Mobiles", trade: "electronics" },
  { slug: "kaipesi", name: "Kaipesi Mobile Accessories", trade: "mobile_accessories" },
  { slug: "quickfix", name: "QuickFix Mobile Care", trade: "repair" },
  { slug: "ezhuthaani", name: "Ezhuthaani Books & Stationery", trade: "stationery" },
  { slug: "pambaram", name: "Pambaram Toys & Games", trade: "toys" },
  { slug: "maidhanam", name: "Maidhanam Sports", trade: "sports" },
  { slug: "sellam", name: "Sellam Pet Store", trade: "pet_shop" },
  { slug: "sukham", name: "Sukham Ayur Spa", trade: "spa" },
  { slug: "thaiyal", name: "Thaiyal Tailors & Boutique", trade: "tailoring" },
];

/** Shops with a 90-day trading history, opened read-only in their business app (API: DEMO_SHOPS, POST /v1/auth/demo). */
export interface DemoApp {
  slug: string;
  name: string;
  trade: BusinessType;
  app: AppId;
  /** Roughly how many bills the history holds (shown as "n+"). */
  bills: number;
}
export const DEMO_APPS: readonly DemoApp[] = [
  { slug: "kumar", name: "Kumar Stores", trade: "grocery", app: "BL", bills: 6500 },
  { slug: "raja", name: "Raja Textiles", trade: "fashion", app: "BL", bills: 2300 },
  { slug: "arusuvai", name: "Arusuvai Unavagam", trade: "restaurant", app: "RS", bills: 7700 },
  { slug: "vaasam", name: "Vaasam Biryani Kitchen", trade: "cloud_kitchen", app: "RS", bills: 7100 },
  { slug: "theneer", name: "Theneer Kadai", trade: "tea_stall", app: "RS", bills: 28000 },
  { slug: "thunai", name: "Thunai Pharmacy & Wellness", trade: "pharmacy", app: "PH", bills: 5900 },
  { slug: "techzone", name: "TechZone Mobiles", trade: "electronics", app: "EC", bills: 1200 },
  { slug: "lakshmi", name: "Lakshmi Jewellers", trade: "jewellery", app: "EC", bills: 570 },
  { slug: "sukham", name: "Sukham Ayur Spa", trade: "spa", app: "SV", bills: 1000 },
  { slug: "thaiyal", name: "Thaiyal Tailors & Boutique", trade: "tailoring", app: "SV", bills: 580 },
  { slug: "quickfix", name: "QuickFix Mobile Care", trade: "repair", app: "SV", bills: 550 },
];
