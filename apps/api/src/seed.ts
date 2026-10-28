import { pino } from "pino";
import { env } from "./env";
import { createKit, type Kit } from "./kit";
import { ensureShop, seedPlansAndProfiles, seedRestaurantSetup, seedStoreCatalogue, seedStoreContent, STORE_PRODUCTS, type ShopSpec } from "./seed-fixtures";
import { seedProductImages } from "./seed-images";
import { DEMO_STORES, seedDemoStore } from "./demo-stores";

/**
 * Idempotent. Upserts the default plans and app profiles and, if SEED_SUPERADMIN is set, grants that user super-admin
 * and (unless SEED_DEMO=false) creates demo shops owned by them: two Billing shops (raja → pro, kumar → starter) and one
 * Ecommerce shop (anbu → pro, app EC: billing without credit book, reminders or purchases). Existing demo shops get
 * their plan and app set on every run. Shared fixtures live in seed-fixtures.ts; the e2e shops in seed-e2e.ts.
 */
const log = pino({ level: "info" });

const DEMO_SHOPS: ShopSpec[] = [
  {
    slug: "raja",
    appId: "BL",
    businessType: "fashion",
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
    businessType: "grocery",
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
    businessType: "fashion",
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
  {
    slug: "glow",
    appId: "SV",
    businessType: "salon",
    planId: "pro",
    name: "Glow Salon & Spa",
    primary: "#b08d3c",
    billing: {
      legalName: "Glow Salon and Spa",
      gstin: "33AAGFG2468S1ZU",
      address: "14, Race Course Road",
      city: "Coimbatore",
      pincode: "641018",
      stateCode: "33",
      phone: "+919876500006",
      invoicePrefix: "GS",
      upiId: "glowsalon@okicici",
    },
    items: [
      { name: "Haircut & styling", hsn: "999721", unit: "service", rate: 50_000, gstRate: 18 },
      { name: "Hair spa (45 min)", hsn: "999721", unit: "service", rate: 120_000, gstRate: 18 },
      { name: "Facial (60 min)", hsn: "999722", unit: "service", rate: 150_000, gstRate: 18 },
      { name: "Bridal makeup", hsn: "999722", unit: "service", rate: 1_500_000, gstRate: 18 },
    ],
  },
  {
    slug: "quickfix",
    appId: "SV",
    businessType: "repair",
    planId: "pro",
    name: "QuickFix Mobile Care",
    primary: "#3b82f6",
    billing: {
      legalName: "QuickFix Mobile Care",
      gstin: "33AAQFQ1357R1ZI",
      address: "3, Gandhipuram 100 Feet Road",
      city: "Coimbatore",
      pincode: "641012",
      stateCode: "33",
      phone: "+919876500007",
      invoicePrefix: "QF",
      upiId: "quickfix@okaxis",
    },
    items: [
      { name: "Screen replacement (labour)", hsn: "998713", unit: "service", rate: 50_000, gstRate: 18 },
      { name: "Battery replacement (labour)", hsn: "998713", unit: "service", rate: 30_000, gstRate: 18 },
      { name: "Display unit (OEM)", hsn: "8517", unit: "pcs", rate: 450_000, gstRate: 18 },
      { name: "Battery 5000 mAh", hsn: "8507", unit: "pcs", rate: 150_000, gstRate: 18 },
    ],
  },
  {
    slug: "ironfit",
    appId: "SV",
    businessType: "gym",
    planId: "pro",
    name: "IronFit Gym",
    primary: "#dc2626",
    billing: {
      legalName: "IronFit Fitness Studio",
      gstin: "33AAIFI8642G1ZB",
      address: "27, Avinashi Road",
      city: "Coimbatore",
      pincode: "641037",
      stateCode: "33",
      phone: "+919876500008",
      invoicePrefix: "IF",
      upiId: "ironfit@okhdfcbank",
    },
    items: [
      { name: "Monthly membership", hsn: "999723", unit: "month", rate: 150_000, gstRate: 18 },
      { name: "Personal training session", hsn: "999723", unit: "session", rate: 80_000, gstRate: 18 },
      { name: "Whey protein 1 kg", hsn: "2106", unit: "pcs", rate: 320_000, gstRate: 18 },
    ],
  },
  {
    slug: "techzone",
    appId: "EC",
    businessType: "electronics",
    planId: "pro",
    name: "TechZone Mobiles",
    primary: "#0f766e",
    billing: {
      legalName: "TechZone Mobiles",
      gstin: "33AATFT4826M1ZI",
      address: "52, Cross Cut Road",
      city: "Coimbatore",
      pincode: "641012",
      stateCode: "33",
      phone: "+919876500009",
      invoicePrefix: "TZ",
      upiId: "techzone@okaxis",
    },
    items: [
      { name: "Galaxy M35 5G 8/128", hsn: "8517", unit: "pcs", rate: 1_699_900, gstRate: 18 },
      { name: "Redmi Note 13 6/128", hsn: "8517", unit: "pcs", rate: 1_499_900, gstRate: 18 },
      { name: "boAt Airdopes 141", hsn: "8518", unit: "pcs", rate: 129_900, gstRate: 18 },
      { name: "20W USB-C charger", hsn: "8504", unit: "pcs", rate: 89_900, gstRate: 18 },
    ],
  },
  {
    slug: "lakshmi",
    appId: "EC",
    businessType: "jewellery",
    planId: "pro",
    name: "Lakshmi Jewellers",
    primary: "#a16207",
    billing: {
      legalName: "Lakshmi Jewellers",
      gstin: "33AALFL7391J1ZU",
      address: "8, Big Bazaar Street",
      city: "Coimbatore",
      pincode: "641001",
      stateCode: "33",
      phone: "+919876500010",
      invoicePrefix: "LJ",
      upiId: "lakshmijewellers@okhdfcbank",
    },
    items: [
      { name: "22K gold chain 16 g", hsn: "7113", unit: "pcs", rate: 10_000_000, gstRate: 3 },
      { name: "22K gold ring 4 g", hsn: "7113", unit: "pcs", rate: 2_500_000, gstRate: 3 },
      { name: "Silver anklet pair", hsn: "7113", unit: "pcs", rate: 450_000, gstRate: 3 },
    ],
  },
];

/** Where each app is served in development; demo log lines point here. */
const APP_URLS = {
  BL: (slug: string) => `http://${slug}.localhost:3001`,
  EC: (slug: string) => `http://${slug}.localhost:3002`,
  PH: (slug: string) => `http://${slug}.localhost:3006`,
  RS: (slug: string) => `http://${slug}.localhost:3007`,
  SV: (slug: string) => `http://${slug}.localhost:3008`,
  SC: (slug: string) => `http://${slug}.localhost:3009`,
};

async function seedDemoShops(kit: Kit, ownerUserId: string) {
  for (const shop of DEMO_SHOPS) {
    const { tenant, created } = await ensureShop(kit, shop, ownerUserId);
    if (created && shop.businessType) await kit.starter.apply({ id: tenant.id, name: tenant.name, appId: tenant.appId, slug: tenant.slug, planId: tenant.planId }, shop.businessType);
    if (created) log.info({ slug: shop.slug }, `demo shop created — open ${APP_URLS[shop.appId](shop.slug)}`);
    else log.info({ slug: shop.slug }, "demo shop exists, data left unchanged");
    log.info({ slug: shop.slug, plan: tenant.planId, app: tenant.appId }, "demo shop plan set");
    if (shop.appId === "RS") await seedRestaurantSetup(kit, tenant.id, log, shop.slug);
    if (shop.slug === "anbu") {
      await seedStoreCatalogue(kit, tenant.id, log, "anbu");
      // Generated placeholder pictures for the demo products that have none (owners' pictures are kept).
      await seedProductImages(kit, tenant.id, log, "anbu", {
        names: [...STORE_PRODUCTS.map((p) => p.name), ...shop.items.map((i) => i.name)],
        shopName: shop.name,
      });
      await seedStoreContent(
        kit,
        tenant.id,
        {
          shopName: "Anbu Fashions",
          contactPhone: "+919876500003",
          contactEmail: "hello@anbufashions.in",
          instagram: "https://instagram.com/anbufashions",
          aboutText: "A family-run boutique from **Tiruchirappalli**, bringing you handpicked kurtis and silk sarees since 2012.",
        },
        log,
        "anbu",
      );
    }
  }
}

const kit = createKit({ ...env, REDIS_URL: "memory" }, log);

await seedPlansAndProfiles(kit, log);

if (env.SEED_SUPERADMIN) {
  const { user } = await kit.auth.service.findOrCreateByTarget(env.SEED_SUPERADMIN);
  const roles = new Set([...user.platformRoles, "superadmin"]);
  await kit.auth.service.setPlatformRoles(user.id, [...roles]);
  log.info({ userId: user.id }, "super-admin ready — sign in with OTP to this phone/email");

  if (process.env.SEED_DEMO !== "false") {
    await seedDemoShops(kit, user.id);
    // The demo stores of the store-look series (demo-stores/): a full catalogue, home, pages and photos each.
    for (const store of DEMO_STORES) await seedDemoStore(kit, store, user.id, log);
  }
}

await kit.stop();
