import type { PlanInput } from "./service";

const STARTER_MODULES = ["invoices", "orders", "staff", "importexport"];
const PRO_MODULES = [...STARTER_MODULES, "chat", "reports", "inventory", "booking", "custom-domain", "whatsapp"];

/** Default catalogue. Prices are in paise (₹1 = 100 paise); yearly ≈ 10× monthly. */
export const seedPlans: PlanInput[] = [
  {
    id: "free",
    name: "Free",
    description: "Get started with the essentials.",
    priceMonthlyPaise: 0,
    priceYearlyPaise: 0,
    modules: [],
    limits: { staff: 1, storage_mb: 200, sms_per_month: 50, whatsapp_per_month: 0 },
    features: { remove_branding: false, priority_support: false },
    isPublic: true,
    sort: 0,
  },
  {
    id: "starter",
    name: "Starter",
    description: "For small businesses taking orders and sending invoices.",
    priceMonthlyPaise: 49_900,
    priceYearlyPaise: 499_000,
    modules: STARTER_MODULES,
    limits: { staff: 5, storage_mb: 2_000, sms_per_month: 500, whatsapp_per_month: 0 },
    features: { remove_branding: false, priority_support: false },
    isPublic: true,
    sort: 10,
  },
  {
    id: "pro",
    name: "Pro",
    description: "Your own domain, WhatsApp messaging and more team members.",
    priceMonthlyPaise: 149_900,
    priceYearlyPaise: 1_499_000,
    modules: PRO_MODULES,
    limits: { staff: 25, storage_mb: 20_000, sms_per_month: 3_000, whatsapp_per_month: 2_000 },
    features: { remove_branding: true, priority_support: true },
    isPublic: true,
    sort: 20,
  },
  {
    id: "enterprise",
    name: "Enterprise",
    description: "Custom pricing, unlimited usage and dedicated support.",
    priceMonthlyPaise: 0,
    priceYearlyPaise: 0,
    modules: [...PRO_MODULES, "sso", "audit"],
    limits: { staff: -1, storage_mb: -1, sms_per_month: -1, whatsapp_per_month: -1 },
    features: { remove_branding: true, priority_support: true, dedicated_support: true },
    isPublic: false,
    sort: 30,
  },
];
