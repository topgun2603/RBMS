import { seedPlans, type AddonInput, type PlanTier } from "@rbms/plans";
import type { Logger } from "pino";
import type { Kit } from "./kit";

/**
 * Seed data shared by `pnpm seed` (demo shops) and `pnpm seed:e2e` (the dedicated e2e shops). Every helper is
 * idempotent: it only creates what is missing, so owners' edits survive re-runs.
 */

/** Batch-3 feature grants (docs/batch3.md). e-invoice keys are listed one by one: they don't start with the module id. */
export const BATCH3_ALL = [
  "marketplace.*",
  "chat",
  "support.*",
  "kyc",
  "loyalty",
  "whatsapp.*",
  "gst-einvoice",
  "gst-ewaybill",
  "multi-branch",
  "developer",
  "reports.advanced",
];
const BATCH3_EC = ["marketplace.*", "chat", "support.*", "kyc", "loyalty", "whatsapp.*", "developer", "reports.advanced", "gst-einvoice"];
const BATCH3_BL = ["support", "loyalty", "whatsapp.*", "gst-einvoice", "gst-ewaybill", "multi-branch", "developer", "reports.advanced"];

/**
 * App profiles (docs/features.md, docs/commerce-batch1.md "Plans and app profiles"): a feature key grants that
 * feature, `module.*` the whole module. Billing: catalogue without variants, no orders/coupons for now.
 */
export const APP_PROFILES: { appId: string; name: string; features: string[] }[] = [
  {
    appId: "BL",
    name: "Billing",
    // No online store for billing shops; the setup checklist and expenses (profit report) are useful to every shop.
    features: [
      "invoices.*",
      "inventory.*",
      "payments.*",
      "catalogue",
      "staff",
      "audit",
      "importexport",
      "documents",
      "onboarding",
      "expenses",
      // Staff attendance, leave and payroll (docs/payroll.md; the owner switches it on).
      "payroll.*",
      // The shop's books (the owner switches them on).
      "accounting",
      // AI helpers (docs/ai.md): off until the owner switches them on; plan credits apply.
      "ai",
      // Batch 3: counter help desk, loyalty points, WhatsApp inbox + campaigns, GST e-invoice / e-way bill, branches,
      // API keys + webhooks and the report builder.
      ...BATCH3_BL,
      // Trades (off until the business pack or the owner turns them on): weighing scales for grocery / bakery / fresh.
      "scales.*",
      // POS terminals (docs/pos-terminals.md): paired counters + PIN unlock; the weighing station is off until a
      // pack with scales (or the owner) turns it on.
      "pos.*",
      // Batch 5: Plan & billing (every app and plan).
      "subscriptions",
    ],
  },
  {
    appId: "EC",
    name: "Ecommerce",
    features: [
      "invoices",
      "invoices.whatsapp",
      "invoices.reports",
      "invoices.gst-reports",
      "invoices.quotations",
      "invoices.sales-docs",
      "invoices.recurring",
      "inventory",
      "inventory.locations",
      "payments",
      "catalogue.*",
      "orders.*",
      "coupons",
      "staff",
      "audit",
      "importexport",
      "documents",
      // Batch 2: the shop's own online store.
      "storefront.*",
      "delivery.*",
      "cms.*",
      "enquiries",
      "seo",
      "reviews",
      "analytics",
      "onboarding",
      "expenses",
      // Staff attendance, leave and payroll (docs/payroll.md; the owner switches it on).
      "payroll.*",
      // The shop's books (the owner switches them on).
      "accounting",
      // AI helpers (docs/ai.md): off until the owner switches them on; plan credits apply.
      "ai",
      "custom-domain",
      // Batch 3: sellers (marketplace + KYC), chat, help desk + FAQ, loyalty, WhatsApp, e-invoice, API keys, reports.
      ...BATCH3_EC,
      // Trades (off until the business pack or the owner turns them on): weighing scales, serial numbers / IMEI +
      // warranty, jewellery (daily metal rates, making charges, HUID, old gold exchange).
      "scales.*",
      "serials.*",
      "jewellery.*",
      // POS terminals and the weighing station (off by default).
      "pos.*",
      // Batch 5: Plan & billing (every app and plan).
      "subscriptions",
    ],
  },
  {
    appId: "PH",
    name: "Pharmacy",
    // A medical shop: full counter billing (credit book, purchases from distributors, stock) and its own online store.
    features: [
      "invoices.*",
      "inventory.*",
      "payments.*",
      "catalogue",
      "staff",
      "audit",
      "importexport",
      "documents",
      "onboarding",
      "expenses",
      // Staff attendance, leave and payroll (docs/payroll.md; the owner switches it on).
      "payroll.*",
      // The shop's books (the owner switches them on).
      "accounting",
      // AI helpers (docs/ai.md): off until the owner switches them on; plan credits apply.
      "ai",
      ...BATCH3_BL,
      // Medicine details, batches + expiry (FEFO), prescriptions and the Schedule H1 register.
      "medicines.*",
      // Online store: the pharmacy's own website on its domain, online orders and delivery.
      "catalogue.*",
      "orders.*",
      "coupons",
      "storefront.*",
      "delivery.*",
      "cms.*",
      "enquiries",
      "seo",
      "reviews",
      "analytics",
      "custom-domain",
      // POS terminals (counters with PIN unlock).
      "pos.*",
      "subscriptions",
    ],
  },
  {
    appId: "RS",
    name: "Restaurant",
    // Dine-in / takeaway billing at the counter plus online ordering through the shop's store (menu = catalogue). No
    // inventory: dishes are cooked to order, so stock never blocks an order (raw-material stock would be a recipe
    // feature of its own); without inventory locations there are no branches either.
    features: [
      "invoices.*",
      "payments.*",
      "catalogue.*",
      "orders.*",
      "coupons",
      "staff",
      "audit",
      "importexport",
      "documents",
      "storefront.*",
      "delivery.*",
      "cms.*",
      "enquiries",
      "seo",
      "reviews",
      "analytics",
      "onboarding",
      "expenses",
      // Staff attendance, leave and payroll (docs/payroll.md; the owner switches it on).
      "payroll.*",
      // The shop's books (the owner switches them on).
      "accounting",
      // AI helpers (docs/ai.md): off until the owner switches them on; plan credits apply.
      "ai",
      "custom-domain",
      "chat",
      "support.*",
      "loyalty",
      "whatsapp.*",
      "developer",
      "reports.advanced",
      // Tables, running orders, KOTs per station, kitchen display, QR table ordering, bills from orders.
      "dining.*",
      // POS terminals (counters with PIN unlock).
      "pos.*",
      "subscriptions",
    ],
  },
  {
    appId: "SV",
    name: "Services",
    // Salons, spas, gyms, repair shops, tailors and opticals: appointments, job cards and memberships, counter billing
    // with stock for parts and retail, and an online store with online booking.
    features: [
      "jobcards.*",
      "bookings.*",
      "memberships.*",
      // Repair shops: serial numbers / IMEI + warranty of devices sold (off until the pack or owner turns it on).
      "serials.*",
      "invoices.*",
      "inventory.*",
      "payments.*",
      "catalogue.*",
      "orders.*",
      "coupons",
      "staff",
      "audit",
      "importexport",
      "documents",
      "storefront.*",
      "delivery.*",
      "cms.*",
      "enquiries",
      "seo",
      "reviews",
      "analytics",
      "onboarding",
      "expenses",
      // Staff attendance, leave and payroll (docs/payroll.md; the owner switches it on).
      "payroll.*",
      // The shop's books (the owner switches them on).
      "accounting",
      // AI helpers (docs/ai.md): off until the owner switches them on; plan credits apply.
      "ai",
      "custom-domain",
      "chat",
      "support.*",
      "loyalty",
      "whatsapp.*",
      "developer",
      "reports.advanced",
      "subscriptions",
    ],
  },
  {
    appId: "SC",
    name: "School",
    // A school's website (docs/school.md): pages, news, admission enquiries, campus-visit booking, programmes, website
    // chat and the help FAQ. No billing, stock, orders, POS, payments or the shop engines.
    features: [
      "storefront",
      "cms.*",
      "seo",
      "custom-domain",
      "enquiries",
      "bookings.*",
      "catalogue",
      "analytics",
      "onboarding",
      "staff",
      "audit",
      "chat",
      "support.*",
      "ai",
      "subscriptions",
    ],
  },
];

/** Batch-1 and batch-2 features per plan, added to the plans package's defaults (free → starter → pro/enterprise). */
const STORE_FREE = ["onboarding", "storefront", "delivery", "cms", "seo", "enquiries"];
const STORE_STARTER = [...STORE_FREE, "reviews", "analytics", "expenses", "storefront.wishlist", "cms.blog"];
const STORE_PRO = ["onboarding.*", "storefront.*", "delivery.*", "cms.*", "seo", "enquiries", "reviews.*", "analytics.*", "expenses.*", "custom-domain"];
// `subscriptions` (Plan & billing) is also a core module of the plans package, so plans made later grant it too.
// Verticals (pharmacy, restaurant): the app profile decides who sees them; plans only size them. Batches and expiry
// are the core of a pharmacy, so every plan has them; prescriptions and the H1 register from starter up. Restaurants:
// tables and KOTs on every plan; the kitchen display and QR table ordering from starter up.
const VERTICALS_FREE = ["medicines", "dining", "jobcards", "bookings", "memberships", "scales", "serials", "jewellery"];
const VERTICALS_PAID = ["medicines.*", "dining.*", "jobcards.*", "bookings.*", "memberships.*", "scales.*", "serials.*", "jewellery.*"];
const PLAN_ADDITIONS: Record<string, string[]> = {
  free: ["invoices.quotations", "invoices.sales-docs", "catalogue", "orders", "documents", ...STORE_FREE, ...VERTICALS_FREE, "subscriptions", "ai"],
  starter: [
    "invoices.quotations",
    "invoices.sales-docs",
    // Recurring bills (docs/recurring-export-gstin.md): paid plans; invoices.* plans have it already.
    "invoices.recurring",
    "catalogue.*",
    "orders",
    "documents",
    "coupons",
    "importexport",
    "staff",
    "audit",
    ...STORE_STARTER,
    "support",
    "chat",
    "loyalty",
    ...VERTICALS_PAID,
    // POS terminals and the weighing station from starter up (docs/pos-terminals.md).
    "pos.*",
    "subscriptions",
    "ai",
    // Staff attendance and leave from starter up; salaries and payslips (payroll.salary) from pro.
    "payroll",
  ],
  pro: ["catalogue.*", "orders.*", "coupons.*", "documents.*", "importexport.*", "staff.*", "audit.*", ...STORE_PRO, ...BATCH3_ALL, ...VERTICALS_PAID, "pos.*", "subscriptions", "accounting", "ai", "payroll.*"],
  enterprise: ["catalogue.*", "orders.*", "coupons.*", "documents.*", "importexport.*", "staff.*", "audit.*", ...STORE_PRO, ...BATCH3_ALL, ...VERTICALS_PAID, "pos.*", "subscriptions", "accounting", "ai", "payroll.*"],
};
/** Limits added to the plans package's defaults: paired POS terminals (-1 = unlimited). */
/**
 * Also the AI credits a month (`ai_credits_per_month`, docs/ai.md): 1 credit = $0.001 of model cost, so Free 50 is about
 * Rs 4 of model cost, Starter 2,000 about Rs 170 and Pro 10,000 about Rs 850. Placeholders until pricing is decided.
 */
export const PLAN_LIMIT_ADDITIONS: Record<string, Record<string, number>> = {
  free: { pos_terminals: 1, ai_credits_per_month: 50 },
  starter: { pos_terminals: 2, ai_credits_per_month: 2_000 },
  pro: { pos_terminals: 5, ai_credits_per_month: 10_000 },
  enterprise: { pos_terminals: -1, ai_credits_per_month: -1 },
};
const withAdditions = (plan: (typeof seedPlans)[number]) => ({
  ...plan,
  modules: [...new Set([...(plan.modules ?? []), ...(PLAN_ADDITIONS[plan.id] ?? [])])],
  limits: { ...(plan.limits ?? {}), ...(PLAN_LIMIT_ADDITIONS[plan.id] ?? {}) },
});

type AppId = "BL" | "EC" | "PH" | "RS" | "SV" | "SC";
type PaidTier = "starter" | "pro";

/**
 * Plans per app (docs/verticals.md "Plans per app"): every app has its own Free, Starter, Pro and Enterprise, built on
 * the shared tier contents (`seedPlans` + batch additions), with the app's own prices and wording. Prices are
 * placeholders in paise a month (yearly = 10 months); super-admins set the real ones in Platform → Apps & features.
 */
const APP_PLAN_PRICES: Record<AppId, Record<PaidTier, number>> = {
  BL: { starter: 49_900, pro: 149_900 },
  EC: { starter: 79_900, pro: 199_900 },
  PH: { starter: 99_900, pro: 249_900 },
  RS: { starter: 99_900, pro: 249_900 },
  SV: { starter: 69_900, pro: 179_900 },
  SC: { starter: 59_900, pro: 149_900 },
};
const APP_PLAN_COPY: Record<AppId, Record<"free" | PaidTier, string>> = {
  BL: {
    free: "GST billing for one person, up to 50 bills a month.",
    starter: "Billing with stock, purchases and the credit book for a small team.",
    pro: "Branches, WhatsApp bills and reminders, e-invoices and reports.",
  },
  EC: {
    free: "Counter billing and a simple online store to start selling.",
    starter: "Your online store with delivery, coupons, reviews and stock.",
    pro: "Your own domain, sellers, campaigns, loyalty and advanced reports.",
  },
  PH: {
    free: "Pharmacy billing with batches and expiry for one person.",
    starter: "Prescriptions, the Schedule H1 register and online orders.",
    pro: "Branches, distributor purchases, WhatsApp and advanced reports.",
  },
  RS: {
    free: "Dine-in and takeaway billing with KOTs for one counter.",
    starter: "Kitchen display, QR table ordering and online orders.",
    pro: "Your own domain, delivery, loyalty, campaigns and reports.",
  },
  SV: {
    free: "Appointments and job cards for one person.",
    starter: "Memberships, online booking, job tracking and a small team.",
    pro: "Campaigns, loyalty, your own domain and a bigger team.",
  },
  SC: {
    free: "Your school website with admission enquiries and campus-visit booking.",
    starter: "News and events, website chat, visitor analytics and a small team.",
    pro: "Your own domain, the help centre FAQ and a bigger team.",
  },
};

/** Id of an app's plan of a tier: "sv-pro". */
export const appPlanId = (appId: string, tier: string) => `${appId.toLowerCase()}-${tier}`;

function appPlans(appId: AppId) {
  return seedPlans.map(withAdditions).map((p) => {
    const tier = p.id as "free" | PaidTier | "enterprise";
    const price = tier === "starter" || tier === "pro" ? APP_PLAN_PRICES[appId][tier] : p.priceMonthlyPaise ?? 0;
    return {
      ...p,
      id: appPlanId(appId, tier),
      appId,
      tier,
      description: tier === "enterprise" ? p.description : APP_PLAN_COPY[appId][tier],
      priceMonthlyPaise: price,
      priceYearlyPaise: price * 10,
    };
  });
}

/**
 * Plan add-ons per app (docs/verticals.md "Plan add-ons"). PLACEHOLDER prices and sizes (paise; yearly = 10 months),
 * not commercial decisions: super-admins edit them in Platform → Apps & features → <app> → Add-ons. Recurring add-ons
 * are for paid tiers; credits packs for every tier. Custom domain only where the app offers it and Pro doesn't include it.
 */
const ADDON_TEMPLATES: (Omit<AddonInput, "id" | "appId"> & { apps?: AppId[] })[] = [
  {
    code: "extra-staff",
    kind: "limit",
    name: "Extra staff (+5)",
    description: "Five more team members on top of your plan.",
    limits: { staff: 5 },
    priceMonthlyPaise: 19_900,
    priceYearlyPaise: 199_000,
    maxQuantity: 10,
    tiers: ["starter", "pro"],
    sort: 10,
  },
  {
    code: "extra-branch",
    kind: "limit",
    name: "Extra branch",
    description: "One more branch or location with its own GSTIN, bill series and stock.",
    limits: { branches: 1 },
    priceMonthlyPaise: 49_900,
    priceYearlyPaise: 499_000,
    maxQuantity: 20,
    tiers: ["starter", "pro"],
    sort: 20,
  },
  {
    code: "whatsapp-1000",
    kind: "limit",
    name: "WhatsApp 1,000",
    description: "1,000 more WhatsApp messages every month.",
    limits: { whatsapp_per_month: 1_000 },
    priceMonthlyPaise: 29_900,
    priceYearlyPaise: 299_000,
    maxQuantity: 20,
    tiers: ["starter", "pro"],
    sort: 30,
  },
  {
    code: "storage-10gb",
    kind: "limit",
    name: "Extra storage (+10 GB)",
    description: "10 GB more for photos, documents and backups.",
    limits: { storage_mb: 10_000 },
    priceMonthlyPaise: 9_900,
    priceYearlyPaise: 99_000,
    maxQuantity: 10,
    tiers: ["starter", "pro"],
    sort: 40,
  },
  {
    code: "custom-domain",
    kind: "feature",
    name: "Custom domain",
    description: "Your store on your own domain (www.yourshop.in) with free SSL.",
    modules: ["custom-domain"],
    priceMonthlyPaise: 14_900,
    priceYearlyPaise: 149_000,
    // Pro already includes it.
    tiers: ["starter"],
    apps: ["EC", "RS", "SV", "SC"],
    sort: 50,
  },
  {
    code: "ai-credits-5000",
    kind: "credits",
    name: "AI credits pack (5,000)",
    description: "5,000 AI credits, used after your monthly AI credits; they never expire.",
    limits: { ai_credits_per_month: 5_000 },
    priceOncePaise: 59_900,
    maxQuantity: 10,
    sort: 65,
  },
  {
    code: "sms-5000",
    kind: "credits",
    name: "SMS pack (5,000)",
    description: "5,000 SMS credits, used after your monthly SMS; they never expire.",
    limits: { sms_per_month: 5_000 },
    priceOncePaise: 99_900,
    maxQuantity: 10,
    sort: 60,
  },
];

/** An app's add-on id: "ec-extra-staff". */
export const appAddonId = (appId: string, code: string) => `${appId.toLowerCase()}-${code}`;

/** Upserts the plans (shared tier templates, then each app's own), the app profiles and the add-ons. */
export async function seedPlansAndProfiles(kit: Kit, log: Logger) {
  await seedAddons(kit, log);
  // Shared tiers: templates for apps without plans of their own, not offered to shops.
  for (const plan of seedPlans.map(withAdditions)) {
    await kit.plans.service.upsertPlan({ ...plan, tier: plan.id as PlanTier, isPublic: false });
    log.info({ plan: plan.id }, "plan template upserted");
  }
  for (const appId of Object.keys(APP_PLAN_PRICES) as AppId[]) {
    for (const plan of appPlans(appId)) await kit.plans.service.upsertPlan(plan);
    log.info({ app: appId }, "app plans upserted");
  }
  for (const p of APP_PROFILES) {
    const saved = await kit.features.service.putProfile(p.appId, { name: p.name, features: p.features });
    log.info({ app: saved.appId, features: saved.features }, "app profile upserted");
  }
}

/**
 * Each app's placeholder add-ons, created only when missing so a super-admin's edits (prices, tiers, hidden) survive
 * re-seeding.
 */
async function seedAddons(kit: Kit, log: Logger) {
  const existing = new Set((await kit.plans.service.listAddons()).map((a) => a.id));
  let created = 0;
  for (const appId of Object.keys(APP_PLAN_PRICES) as AppId[]) {
    for (const { apps, ...t } of ADDON_TEMPLATES) {
      if (apps && !apps.includes(appId)) continue;
      const id = appAddonId(appId, t.code);
      if (existing.has(id)) continue;
      await kit.plans.service.upsertAddon({ ...t, id, appId });
      created++;
    }
  }
  log.info({ created }, "plan add-ons seeded (placeholders)");
}

export interface ShopSpec {
  slug: string;
  appId: "BL" | "EC" | "PH" | "RS" | "SV" | "SC";
  /** The shop's trade (@rbms/verticals pack); applied with its look and starter content when the shop is created. */
  businessType?: string;
  /** Tier ("pro") — the shop gets its app's plan of that tier ("sv-pro") — or a full plan id. */
  planId: string;
  name: string;
  primary: string;
  billing: Record<string, string>;
  items: { name: string; hsn: string; unit: string; rate: number; gstRate: number }[];
}

/**
 * Creates the shop (owner, branding, business profile, billing items) when missing, then sets its app and plan.
 * Existing shops keep their data. Returns the tenant and whether it was created now.
 */
export async function ensureShop(kit: Kit, shop: ShopSpec, ownerUserId: string) {
  let tenant = await kit.tenancy.service.getBySlug(shop.slug);
  const created = !tenant;
  if (!tenant) {
    // The on-tenant-created "starter" hook applies the shop's trade (its categories, look and home) right away.
    tenant = await kit.tenancy.service.create({
      slug: shop.slug,
      name: shop.name,
      ownerUserId,
      appId: shop.appId,
      details: shop.businessType ? { signup: { businessType: shop.businessType } } : undefined,
    });
    await kit.branding.service.update(tenant.id, { appName: shop.name, tokens: { colors: { primary: shop.primary } } });
    await kit.settings.service.handle("billing").setTenant(tenant.id, shop.billing);
    for (const item of shop.items) await kit.invoices.service.createItem(tenant.id, item);
  }
  if (tenant.appId !== shop.appId) tenant = await kit.tenancy.service.setApp(tenant.id, shop.appId);
  const planId = shop.planId.includes("-") ? shop.planId : appPlanId(shop.appId, shop.planId);
  if (tenant.planId !== planId) tenant = await kit.tenancy.service.setPlan(tenant.id, planId);
  // Batch 5: the shop's subscription, `active` on its plan (provider `manual`, no period end) so it never expires;
  // an existing free/manual subscription follows the plan set above. Trials and paid subscriptions are left alone.
  await kit.subscriptions.service.ensure(tenant.id);
  return { tenant, created };
}

export interface ProductSpec {
  name: string;
  category: string;
  hsn: string;
  gstRate: number;
  sizes: string[];
  skuPrefix: string;
  price: number;
  mrp: number;
  cost: number;
  stock: number;
}

/** The demo store catalogue (anbu, e2e-store): products with size variants and opening stock. */
export const STORE_PRODUCTS: ProductSpec[] = [
  { name: "Anarkali Kurti", category: "Kurtis", hsn: "6204", gstRate: 5, sizes: ["S", "M", "L"], skuPrefix: "AK", price: 99_900, mrp: 129_900, cost: 55_000, stock: 10 },
  { name: "Cotton Palazzo", category: "Bottoms", hsn: "6204", gstRate: 5, sizes: ["M", "L", "XL"], skuPrefix: "CP", price: 59_900, mrp: 79_900, cost: 30_000, stock: 8 },
  { name: "Silk Saree (Kanchipuram)", category: "Sarees", hsn: "5007", gstRate: 5, sizes: [], skuPrefix: "KS", price: 899_900, mrp: 999_900, cost: 600_000, stock: 3 },
];

/** Store products with size variants and opening stock, and the WELCOME10 coupon. Idempotent. */
export async function seedStoreCatalogue(kit: Kit, tenantId: string, log: Logger, label: string, products: ProductSpec[] = STORE_PRODUCTS) {
  const categories = new Map((await kit.catalogue.service.listCategories(tenantId)).items.map((c) => [c.name, c.id]));
  for (const p of products) {
    const existing = (await kit.catalogue.service.listProducts(tenantId, { q: p.name, limit: 10 })).items.find((x) => x.name === p.name);
    if (existing) continue;
    let categoryId = categories.get(p.category);
    if (!categoryId) {
      categoryId = (await kit.catalogue.service.createCategory(tenantId, { name: p.category })).id;
      categories.set(p.category, categoryId);
    }
    const common = { price: p.price, mrp: p.mrp, cost: p.cost };
    const product = await kit.catalogue.service.createProduct(tenantId, {
      name: p.name,
      categoryId,
      hsn: p.hsn,
      gstRate: p.gstRate,
      taxInclusive: true,
      channels: ["store", "billing"],
      tags: ["demo"],
      ...(p.sizes.length
        ? {
            options: [{ name: "Size", values: p.sizes }],
            variants: p.sizes.map((size) => ({ ...common, sku: `${p.skuPrefix}-${size}`, optionValues: { Size: size } })),
          }
        : { ...common, sku: `${p.skuPrefix}-1` }),
    });
    for (const v of product.variants) {
      await kit.inventory.service.adjust(tenantId, v.id, { mode: "set", qty: p.stock, unitCost: Math.round((p.cost * 100) / 105), note: "Opening stock (seed)" });
    }
    log.info({ product: p.name, variants: product.variants.length }, `${label}: demo product created`);
  }
  const coupons = await kit.coupons.service.list(tenantId, { q: "WELCOME10" });
  if (!coupons.items.some((c) => c.code === "WELCOME10")) {
    await kit.coupons.service.create(tenantId, {
      code: "WELCOME10",
      description: "10% off your first order (up to ₹500)",
      type: "percent",
      value: 10,
      maxDiscount: 50_000,
      channels: ["store", "manual"],
    });
    log.info(`${label}: coupon WELCOME10 created`);
  }
}

export interface StoreContentSpec {
  shopName: string;
  contactPhone: string;
  contactEmail: string;
  instagram: string;
  aboutText: string;
}

/**
 * A shop's online store (docs/commerce-batch2.md): store settings (open, COD up to ₹5,000), delivery zones (Tamil Nadu
 * ₹40, free above ₹999, COD fee ₹30; Rest of India by weight), a "New arrivals" collection, a published home page, an
 * About page and header/footer menus. Each part is only created when missing, so owners' edits survive re-runs.
 */
/** True when the shop has never had a home page (no draft, nothing published) — the only case a seed may write one. */
export function homeMissing(home: { draft: unknown; published: unknown; publishedAt: Date | null }): boolean {
  return !home.draft && !home.published && !home.publishedAt;
}

export async function seedStoreContent(kit: Kit, tenantId: string, spec: StoreContentSpec, log: Logger, label: string) {
  const store = kit.settings.service.handle("store");
  const current = await store.get({ tenantId });
  if (!current.contactPhone) {
    await store.setTenant(tenantId, {
      open: true,
      codEnabled: true,
      codMaxAmount: 500_000,
      minOrderValue: 0,
      contactPhone: spec.contactPhone,
      contactEmail: spec.contactEmail,
      social: { instagram: spec.instagram, whatsapp: spec.contactPhone },
      policies: {
        shipping: "Orders ship in 1–2 working days. Tamil Nadu: 1–3 days, rest of India: 3–7 days.",
        returns: "Unused items can be returned within 7 days of delivery.",
        privacy: "We only use your details to deliver your order.",
        terms: "Prices include GST.",
      },
    });
    log.info(`${label}: store settings saved`);
  }

  const zones = await kit.delivery.service.listZones(tenantId);
  if (zones.total === 0) {
    const tn = await kit.delivery.service.createZone(tenantId, { name: "Tamil Nadu", states: ["33"], sort: 0 });
    await kit.delivery.service.createRate(tenantId, {
      zoneId: tn.id,
      name: "Standard (Tamil Nadu)",
      type: "free_above",
      amount: 4_000,
      freeAbove: 99_900,
      etaMinDays: 1,
      etaMaxDays: 3,
      codAllowed: true,
      codFee: 3_000,
    });
    const rest = await kit.delivery.service.createZone(tenantId, { name: "Rest of India", sort: 10 });
    await kit.delivery.service.createRate(tenantId, {
      zoneId: rest.id,
      name: "Standard (India)",
      type: "weight",
      amount: 8_000,
      weightSlabs: [
        { upToGrams: 500, amount: 8_000 },
        { upToGrams: 1_000, amount: 11_000 },
        { upToGrams: 2_000, amount: 15_000 },
        { upToGrams: 5_000, amount: 25_000 },
      ],
      etaMinDays: 3,
      etaMaxDays: 7,
      codAllowed: true,
      codFee: 5_000,
    });
    log.info(`${label}: delivery zones created`);
  }

  const collections = await kit.catalogue.service.listCollections(tenantId, { q: "New arrivals" });
  if (!collections.items.some((c) => c.slug === "new-arrivals")) {
    await kit.catalogue.service.createCollection(tenantId, {
      name: "New arrivals",
      slug: "new-arrivals",
      description: "The latest additions to our store.",
      type: "rule",
      rule: { sort: "new" },
    });
    log.info(`${label}: collection new-arrivals created`);
  }

  // Only a shop with no home page at all gets the demo one: a published home, or a draft the owner is still working
  // on, is never overwritten by a re-run.
  const home = await kit.cms.service.getHome(tenantId);
  if (!homeMissing(home)) log.info(`${label}: home page exists, left unchanged`);
  else {
    await kit.cms.service.saveHomeDraft(tenantId, {
      sections: [
        {
          type: "hero",
          slides: [
            {
              // No stock photo: the storefront draws the shop's brand gradient with a soft pattern.
              imageUrl: null,
              heading: "Festive kurtis and silk sarees",
              subheading: "Handpicked in Tiruchirappalli, delivered across India",
              cta: { label: "Shop now", href: "/collections/new-arrivals" },
            },
          ],
        },
        { type: "categories", title: "Shop by category" },
        { type: "collection", title: "New arrivals", collectionSlug: "new-arrivals", layout: "carousel", limit: 8 },
        {
          type: "usp",
          items: [
            { icon: "free-shipping", title: "Free shipping", text: "In Tamil Nadu on orders above ₹999" },
            { icon: "cod", title: "Cash on delivery", text: "Pay when your order arrives" },
            { icon: "returns", title: "Easy returns", text: "7-day returns on unused items" },
          ],
        },
        {
          type: "testimonials",
          title: "Happy customers",
          items: [
            { quote: "Beautiful kurti, perfect fit and quick delivery.", name: "Priya, Madurai" },
            { quote: "The Kanchipuram saree is stunning. Worth every rupee.", name: "Lakshmi, Chennai" },
          ],
        },
      ],
    });
    await kit.cms.service.publishHome(tenantId);
    log.info(`${label}: home page published`);
  }

  // Look the slug up (a shop with many pages may not have "about" on the first list page; a miss would add "about-2").
  const pages = await kit.cms.service.listPages(tenantId, { q: "about", limit: 100 });
  if (!pages.items.some((p) => p.slug === "about")) {
    const about = await kit.cms.service.createPage(tenantId, {
      title: "About us",
      slug: "about",
      blocks: [
        { type: "heading", level: 2, text: spec.shopName },
        { type: "paragraph", markdown: spec.aboutText },
        { type: "faq", items: [{ q: "Do you ship outside Tamil Nadu?", a: "Yes, we deliver across India in 3–7 days." }] },
      ],
    });
    await kit.cms.service.setPageStatus(tenantId, about.id, "published");
    log.info(`${label}: about page published`);
  }

  if ((await kit.cms.service.getMenu(tenantId, "header")).items.length === 0) {
    await kit.cms.service.saveMenu(tenantId, "header", [
      { label: "Home", type: "url", href: "/" },
      { label: "New arrivals", type: "url", href: "/collections/new-arrivals" },
      { label: "Kurtis", type: "url", href: "/search?q=kurti" },
      { label: "About", type: "url", href: "/pages/about" },
    ]);
  }
  if ((await kit.cms.service.getMenu(tenantId, "footer")).items.length === 0) {
    await kit.cms.service.saveMenu(tenantId, "footer", [
      {
        label: "Help",
        type: "url",
        children: [
          { label: "Track your order", type: "url", href: "/track" },
          { label: "Contact us", type: "url", href: `tel:${spec.contactPhone}` },
        ],
      },
      { label: "About us", type: "url", href: "/pages/about" },
    ]);
    log.info(`${label}: menus saved`);
  }
}

/**
 * A restaurant's floor and kitchen stations: two areas with tables, and drinks (names matching `beverageWords`) made
 * at a "beverages" station so their KOTs print separately. Only when the shop has no tables yet.
 */
export async function seedRestaurantSetup(kit: Kit, tenantId: string, log: Logger, label: string, beverageWords = /coffee|tea|juice|lassi|soda/i) {
  const svc = kit.dining.service;
  if ((await svc.tables(tenantId, { includeInactive: true })).length > 0) return;
  const floors: [string, string[], number][] = [
    ["Ground floor", ["T1", "T2", "T3", "T4", "T5", "T6"], 4],
    ["AC hall", ["A1", "A2", "A3", "A4"], 6],
  ];
  for (const [i, [name, tables, seats]] of floors.entries()) {
    const area = await svc.createArea(tenantId, { name, sort: (i + 1) * 10 });
    for (const [j, t] of tables.entries()) await svc.createTable(tenantId, { name: t, areaId: area.id, seats, sort: (j + 1) * 10 });
  }
  const items = await kit.invoices.service.listItems(tenantId, { limit: 200 } as never);
  for (const item of items.items) if (beverageWords.test(item.name)) await svc.saveMenuItem(tenantId, item.id, { station: "beverages", veg: true });
  log.info(`${label}: dining areas, tables and stations seeded`);
}
