import { seedPlans } from "@srirealtime/plans";
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
      // Batch 3: counter help desk, loyalty points, WhatsApp inbox + campaigns, GST e-invoice / e-way bill, branches,
      // API keys + webhooks and the report builder.
      ...BATCH3_BL,
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
      "seo",
      "reviews",
      "analytics",
      "onboarding",
      "expenses",
      "custom-domain",
      // Batch 3: sellers (marketplace + KYC), chat, help desk + FAQ, loyalty, WhatsApp, e-invoice, API keys, reports.
      ...BATCH3_EC,
      // Batch 5: Plan & billing (every app and plan).
      "subscriptions",
    ],
  },
];

/** Batch-1 and batch-2 features per plan, added to the plans package's defaults (free → starter → pro/enterprise). */
const STORE_FREE = ["onboarding", "storefront", "delivery", "cms", "seo"];
const STORE_STARTER = [...STORE_FREE, "reviews", "analytics", "expenses", "storefront.wishlist", "cms.blog"];
const STORE_PRO = ["onboarding.*", "storefront.*", "delivery.*", "cms.*", "seo", "reviews.*", "analytics.*", "expenses.*", "custom-domain"];
// `subscriptions` (Plan & billing) is also a core module of the plans package, so plans made later grant it too.
const PLAN_ADDITIONS: Record<string, string[]> = {
  free: ["catalogue", "orders", "documents", ...STORE_FREE, "subscriptions"],
  starter: ["catalogue.*", "orders", "documents", "coupons", "importexport", "staff", "audit", ...STORE_STARTER, "support", "chat", "loyalty", "subscriptions"],
  pro: ["catalogue.*", "orders.*", "coupons.*", "documents.*", "importexport.*", "staff.*", "audit.*", ...STORE_PRO, ...BATCH3_ALL, "subscriptions"],
  enterprise: ["catalogue.*", "orders.*", "coupons.*", "documents.*", "importexport.*", "staff.*", "audit.*", ...STORE_PRO, ...BATCH3_ALL, "subscriptions"],
};
const withAdditions = (plan: (typeof seedPlans)[number]) => ({
  ...plan,
  modules: [...new Set([...(plan.modules ?? []), ...(PLAN_ADDITIONS[plan.id] ?? [])])],
});

/** Upserts the default plans (with the batch additions) and the app profiles. */
export async function seedPlansAndProfiles(kit: Kit, log: Logger) {
  for (const plan of seedPlans.map(withAdditions)) {
    await kit.plans.service.upsertPlan(plan);
    log.info({ plan: plan.id }, "plan upserted");
  }
  for (const p of APP_PROFILES) {
    const saved = await kit.features.service.putProfile(p.appId, { name: p.name, features: p.features });
    log.info({ app: saved.appId, features: saved.features }, "app profile upserted");
  }
}

export interface ShopSpec {
  slug: string;
  appId: "BL" | "EC";
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
    tenant = await kit.tenancy.service.create({ slug: shop.slug, name: shop.name, ownerUserId, appId: shop.appId });
    await kit.branding.service.update(tenant.id, { appName: shop.name, tokens: { colors: { primary: shop.primary } } });
    await kit.settings.service.handle("billing").setTenant(tenant.id, shop.billing);
    for (const item of shop.items) await kit.invoices.service.createItem(tenant.id, item);
  }
  if (tenant.appId !== shop.appId) tenant = await kit.tenancy.service.setApp(tenant.id, shop.appId);
  if (tenant.planId !== shop.planId) tenant = await kit.tenancy.service.setPlan(tenant.id, shop.planId);
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

  const home = await kit.cms.service.getHome(tenantId);
  if (!home.publishedAt) {
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

  const pages = await kit.cms.service.listPages(tenantId, {});
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
