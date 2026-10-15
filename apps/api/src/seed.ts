import { seedPlans } from "@srirealtime/plans";
import { pino } from "pino";
import { env } from "./env";
import { createKit, type Kit } from "./kit";

/**
 * Idempotent. Upserts the default plans and app profiles and, if SEED_SUPERADMIN is set, grants that user super-admin
 * and (unless SEED_DEMO=false) creates demo shops owned by them: two Billing shops (raja → pro, kumar → starter) and one
 * Ecommerce shop (anbu → pro, app EC: billing without credit book, reminders or purchases). Existing demo shops get
 * their plan and app set on every run.
 */
const log = pino({ level: "info" });

/**
 * App profiles (docs/features.md, docs/commerce-batch1.md "Plans and app profiles"): a feature key grants that
 * feature, `module.*` the whole module. Billing: catalogue without variants, no orders/coupons for now.
 */
const APP_PROFILES: { appId: string; name: string; features: string[] }[] = [
  {
    appId: "BL",
    name: "Billing",
    // No online store for billing shops; the setup checklist and expenses (profit report) are useful to every shop.
    features: ["invoices.*", "inventory.*", "payments.*", "catalogue", "staff", "audit", "importexport", "documents", "onboarding", "expenses"],
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
    ],
  },
];

/** Batch-1 and batch-2 features per plan, added to the plans package's defaults (free → starter → pro/enterprise). */
const STORE_FREE = ["onboarding", "storefront", "delivery", "cms", "seo"];
const STORE_STARTER = [...STORE_FREE, "reviews", "analytics", "expenses", "storefront.wishlist", "cms.blog"];
const STORE_PRO = ["onboarding.*", "storefront.*", "delivery.*", "cms.*", "seo", "reviews.*", "analytics.*", "expenses.*", "custom-domain"];
const PLAN_ADDITIONS: Record<string, string[]> = {
  free: ["catalogue", "orders", "documents", ...STORE_FREE],
  starter: ["catalogue.*", "orders", "documents", "coupons", "importexport", "staff", "audit", ...STORE_STARTER],
  pro: ["catalogue.*", "orders.*", "coupons.*", "documents.*", "importexport.*", "staff.*", "audit.*", ...STORE_PRO],
  enterprise: ["catalogue.*", "orders.*", "coupons.*", "documents.*", "importexport.*", "staff.*", "audit.*", ...STORE_PRO],
};
const withAdditions = (plan: (typeof seedPlans)[number]) => ({
  ...plan,
  modules: [...new Set([...(plan.modules ?? []), ...(PLAN_ADDITIONS[plan.id] ?? [])])],
});

interface DemoShop {
  slug: string;
  appId: "BL" | "EC";
  planId: string;
  name: string;
  primary: string;
  billing: Record<string, string>;
  items: { name: string; hsn: string; unit: string; rate: number; gstRate: number }[];
}

const DEMO_SHOPS: DemoShop[] = [
  {
    slug: "raja",
    appId: "BL",
    planId: "pro",
    name: "Raja Textiles",
    primary: "#b91c1c",
    billing: {
      legalName: "Raja Textiles",
      gstin: "33AABFR1234K1ZI",
      address: "12, Big Bazaar Street",
      city: "Coimbatore",
      pincode: "641001",
      stateCode: "33",
      phone: "+919876500001",
      invoicePrefix: "RT",
      upiId: "rajatextiles@okaxis",
    },
    items: [
      { name: "Cotton saree", hsn: "5208", unit: "pcs", rate: 85_000, gstRate: 5 },
      { name: "Silk saree", hsn: "5007", unit: "pcs", rate: 650_000, gstRate: 5 },
      { name: "Cotton shirting fabric", hsn: "5208", unit: "m", rate: 12_050, gstRate: 5 },
      { name: "Readymade shirt", hsn: "6205", unit: "pcs", rate: 149_900, gstRate: 12 },
    ],
  },
  {
    slug: "kumar",
    appId: "BL",
    planId: "starter",
    name: "Kumar Stores",
    primary: "#1d4ed8",
    billing: {
      legalName: "Kumar General Stores",
      gstin: "33AAKFK5678M1ZO",
      address: "45, Gandhi Road",
      city: "Madurai",
      pincode: "625001",
      stateCode: "33",
      phone: "+919876500002",
      invoicePrefix: "KS",
      upiId: "kumarstores@okhdfcbank",
    },
    items: [
      { name: "Rice (Ponni) 25 kg", hsn: "1006", unit: "bag", rate: 145_000, gstRate: 5 },
      { name: "Sunflower oil 1 L", hsn: "1512", unit: "pcs", rate: 16_500, gstRate: 5 },
      { name: "Toothpaste 150 g", hsn: "3306", unit: "pcs", rate: 9_900, gstRate: 18 },
    ],
  },
  {
    slug: "anbu",
    appId: "EC",
    planId: "pro",
    name: "Anbu Fashions",
    primary: "#7c3aed",
    billing: {
      legalName: "Anbu Fashions Online",
      address: "8, Nethaji Road",
      city: "Tiruchirappalli",
      pincode: "620001",
      stateCode: "33",
      phone: "+919876500003",
      invoicePrefix: "AF",
      upiId: "anbufashions@okicici",
    },
    items: [
      { name: "Kurti (cotton)", hsn: "6204", unit: "pcs", rate: 79_900, gstRate: 5 },
      { name: "Silk dupatta", hsn: "6214", unit: "pcs", rate: 119_900, gstRate: 5 },
    ],
  },
];

/** Where each app is served in development; demo log lines point here. */
const APP_URLS = { BL: (slug: string) => `http://${slug}.localhost:3001`, EC: (slug: string) => `http://${slug}.localhost:3002` };

/** Ecommerce demo data for anbu: products with size variants and opening stock, and a welcome coupon. Idempotent. */
const ANBU_PRODUCTS = [
  {
    name: "Anarkali Kurti",
    category: "Kurtis",
    hsn: "6204",
    gstRate: 5,
    sizes: ["S", "M", "L"],
    skuPrefix: "AK",
    price: 99_900,
    mrp: 129_900,
    cost: 55_000,
    stock: 10,
  },
  {
    name: "Cotton Palazzo",
    category: "Bottoms",
    hsn: "6204",
    gstRate: 5,
    sizes: ["M", "L", "XL"],
    skuPrefix: "CP",
    price: 59_900,
    mrp: 79_900,
    cost: 30_000,
    stock: 8,
  },
  {
    name: "Silk Saree (Kanchipuram)",
    category: "Sarees",
    hsn: "5007",
    gstRate: 5,
    sizes: [] as string[],
    skuPrefix: "KS",
    price: 899_900,
    mrp: 999_900,
    cost: 600_000,
    stock: 3,
  },
];

async function seedAnbuCommerce(kit: Kit, tenantId: string) {
  const categories = new Map((await kit.catalogue.service.listCategories(tenantId)).items.map((c) => [c.name, c.id]));
  for (const p of ANBU_PRODUCTS) {
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
    log.info({ product: p.name, variants: product.variants.length }, "anbu: demo product created");
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
    log.info("anbu: coupon WELCOME10 created");
  }
}


/**
 * anbu's online store (docs/commerce-batch2.md): store settings (open, COD up to ₹5,000), delivery zones (Tamil Nadu
 * ₹40, free above ₹999, COD fee ₹30; Rest of India by weight), a "New arrivals" collection, a published home page, an
 * About page and header/footer menus. Each part is only created when missing, so owners' edits survive re-runs.
 */
async function seedAnbuStore(kit: Kit, tenantId: string) {
  const store = kit.settings.service.handle("store");
  const current = await store.get({ tenantId });
  if (!current.contactPhone) {
    await store.setTenant(tenantId, {
      open: true,
      codEnabled: true,
      codMaxAmount: 500_000,
      minOrderValue: 0,
      contactPhone: "+919876500003",
      contactEmail: "hello@anbufashions.in",
      social: { instagram: "https://instagram.com/anbufashions", whatsapp: "+919876500003" },
      policies: {
        shipping: "Orders ship in 1–2 working days. Tamil Nadu: 1–3 days, rest of India: 3–7 days.",
        returns: "Unused items can be returned within 7 days of delivery.",
        privacy: "We only use your details to deliver your order.",
        terms: "Prices include GST.",
      },
    });
    log.info("anbu: store settings saved");
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
    log.info("anbu: delivery zones created");
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
    log.info("anbu: collection new-arrivals created");
  }

  const home = await kit.cms.service.getHome(tenantId);
  if (!home.publishedAt) {
    await kit.cms.service.saveHomeDraft(tenantId, {
      sections: [
        {
          type: "hero",
          slides: [
            {
              imageUrl: "https://picsum.photos/seed/anbu-hero/1600/600",
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
    log.info("anbu: home page published");
  }

  const pages = await kit.cms.service.listPages(tenantId, {});
  if (!pages.items.some((p) => p.slug === "about")) {
    const about = await kit.cms.service.createPage(tenantId, {
      title: "About us",
      slug: "about",
      blocks: [
        { type: "heading", level: 2, text: "Anbu Fashions" },
        { type: "paragraph", markdown: "A family-run boutique from **Tiruchirappalli**, bringing you handpicked kurtis and silk sarees since 2012." },
        { type: "faq", items: [{ q: "Do you ship outside Tamil Nadu?", a: "Yes, we deliver across India in 3–7 days." }] },
      ],
    });
    await kit.cms.service.setPageStatus(tenantId, about.id, "published");
    log.info("anbu: about page published");
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
          { label: "Contact us", type: "url", href: "tel:+919876500003" },
        ],
      },
      { label: "About us", type: "url", href: "/pages/about" },
    ]);
    log.info("anbu: menus saved");
  }
}

async function seedDemoShops(kit: Kit, ownerUserId: string) {
  for (const shop of DEMO_SHOPS) {
    let tenant = await kit.tenancy.service.getBySlug(shop.slug);
    if (!tenant) {
      tenant = await kit.tenancy.service.create({ slug: shop.slug, name: shop.name, ownerUserId, appId: shop.appId });
      await kit.branding.service.update(tenant.id, { appName: shop.name, tokens: { colors: { primary: shop.primary } } });
      await kit.settings.service.handle("billing").setTenant(tenant.id, shop.billing);
      for (const item of shop.items) await kit.invoices.service.createItem(tenant.id, item);
      log.info({ slug: shop.slug }, `demo shop created — open ${APP_URLS[shop.appId](shop.slug)}`);
    } else {
      log.info({ slug: shop.slug }, "demo shop exists, data left unchanged");
    }
    if (tenant.appId !== shop.appId) tenant = await kit.tenancy.service.setApp(tenant.id, shop.appId);
    if (tenant.planId !== shop.planId) tenant = await kit.tenancy.service.setPlan(tenant.id, shop.planId);
    log.info({ slug: shop.slug, plan: tenant.planId, app: tenant.appId }, "demo shop plan set");
    if (shop.slug === "anbu") {
      await seedAnbuCommerce(kit, tenant.id);
      await seedAnbuStore(kit, tenant.id);
    }
  }
}

const kit = createKit({ ...env, REDIS_URL: "memory" }, log);

for (const plan of seedPlans.map(withAdditions)) {
  await kit.plans.service.upsertPlan(plan);
  log.info({ plan: plan.id }, "plan upserted");
}

for (const p of APP_PROFILES) {
  const saved = await kit.features.service.putProfile(p.appId, { name: p.name, features: p.features });
  log.info({ app: saved.appId, features: saved.features }, "app profile upserted");
}

if (env.SEED_SUPERADMIN) {
  const { user } = await kit.auth.service.findOrCreateByTarget(env.SEED_SUPERADMIN);
  const roles = new Set([...user.platformRoles, "superadmin"]);
  await kit.auth.service.setPlatformRoles(user.id, [...roles]);
  log.info({ userId: user.id }, "super-admin ready — sign in with OTP to this phone/email");

  if (process.env.SEED_DEMO !== "false") await seedDemoShops(kit, user.id);
}

await kit.stop();
