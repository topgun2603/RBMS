import { pino } from "pino";
import { E2eCleanup } from "./e2e-cleanup";
import { env } from "./env";
import { createKit } from "./kit";
import { appPlanId, ensureShop, seedPlansAndProfiles, seedStoreCatalogue, seedStoreContent, type ShopSpec } from "./seed-fixtures";

/**
 * Dedicated shops for the end-to-end scripts (apps/api/test/e2e), so test runs never touch the demo shops:
 *
 * - e2e-bill  (app BL, plan pro)     → test/e2e/billing.mjs: billing items, credit book, purchases, online payment.
 * - e2e-store (app EC, plan pro)     → batch1.mjs + batch2.mjs: products with variants, WELCOME10, delivery zones,
 *                                      published home, about page, menus, store settings.
 * - e2e-lite  (app BL, plan starter) → the plan checks (no purchases, no custom domain below pro).
 *
 * All are owned by e2e-owner@example.com, who signs in with the dev test OTP (TEST_OTP_CODE / TEST_OTP_TARGETS). This
 * seed also makes e2e-owner a super-admin, for the steps that need the platform team (forcing a custom domain).
 * Only ever run it against development databases.
 *
 * Idempotent: creates what is missing, resets app/plan, and archives "E2E …" products of earlier runs so lists the
 * scripts read stay short.   pnpm --filter @rbms/api seed:e2e
 */
export const E2E_OWNER = "e2e-owner@example.com";

const SHOPS: ShopSpec[] = [
  {
    slug: "e2e-bill",
    appId: "BL",
    planId: "pro",
    name: "E2E Billing",
    primary: "#0f766e",
    billing: {
      legalName: "E2E Billing",
      gstin: "33AABFR1234K1ZI",
      address: "1, Test Street",
      city: "Coimbatore",
      pincode: "641001",
      stateCode: "33",
      phone: "+919999000001",
      invoicePrefix: "EB",
      upiId: "e2ebilling@okaxis",
    },
    items: [
      { name: "Cotton saree", hsn: "5208", unit: "pcs", rate: 85_000, gstRate: 5 },
      { name: "Silk saree", hsn: "5007", unit: "pcs", rate: 650_000, gstRate: 5 },
      { name: "Cotton shirting fabric", hsn: "5208", unit: "m", rate: 12_050, gstRate: 5 },
      { name: "Readymade shirt", hsn: "6205", unit: "pcs", rate: 149_900, gstRate: 12 },
    ],
  },
  {
    slug: "e2e-store",
    appId: "EC",
    planId: "pro",
    name: "E2E Store",
    primary: "#7c3aed",
    billing: {
      legalName: "E2E Store Online",
      address: "8, Nethaji Road",
      city: "Tiruchirappalli",
      pincode: "620001",
      stateCode: "33",
      phone: "+919999000003",
      invoicePrefix: "ES",
      upiId: "e2estore@okicici",
    },
    items: [
      { name: "Kurti (cotton)", hsn: "6204", unit: "pcs", rate: 79_900, gstRate: 5 },
      { name: "Silk dupatta", hsn: "6214", unit: "pcs", rate: 119_900, gstRate: 5 },
    ],
  },
  {
    slug: "e2e-lite",
    appId: "BL",
    planId: "starter",
    name: "E2E Lite",
    primary: "#1d4ed8",
    billing: {
      legalName: "E2E Lite Stores",
      address: "45, Gandhi Road",
      city: "Madurai",
      pincode: "625001",
      stateCode: "33",
      phone: "+919999000002",
      invoicePrefix: "EL",
      upiId: "e2elite@okhdfcbank",
    },
    items: [
      { name: "Rice (Ponni) 25 kg", hsn: "1006", unit: "bag", rate: 145_000, gstRate: 5 },
      { name: "Sunflower oil 1 L", hsn: "1512", unit: "pcs", rate: 16_500, gstRate: 5 },
    ],
  },
];

const log = pino({ level: "info" });
if (env.NODE_ENV === "production") throw new Error("seed:e2e is for development databases only");
const kit = createKit({ ...env, REDIS_URL: "memory" }, log);

try {
  await seedPlansAndProfiles(kit, log);
  const { user } = await kit.auth.service.findOrCreateByTarget(E2E_OWNER, { name: "E2E Owner" });
  if (!user.platformRoles.includes("superadmin")) await kit.auth.service.setPlatformRoles(user.id, [...user.platformRoles, "superadmin"]);
  log.info({ userId: user.id }, `e2e owner ${E2E_OWNER} ready (super-admin; signs in with the test OTP)`);

  for (const shop of SHOPS) {
    const { tenant, created } = await ensureShop(kit, shop, user.id);
    // Shops created before the owner existed (or edited by hand) still get the e2e owner.
    if (!created && !(await kit.tenancy.service.rolesFor(tenant.id, user.id)).includes("owner")) {
      await kit.tenancy.service.addMember(tenant.id, user.id, ["owner"]);
    }
    if (shop.slug === "e2e-store") {
      await seedStoreCatalogue(kit, tenant.id, log, shop.slug);
      await seedStoreContent(
        kit,
        tenant.id,
        {
          shopName: shop.name,
          contactPhone: shop.billing.phone!,
          contactEmail: "hello@e2e-store.example.com",
          instagram: "https://instagram.com/e2estore",
          aboutText: "The shop the **end-to-end tests** run against.",
        },
        log,
        shop.slug,
      );
    }
    // Batch 5: whatever plan & billing tests did to the shop, it is back on its plan as an active, open-ended,
    // no-charge (manual) subscription, so the scripts' feature and plan checks hold.
    // Plans are per app: the shop's app plan ("bl-pro"), not the shared tier template ("pro").
    const planId = appPlanId(shop.appId, shop.planId);
    const s = await kit.subscriptions.service.get(tenant.id);
    if (!s || s.status !== "active" || s.provider !== "manual" || s.planId !== planId || s.cancelAtPeriodEnd || s.pendingPlanId || s.currentPeriodEnd) {
      await kit.subscriptions.service.comp(tenant.id, { planId, until: null }, { userId: null });
      log.info({ slug: shop.slug, plan: planId, was: s ? `${s.status} ${s.planId} ${s.provider}` : "none" }, "e2e shop subscription reset");
    }
    const pruned = await new E2eCleanup(kit, tenant.id, log).productsOnly();
    log.info({ slug: shop.slug, plan: tenant.planId, app: tenant.appId, created, pruned }, "e2e shop ready");
  }
} catch (err) {
  log.error(err, "seed:e2e failed");
  process.exitCode = 1;
} finally {
  await kit.stop();
}
