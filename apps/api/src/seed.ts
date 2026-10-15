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

/** App profiles (docs/features.md): a feature key grants that feature, `module.*` the whole module. */
const APP_PROFILES: { appId: string; name: string; features: string[] }[] = [
  { appId: "BL", name: "Billing", features: ["invoices.*", "inventory.*", "payments.*"] },
  {
    appId: "EC",
    name: "Ecommerce",
    features: ["invoices", "invoices.whatsapp", "invoices.reports", "invoices.gst-reports", "inventory", "payments"],
  },
];

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
  }
}

const kit = createKit({ ...env, REDIS_URL: "memory" }, log);

for (const plan of seedPlans) {
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
