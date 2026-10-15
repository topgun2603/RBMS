import type { PlanInput } from "./service";

/**
 * Plan `modules` hold feature keys and module wildcards (docs/features.md): `inventory` is just the module's base
 * feature (stock), `inventory.*` is the whole module. Ids of modules without features (orders, chat…) stay bare.
 */
const FREE_FEATURES = ["invoices", "invoices.whatsapp", "invoices.reports"];
const STARTER_FEATURES = [...FREE_FEATURES, "invoices.credit-book", "invoices.gst-reports", "inventory", "payments"];
const STARTER_MODULES = [...STARTER_FEATURES, "orders", "staff", "importexport"];
/** Whole billing modules. */
const PRO_MODULES = [
  "invoices.*",
  "inventory.*",
  "payments.*",
  "orders",
  "staff",
  "importexport",
  "chat",
  "reports",
  "booking",
  "custom-domain",
  "whatsapp",
];

/** Default catalogue. Prices are in paise (₹1 = 100 paise); yearly ≈ 10× monthly. */
export const seedPlans: PlanInput[] = [
  {
    id: "free",
    name: "Free",
    description: "GST billing for one person, up to 50 invoices a month.",
    priceMonthlyPaise: 0,
    priceYearlyPaise: 0,
    modules: FREE_FEATURES,
    limits: { staff: 1, storage_mb: 200, sms_per_month: 50, whatsapp_per_month: 0, invoices_per_month: 50 },
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
    limits: { staff: 5, storage_mb: 2_000, sms_per_month: 500, whatsapp_per_month: 0, invoices_per_month: 1_000 },
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
    limits: { staff: 25, storage_mb: 20_000, sms_per_month: 3_000, whatsapp_per_month: 2_000, invoices_per_month: -1 },
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
    limits: { staff: -1, storage_mb: -1, sms_per_month: -1, whatsapp_per_month: -1, invoices_per_month: -1 },
    features: { remove_branding: true, priority_support: true, dedicated_support: true },
    isPublic: false,
    sort: 30,
  },
];
