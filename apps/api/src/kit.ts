import { createAuth } from "@srirealtime/auth";
import { createBranding } from "@srirealtime/branding";
import { createAudit } from "@srirealtime/audit";
import { createCatalogue } from "@srirealtime/catalogue";
import { createConsent } from "@srirealtime/consent";
import { createCoupons } from "@srirealtime/coupons";
import { createDocuments, type DocSeller } from "@srirealtime/documents";
import { createImportExport } from "@srirealtime/importexport";
import { todayIST } from "@srirealtime/gst";
import { createOrders, type Order } from "@srirealtime/orders";
import { createStaff } from "@srirealtime/staff";
import type { SrModule } from "@srirealtime/core";
import { createDb } from "@srirealtime/db";
import { createFeatures } from "@srirealtime/features";
import { createI18n } from "@srirealtime/i18n";
import { createInventory } from "@srirealtime/inventory";
import { createInvoices } from "@srirealtime/invoices";
import { createJobs } from "@srirealtime/jobs";
import { createNotify, type NotifyConfig } from "@srirealtime/notify";
import { createPayments } from "@srirealtime/payments";
import { createPlans } from "@srirealtime/plans";
import { createSettings } from "@srirealtime/settings";
import { createTenancy } from "@srirealtime/tenancy";
import { createUploads, LocalStorage, S3Storage, type StorageAdapter } from "@srirealtime/uploads";
import type { Logger } from "pino";
import type { Env } from "./env";
import { defineAppSettings } from "./app-settings";
import { documentPorts, registerImportExport } from "./kit-io";
import { CATALOGUE_PERMISSION_DEFS, INVENTORY_PERMISSION_DEFS, INVOICE_PERMISSIONS, routePermissions } from "./permissions";

/**
 * Composition root: builds every module and connects them through their ports.
 * Packages never import each other; all cross-module wiring lives here.
 */
export function createKit(env: Env, log: Logger) {
  const { db, close: closeDb } = createDb(env.DATABASE_URL);

  const jobs = createJobs({ redisUrl: env.REDIS_URL, log });

  const settings = createSettings({ db });
  const i18n = createI18n({ db });

  // plans before tenancy so tenancy can invalidate cached entitlements when a plan changes.
  const plans = createPlans({ db });

  // Auth is created after tenancy but tenancy needs auth to invite by phone/email: late-bound.
  let resolveTarget: ((target: string) => Promise<string>) | undefined;
  const tenancy = createTenancy({
    db,
    rootDomain: env.ROOT_DOMAIN,
    onPlanChange: (tenantId) => {
      plans.service.invalidate(tenantId);
      features.service.invalidate(tenantId);
    },
    onAppChange: (tenantId) => features.service.invalidate(tenantId),
    resolveMemberTarget: (target) => resolveTarget!(target),
  });

  // Feature switches: registry = every mounted module's features (read lazily, `modules` is built below).
  const features = createFeatures({
    db,
    registry: () => modules.flatMap((m) => m.features ?? []),
    plans: plans.service,
    tenants: tenancy.service,
    log,
  });

  const branding = createBranding({ db, defaultAppName: env.APP_NAME });

  const notify = createNotify({
    db,
    config: notifyConfig(env),
    queue: jobs.service,
    log,
    contacts: {
      contactFor: async (userId) => {
        const user = await auth.service.getUser(userId);
        return { phone: user?.phone, email: user?.email, locale: user?.locale };
      },
    },
  });

  const auth = createAuth({
    db,
    config: {
      sessionTtlDays: env.SESSION_TTL_DAYS,
      otpTtlMinutes: env.OTP_TTL_MINUTES,
      googleClientIds: env.GOOGLE_CLIENT_ID ? [env.GOOGLE_CLIENT_ID] : [],
    },
    otp: notify.service,
    memberships: tenancy.service,
    // Resolved per request; staff is created below.
    permissions: { permissionsFor: (tenantId, roles) => staff.resolver.permissionsFor(tenantId, roles) },
    log,
  });
  resolveTarget = async (target) => (await auth.service.findOrCreateByTarget(target)).user.id;

  const uploads = createUploads({
    db,
    config: { storage: storageFor(env), publicBaseUrl: env.PUBLIC_UPLOAD_BASE_URL },
    log,
  });

  const consent = createConsent({ db, queue: jobs.service, log });
  // Erasers run in reverse registration order, so auth (registered first) anonymises the user last.
  consent.service.registerExporter("auth", (userId) => auth.service.exportUser(userId));
  consent.service.registerEraser("auth", (userId) => auth.service.eraseUser(userId));
  consent.service.registerExporter("tenancy", async (userId) =>
    (await tenancy.service.tenantsForUser(userId)).map((t) => ({ tenant: t.tenant.slug, roles: t.roles })),
  );

  jobs.service.define("uploads.cleanup", async () => {
    await uploads.service.cleanupPending(new Date(Date.now() - 24 * 3_600_000));
  });

  defineAppSettings(settings.service);

  const billingProfile = settings.service.handle("billing");

  const payments = createPayments({
    db,
    config: {
      encryptionKey: env.APP_SECRET,
      allowMock: env.NODE_ENV !== "production",
      webhookBaseUrl: env.API_PUBLIC_URL,
    },
    shopName: async (tenantId) => (await branding.service.get(tenantId)).appName ?? (await tenancy.service.getById(tenantId))?.name,
    featureGate: features.gate,
    log,
  });

  // The one product list for billing, the store and POS. Billing items and inventory items are its variants.
  const catalogue = createCatalogue({ db, featureGate: features.gate, log });

  const audit = createAudit({ db, log });
  const staff = createStaff({
    db,
    registry: () => modules.flatMap((m) => m.permissions ?? []),
    memberships: tenancy.service,
    // auth is created further down; these run per request, long after.
    users: {
      getUsers: (ids) => auth.service.getUsers(ids),
      findOrCreateByTarget: async (target) => ({ id: (await auth.service.findOrCreateByTarget(target)).user.id }),
    },
    quota: plans.service,
    audit: audit.service,
    log,
  });

  // Invoices and inventory need each other (stock on sale, item details for stock): late-bound.
  let inventoryRef: ReturnType<typeof createInventory> | undefined;

  const invoices = createInvoices({
    items: catalogue.itemSource,
    db,
    seller: { get: (tenantId) => billingProfile.get({ tenantId }) },
    entitlements: plans.service,
    branding: {
      get: async (tenantId) => {
        const b = await branding.service.get(tenantId);
        return { appName: b.appName, logoUrl: b.logoUrl, css: b.css };
      },
    },
    publicBaseUrl: async (tenantId) => {
      const tenant = await tenancy.service.getById(tenantId);
      return billingUrlFor(env.BILLING_PUBLIC_URL, tenant?.appId ?? null).replace("{slug}", tenant?.slug ?? "");
    },
    stock: {
      // Stock only moves for shops with the inventory feature on; reversal stays unconditional (idempotent per bill).
      applySale: async (tenantId, sale) =>
        (await features.service.isEnabled(tenantId, "inventory")) ? inventoryRef!.service.applySale(tenantId, sale) : null,
      reverseSale: (tenantId, refId) => inventoryRef!.service.reverseSale(tenantId, refId),
    },
    notifier: {
      send: async ({ tenantId, channel, to, template, vars, locale }) => ({
        logId: (await notify.service.send({ tenantId, channel, to, template, vars, locale })).logId,
      }),
    },
    paymentsAvailability: payments.service,
    featureGate: features.gate,
    log,
  });

  const inventory = createInventory({
    db,
    catalog: catalogue.itemCatalog,
    sellerState: {
      stateCode: async (tenantId) => {
        const code = (await billingProfile.get({ tenantId })).stateCode;
        return typeof code === "string" && code ? code : null;
      },
    },
    log,
  });
  inventoryRef = inventory;

  payments.service.registerPurpose("invoice", {
    resolve: (ref) => invoices.service.paymentTarget(ref),
    onPaid: async (p) => {
      await invoices.service.recordOnlinePayment({ ...p, invoiceId: p.purposeId });
    },
  });

  const coupons = createCoupons({ db });
  const orderSettings = settings.service.handle("orders");

  const orders = createOrders({
    db,
    catalog: {
      // Store orders may only contain active products sold in the store.
      getVariants: async (tenantId, ids, opts) => {
        const found = await catalogue.service.getVariants(tenantId, ids);
        return opts?.channel
          ? found.filter((v) => v.status === "active" && v.channels.includes(opts.channel as (typeof v.channels)[number]))
          : found;
      },
    },
    seller: {
      get: async (tenantId) => {
        const p = await billingProfile.get({ tenantId });
        return { stateCode: (p.stateCode as string) || null, legalName: (p.legalName as string) || null };
      },
    },
    settings: { get: (tenantId) => orderSettings.get({ tenantId }) },
    stock: {
      reserve: async (tenantId, r) =>
        (await features.service.isEnabled(tenantId, "inventory")) ? inventory.service.reserve(tenantId, r) : null,
      release: (tenantId, refType, refId) => inventory.service.release(tenantId, refType, refId),
      commit: (tenantId, refType, refId) => inventory.service.commit(tenantId, refType, refId),
    },
    invoicing: {
      createFromOrder: (tenantId, order) => invoiceFromOrder(tenantId, order),
      cancelInvoice: async (tenantId, invoiceId, reason) => {
        await invoices.service.cancel(tenantId, invoiceId, reason);
      },
    },
    coupons: coupons.service,
    notifier: {
      send: async ({ tenantId, channel, to, template, vars, locale }) => ({
        logId: (await notify.service.send({ tenantId, channel, to, template, vars, locale })).logId,
      }),
    },
    shopContacts: {
      ownerContacts: async (tenantId) => {
        const members = await tenancy.service.listMembers(tenantId);
        const ids = members.filter((m) => m.roles.includes("owner") || m.roles.includes("admin")).map((m) => m.userId);
        return (await auth.service.getUsers(ids)).map((u) => ({ phone: u.phone, email: u.email }));
      },
    },
    featureGate: features.gate,
    log,
  });

  /**
   * The GST invoice for an order. Lines carry no `itemId`: the order already moves stock (reserve → commit), so the
   * invoice must not deduct it a second time. Shipping becomes its own taxed line (SAC 996812).
   */
  async function invoiceFromOrder(tenantId: string, order: Order) {
    const tenant = await tenancy.service.getRef(tenantId);
    if (!tenant) throw new Error(`Tenant ${tenantId} not found`);
    const ship = order.shippingAddress;
    const lines = order.lines.map((l) => ({
      description: l.sku ? `${l.name} (${l.sku})` : l.name,
      hsn: l.hsn ?? undefined,
      qty: l.qty,
      unit: l.unit,
      rate: l.rate,
      discount: l.discount || undefined,
      gstRate: l.gstRate,
    }));
    const s = order.totals.shippingLine;
    if (s) lines.push({ description: "Shipping charges", hsn: s.hsn ?? "996812", qty: 1, unit: "job", rate: s.rate, discount: undefined, gstRate: s.gstRate });
    const invoice = await invoices.service.create(tenant, {
      customer: {
        name: order.customer.name,
        phone: order.customer.phone ?? undefined,
        email: order.customer.email ?? undefined,
        address: ship ? [ship.line1, ship.line2, ship.city, ship.pincode].filter(Boolean).join(", ") : undefined,
        stateCode: ship?.stateCode,
      },
      date: todayIST(),
      placeOfSupply: order.totals.placeOfSupply,
      lines,
      notes: `Order ${order.number}`,
      issue: true,
    });
    if (order.paid > 0 && invoice.balance > 0) {
      await invoices.service.addPayment(tenantId, invoice.id, {
        amount: Math.min(order.paid, invoice.balance),
        method: order.paymentMethod === "cash" || order.paymentMethod === "upi" || order.paymentMethod === "card" ? order.paymentMethod : "other",
        date: todayIST(),
        reference: `Order ${order.number}`,
      });
    }
    return { invoiceId: invoice.id, number: invoice.number ?? "" };
  }

  payments.service.registerPurpose("order", {
    resolve: (ref) => orders.service.paymentTarget(ref),
    onPaid: async (p) => {
      await orders.service.recordOnlinePayment({
        tenantId: p.tenantId,
        orderId: p.purposeId,
        amount: p.amount,
        method: p.method,
        provider: p.provider,
        providerPaymentId: p.providerPaymentId,
        paidAt: p.paidAt,
      });
    },
  });

  // ---- PDFs: data through ports over the invoices, orders and inventory services.
  const sellerDoc = async (tenantId: string): Promise<DocSeller> => {
    const p = await billingProfile.get({ tenantId });
    const str = (k: string) => (typeof p[k] === "string" && p[k] ? (p[k] as string) : null);
    return {
      legalName: str("legalName"),
      gstin: str("gstin"),
      address: str("address"),
      city: str("city"),
      pincode: str("pincode"),
      stateCode: str("stateCode"),
      phone: str("phone"),
      email: str("email"),
      terms: str("terms"),
      bankName: str("bankName"),
      accountNumber: str("accountNumber"),
      ifsc: str("ifsc"),
      upiId: str("upiId"),
    };
  };
  const documents = createDocuments({
    config: { env: process.env },
    ...documentPorts({
      invoices: invoices.service,
      orders: orders.service,
      inventory: inventory.service,
      catalogue: catalogue.service,
      seller: sellerDoc,
      isEnabled: (tenantId, key) => features.service.isEnabled(tenantId, key),
      branding: async (tenantId) => {
        const b = await branding.service.get(tenantId);
        return { appName: b.appName, logoUrl: b.logoUrl, css: b.css, primary: b.tokens.colors?.primary ?? null };
      },
    }),
    log,
  });

  // ---- CSV/XLSX import and export. Importers/exporters must be registered before the routes are mounted.
  const importExport = createImportExport({ db, queue: jobs.service, features: features.gate, log });
  registerImportExport(importExport.registry, { catalogue: catalogue.service, invoices: invoices.service, inventory: inventory.service });

  // Permissions of modules whose packages don't declare them on their module (staff lists them for custom roles).
  invoices.module.permissions = INVOICE_PERMISSIONS;
  catalogue.module.permissions = CATALOGUE_PERMISSION_DEFS;
  inventory.module.permissions = INVENTORY_PERMISSION_DEFS;

  jobs.service.define("audit.purge", async () => {
    await audit.service.purge();
  });

  jobs.service.define("invoices.reminders", async () => {
    const result = await invoices.service.runReminders(new Date());
    log.info(result, "invoice reminders run");
  });
  jobs.service.define("payments.retry", async () => {
    await payments.service.retryPending();
  });

  const modules: SrModule[] = [
    jobs.module,
    settings.module,
    i18n.module,
    tenancy.module,
    auth.module,
    plans.module,
    features.module,
    branding.module,
    notify.module,
    uploads.module,
    consent.module,
    invoices.module,
    payments.module,
    inventory.module,
    catalogue.module,
    staff.module,
    audit.module,
    orders.module,
    coupons.module,
    documents.module,
    ...importExport.modules,
  ];

  return {
    db,
    jobs,
    settings,
    i18n,
    plans,
    tenancy,
    features,
    branding,
    notify,
    auth,
    uploads,
    consent,
    invoices,
    payments,
    inventory,
    catalogue,
    staff,
    audit,
    orders,
    coupons,
    documents,
    importExport,
    modules,
    /** Host-side `config.permission` for the billing, inventory, catalogue, orders and coupons routes. */
    routeRules: routePermissions(),
    /** Order matters: tenancy resolves the tenant, then auth loads the user's roles in it. */
    contextHooks: [tenancy.contextHook, auth.contextHook],
    /** Global preHandlers, after the context hooks: each route's `config.feature`, then `config.permission`. */
    preHandlers: [features.preHandler, staff.preHandler],
    /** Records every successful mutating request in the audit log. */
    onResponse: [audit.onResponse],
    async start() {
      for (const m of modules) await m.start?.();
      await jobs.service.schedule("consent.sweep", "0 * * * *");
      await jobs.service.schedule("uploads.cleanup", "30 3 * * *");
      await jobs.service.schedule("invoices.reminders", "0 10 * * *");
      await jobs.service.schedule("payments.retry", "*/15 * * * *");
      await jobs.service.schedule("audit.purge", "15 4 * * *");
    },
    async stop() {
      for (const m of [...modules].reverse()) await m.stop?.();
      await closeDb();
    },
  };
}

export type Kit = ReturnType<typeof createKit>;

/**
 * BILLING_PUBLIC_URL is either one template ("http://{slug}.localhost:3001") or per-app templates
 * ("BL=http://{slug}.localhost:3001,EC=http://{slug}.localhost:3002/billing"): each app mounts the billing module at
 * its own address. Shops whose app isn't listed use the first entry.
 */
export function billingUrlFor(setting: string, appId: string | null): string {
  if (!setting.includes("=")) return setting;
  const entries = setting.split(",").map((e) => {
    const i = e.indexOf("=");
    return [e.slice(0, i).trim(), e.slice(i + 1).trim()] as const;
  });
  return (entries.find(([app]) => app === appId) ?? entries[0])?.[1] ?? "";
}

function notifyConfig(env: Env): NotifyConfig {
  return {
    appName: env.APP_NAME,
    msg91:
      env.MSG91_AUTH_KEY && env.MSG91_SENDER_ID
        ? {
            authKey: env.MSG91_AUTH_KEY,
            senderId: env.MSG91_SENDER_ID,
            flowIds: env.MSG91_OTP_FLOW_ID ? { "auth.otp": env.MSG91_OTP_FLOW_ID } : {},
          }
        : undefined,
    resend: env.RESEND_API_KEY ? { apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM } : undefined,
    whatsapp:
      env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_NUMBER_ID
        ? { token: env.WHATSAPP_TOKEN, phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID }
        : undefined,
    fcm: env.FCM_SERVICE_ACCOUNT_JSON ? { serviceAccountJson: env.FCM_SERVICE_ACCOUNT_JSON } : undefined,
  };
}

function storageFor(env: Env): StorageAdapter {
  if (env.STORAGE_DRIVER === "s3") {
    return new S3Storage({
      bucket: env.S3_BUCKET!,
      region: env.S3_REGION,
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: Boolean(env.S3_ENDPOINT),
      credentials:
        env.S3_ACCESS_KEY_ID && env.S3_SECRET_ACCESS_KEY
          ? { accessKeyId: env.S3_ACCESS_KEY_ID, secretAccessKey: env.S3_SECRET_ACCESS_KEY }
          : undefined,
      publicBaseUrl: env.PUBLIC_UPLOAD_BASE_URL,
    });
  }
  return new LocalStorage({ dir: env.STORAGE_LOCAL_DIR, apiBaseUrl: env.API_PUBLIC_URL, secret: env.APP_SECRET });
}
