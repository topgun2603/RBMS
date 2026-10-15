import { createHash } from "node:crypto";
import { createAnalytics, ANALYTICS_JOBS } from "@srirealtime/analytics";
import { createAuth } from "@srirealtime/auth";
import { createBranding } from "@srirealtime/branding";
import { createAudit } from "@srirealtime/audit";
import { CATALOGUE_VENDOR_ROUTE_KEYS, createCatalogue, isPublicRef } from "@srirealtime/catalogue";
import { createCms } from "@srirealtime/cms";
import { createConsent } from "@srirealtime/consent";
import { createCoupons } from "@srirealtime/coupons";
import { createDelivery, DELIVERY_TRACK_JOB } from "@srirealtime/delivery";
import { createDocuments, type DocSeller } from "@srirealtime/documents";
import { createExpenses } from "@srirealtime/expenses";
import { createImportExport } from "@srirealtime/importexport";
import { todayIST } from "@srirealtime/gst";
import { createOrders, type Order } from "@srirealtime/orders";
import { createOnboarding } from "@srirealtime/onboarding";
import { createReviews } from "@srirealtime/reviews";
import { createStaff } from "@srirealtime/staff";
import { createStorefront } from "@srirealtime/storefront";
import { isSuperAdmin, type SrModule } from "@srirealtime/core";
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
import { createTenancy, TENANCY_JOBS } from "@srirealtime/tenancy";
import { createUploads, LocalStorage, S3Storage, type StorageAdapter } from "@srirealtime/uploads";
import type { FastifyRequest } from "fastify";
import type { Logger } from "pino";
import type { Env } from "./env";
import { testOtpConfig } from "./test-otp";
import { defineAppSettings } from "./app-settings";
import { documentPorts, registerImportExport } from "./kit-io";
import {
  catalogueAvailability,
  cmsCatalogPort,
  dnsDomainVerifier,
  fulfillmentPort,
  storeAvailabilityPort,
  storeBaseUrl,
  storeCatalogPort,
  storeOrdersPort,
} from "./kit-store";
import {
  CATALOGUE_PERMISSION_DEFS,
  guestTicketGuard,
  INVENTORY_PERMISSION_DEFS,
  INVOICE_PERMISSIONS,
  LOYALTY_HOST_PERMISSIONS,
  ROUTE_GUARDS,
  ROUTE_PERMISSIONS,
  routePermissions,
} from "./permissions";
import { createBatch3, type Batch3 } from "./kit-batch3";
import { MARKETPLACE_PAYOUT_REFRESH_JOB, MARKETPLACE_SETTLE_JOB } from "@srirealtime/marketplace";
import { DEVELOPER_JOBS } from "@srirealtime/developer";
import { orders as ordersTable } from "@srirealtime/orders";
import type { Invoice } from "@srirealtime/invoices";
import { and, eq } from "@srirealtime/db";

/**
 * Composition root: builds every module and connects them through their ports.
 * Packages never import each other; all cross-module wiring lives here.
 */
export function createKit(env: Env, log: Logger) {
  const { db, close: closeDb } = createDb(env.DATABASE_URL);

  const jobs = createJobs({ redisUrl: env.REDIS_URL, log });
  /** Handlers of the jobs defined here, so scripts can run one right away (`pnpm --filter @srirealtime/api job <name>`). */
  const jobHandlers = new Map<string, () => Promise<void>>();
  const defineJob = (name: string, handler: () => Promise<void>) => {
    jobHandlers.set(name, handler);
    jobs.service.define(name, handler);
  };

  // Batch 3 (kit-batch3.ts) is created after the modules it builds on; the hooks below reach it lazily.
  let b3: Batch3 | undefined;
  /** Developer webhooks (EventsPort). Never throws; a no-op until batch 3 exists. */
  const emit = (tenantId: string, type: string, data: unknown) => (b3 ? b3.events.emit(tenantId, type, data) : Promise.resolve());
  const events = { emit };

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
    domainVerifier: dnsDomainVerifier(env.CNAME_TARGET),
    cnameTarget: env.CNAME_TARGET,
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

  // Fixed OTP for test identities (e2e scripts); never in production (testOtpConfig drops it there).
  const { testOtp, note: testOtpNote } = testOtpConfig(env);
  if (testOtpNote) log.warn({ targets: testOtp?.targets ?? [] }, `auth: ${testOtpNote}`);
  const auth = createAuth({
    db,
    config: {
      sessionTtlDays: env.SESSION_TTL_DAYS,
      otpTtlMinutes: env.OTP_TTL_MINUTES,
      googleClientIds: env.GOOGLE_CLIENT_ID ? [env.GOOGLE_CLIENT_ID] : [],
      testOtp,
      // Guests verify a phone by OTP (no account) for support tickets: a short-lived signed token.
      guestTokenSecret: createHash("sha256").update(`guest-token:${env.APP_SECRET}`).digest("hex"),
      guestTokenTtlMinutes: 60,
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

  defineJob("uploads.cleanup", async () => {
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
  // Search ports are late-bound: inventory and reviews are created further down.
  let reviewsRef: ReturnType<typeof createReviews> | undefined;
  const catalogue = createCatalogue({
    db,
    featureGate: features.gate,
    availability: catalogueAvailability(() => inventoryRef!.service, (tenantId, key) => features.service.isEnabled(tenantId, key)),
    ratings: { ratings: (tenantId, productIds) => reviewsRef!.ratingsPort.ratings(tenantId, productIds) },
    // Marketplace sellers manage their own products through the catalogue routes.
    vendorScope: { vendorFor: (tenantId, userId, header) => b3!.vendorFor(tenantId, userId, header) },
    events,
    log,
  });

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
    // Bills of a branch: its GSTIN/state/address/prefix and stock location (multi-branch shops).
    branches: { seller: (tenantId, branchId) => b3!.branchSeller(tenantId, branchId) },
    loyalty: {
      redeem: async (tenantId, i) => {
        const r = await b3!.loyalty.service.redeem(tenantId, {
          memberKey: b3!.memberKeyOf(i.phone),
          points: i.points,
          refType: "invoice",
          refId: i.invoiceId,
          orderAmount: i.orderAmount,
        });
        return { points: r.points, discount: r.discount };
      },
      reverse: (tenantId, invoiceId) => b3!.loyalty.service.reverse(tenantId, "invoice", invoiceId),
    },
    events: {
      issued: (tenantId, inv) => emit(tenantId, "invoice.issued", invoiceEvent(inv)),
      paid: async (tenantId, inv) => {
        await emit(tenantId, "invoice.paid", invoiceEvent(inv));
        // Bills made from store orders don't earn points: the order earns its own.
        if (await isOrderInvoice(tenantId, inv.id)) return;
        await b3?.loyalty.hooks.invoicePaid(tenantId, { id: inv.id, amount: inv.total, customerPhone: inv.customer.phone, customerName: inv.customer.name });
      },
      cancelled: async (tenantId, inv) => {
        await emit(tenantId, "invoice.cancelled", invoiceEvent(inv));
        await b3?.loyalty.hooks.invoiceCancelled(tenantId, inv.id);
      },
      paymentReceived: (tenantId, e) =>
        emit(tenantId, "payment.received", {
          invoiceId: e.invoice.id,
          number: e.invoice.number,
          amount: e.amount,
          method: e.method,
          source: e.source,
          balance: e.invoice.balance,
        }),
      customerCreated: (tenantId, c) =>
        emit(tenantId, "customer.created", { id: c.id, name: c.name, phone: c.phone, email: c.email, gstin: c.gstin, createdAt: c.createdAt }),
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
    events,
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

  // The storefront keeps shopper stats (total spent) from order payments; it is created further down.
  let storefrontRef: ReturnType<typeof createStorefront> | undefined;
  const orders = createOrders({
    db,
    catalog: {
      // Store orders may only contain active products sold in the store. categoryId feeds category coupons.
      getVariants: async (tenantId, ids, opts) => {
        const found = await catalogue.service.storeVariants(tenantId, ids);
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
    loyalty: {
      redeem: async (tenantId, i) => {
        const r = await b3!.loyalty.service.redeem(tenantId, {
          memberKey: b3!.memberKeyOf(i.phone),
          points: i.points,
          refType: "order",
          refId: i.orderId,
          orderAmount: i.orderAmount,
        });
        return { points: r.points, discount: r.discount };
      },
      reverse: (tenantId, orderId) => b3!.loyalty.service.reverse(tenantId, "order", orderId),
    },
    events: {
      // Online payments, COD collected on delivery and manual payments of store orders add to the shopper's total spent.
      paymentRecorded: async (e) => {
        if (e.channel === "store" && e.accountId) await storefrontRef!.service.recordPaid(e.tenantId, e.accountId, e.amount);
        // Fully paid (online, or COD collected): points, unless the order was cancelled meanwhile.
        if (e.paymentStatus === "paid") {
          const o = await orders.service.get(e.tenantId, e.orderId).catch(() => null);
          if (o) await orderEarn(e.tenantId, o);
        }
      },
      created: async (tenantId, o) => {
        await emit(tenantId, "order.created", orderEvent(o));
        await b3?.marketplace.service.syncOrder(tenantId, o.id);
      },
      statusChanged: async ({ tenantId, order: o, from, to }) => {
        await emit(tenantId, "order.status_changed", { ...orderEvent(o), from, to });
        await b3?.marketplace.service.syncOrder(tenantId, o.id);
        if (to === "delivered") await orderEarn(tenantId, o);
        if (to === "cancelled" || to === "returned") await b3?.loyalty.hooks.orderCancelled(tenantId, o.id);
      },
    },
    log,
  });

  /** Loyalty points for a delivered or fully paid order (first of the two; earn is idempotent per order). */
  async function orderEarn(tenantId: string, o: Order) {
    if (!b3 || o.status === "cancelled" || o.status === "returned") return;
    await b3.loyalty.hooks.orderCompleted(tenantId, {
      id: o.id,
      amount: Math.max(o.total - o.refunded, 0),
      customerPhone: o.customer.phone,
      customerName: o.customer.name,
    });
  }

  /** Bills issued from orders in this process (their payment is added right after; the order row links them later). */
  const orderInvoiceIds = new Set<string>();
  /** A bill made from an order (it must not earn loyalty points of its own). */
  async function isOrderInvoice(tenantId: string, invoiceId: string) {
    if (orderInvoiceIds.has(invoiceId)) return true;
    const [row] = await db
      .select({ id: ordersTable.id })
      .from(ordersTable)
      .where(and(eq(ordersTable.tenantId, tenantId), eq(ordersTable.invoiceId, invoiceId)))
      .limit(1);
    return Boolean(row);
  }

  /**
   * The GST invoice for an order. Lines carry no `itemId`: the order already moves stock (reserve → commit), so the
   * invoice must not deduct it a second time. Shipping becomes its own taxed line (SAC 996812). Tax-inclusive lines
   * carry `inclusiveTotal`, so the invoice lines and total equal the order's to the paisa.
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
      // Tax-inclusive lines: the invoice line totals the charged amount exactly, like the order line.
      inclusiveTotal: l.taxInclusive && l.gstRate ? l.total : undefined,
    }));
    const service = (description: string, s: NonNullable<Order["totals"]["shippingLine"]>) => ({
      description,
      hsn: s.hsn ?? "996812",
      qty: 1,
      unit: "job",
      rate: s.rate,
      discount: undefined,
      gstRate: s.gstRate,
      inclusiveTotal: s.inclusiveTotal ?? undefined,
    });
    const s = order.totals.shippingLine;
    if (s) lines.push(service("Shipping charges", s));
    const cod = order.totals.codFeeLine;
    if (cod) lines.push(service("COD charges", cod));
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
    }, { branchId: order.branchId });
    orderInvoiceIds.add(invoice.id);
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
  const docPorts = documentPorts({
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
    // E-invoiced bills print the IRN, Ack no/date and the signed QR (TEST label for the mock provider).
    einvoice: async (tenantId, invoiceId) =>
      b3 && (await features.service.isEnabled(tenantId, "gst-einvoice")) ? b3.einvoice.service.irnFor(tenantId, invoiceId) : null,
  });
  const documents = createDocuments({
    config: { env: process.env },
    ...docPorts,
    log,
  });
  // ---- CSV/XLSX import and export. Importers/exporters must be registered before the routes are mounted.
  const importExport = createImportExport({ db, queue: jobs.service, features: features.gate, log });
  registerImportExport(importExport.registry, { catalogue: catalogue.service, invoices: invoices.service, inventory: inventory.service });

  // ================================================================ online store (docs/commerce-batch2.md)
  const isEnabled = (tenantId: string, key: string) => features.service.isEnabled(tenantId, key);
  const storeSettings = settings.service.handle("store");
  const reviewSettings = settings.service.handle("reviews");
  const shopName = async (tenantId: string) =>
    (await branding.service.get(tenantId)).appName ?? (await tenancy.service.getById(tenantId))?.name ?? null;

  /** Shipping zones, rates and quotes, pincode lookup and shipments; shipment progress moves the order along. */
  const delivery = createDelivery({
    db,
    config: { encryptionKey: env.APP_SECRET, allowMock: env.NODE_ENV !== "production", webhookBaseUrl: env.API_PUBLIC_URL },
    orders: fulfillmentPort(orders.service),
    featureGate: features.gate,
    log,
  });

  const storefront = createStorefront({
    db,
    catalog: storeCatalogPort(catalogue.service),
    // Store orders belong to the shop's main branch (multi-branch shops): its id and stock location.
    orders: storeOrdersPort(orders.service, async (tenantId) => (b3 ? b3.defaultBranch(tenantId) : null)),
    settings: { get: (tenantId) => storeSettings.get({ tenantId }) },
    branding: {
      get: async (tenantId) => {
        const b = await branding.service.get(tenantId);
        return { name: await shopName(tenantId), logoUrl: b.logoUrl, css: b.css };
      },
    },
    availability: storeAvailabilityPort(inventory.service, isEnabled, async (tenantId) => (await orderSettings.get({ tenantId })).allowBackorder === true),
    coupons: coupons.service,
    // A shop without zones gets delivery's implicit "All India" free rate, so checkout works out of the box.
    delivery: { quote: (tenantId, input) => delivery.service.quote(tenantId, input) },
    featureGate: features.gate,
    profiles: { get: (userId) => auth.service.getUser(userId) },
    log,
  });
  storefrontRef = storefront;

  const reviews = createReviews({
    db,
    products: { exists: async (tenantId, productId) => (await catalogue.service.productRefs(tenantId, [productId])).some(isPublicRef) },
    orders: {
      // Verified buyer: a delivered store order of this shopper (store customer id = the order's accountId) with the product.
      hasDelivered: async (tenantId, userId, productId) => {
        const customer = await storefront.service.ensureCustomer(tenantId, userId);
        return orders.service.deliveredOrderWithProduct(tenantId, customer.id, productId);
      },
    },
    shoppers: {
      displayName: async (tenantId, userId) => {
        const customer = await storefront.service.ensureCustomer(tenantId, userId);
        return customer.name || (await auth.service.getUser(userId))?.name || null;
      },
    },
    settings: { get: (tenantId) => reviewSettings.get({ tenantId }) },
    featureGate: features.gate,
    events,
    log,
  });
  reviewsRef = reviews;

  const cms = createCms({
    db,
    catalog: cmsCatalogPort(catalogue.service),
    shop: {
      info: async (tenantId) => {
        const b = await branding.service.get(tenantId);
        return { name: (await shopName(tenantId)) ?? "Our store", tagline: null, logoUrl: b.logoUrl };
      },
    },
    storeUrl: {
      baseUrl: async (tenantId) => {
        const tenant = await tenancy.service.getById(tenantId);
        const custom = (await tenancy.service.listDomains(tenantId)).find((d) => d.verified)?.domain ?? null;
        return storeBaseUrl((appId) => billingUrlFor(env.STORE_PUBLIC_URL, appId), { slug: tenant?.slug ?? "", appId: tenant?.appId ?? null }, custom);
      },
    },
    sitemapSource: {
      products: (tenantId, limit) => catalogue.service.sitemapEntries(tenantId, "products", limit),
      categories: (tenantId, limit) => catalogue.service.sitemapEntries(tenantId, "categories", limit),
      collections: (tenantId, limit) => catalogue.service.sitemapEntries(tenantId, "collections", limit),
    },
    featureGate: features.gate,
    log,
  });

  const analytics = createAnalytics({
    db,
    config: { ipSaltSecret: env.APP_SECRET },
    catalog: {
      names: async (tenantId, ids) => Object.fromEntries((await catalogue.service.productRefs(tenantId, ids)).map((p) => [p.id, p.name])),
    },
    log,
  });

  const expenses = createExpenses({
    db,
    sales: {
      gstTotals: async (tenantId, from, to) => {
        const t = (await invoices.service.gstSummary(tenantId, { from, to })).totals;
        return { taxable: t.taxable, cgst: t.cgst, sgst: t.sgst, igst: t.igst };
      },
    },
    purchases: {
      // Input credit on purchases only counts for shops that record purchases.
      itcTotals: async (tenantId, from, to) => {
        if (!(await isEnabled(tenantId, "inventory.purchases"))) return { taxable: 0, cgst: 0, sgst: 0, igst: 0 };
        const itc = (await inventory.service.purchaseReport(tenantId, { from, to })).itc;
        return { taxable: itc.taxable, cgst: itc.cgst, sgst: itc.sgst, igst: itc.igst };
      },
    },
    log,
  });

  // Setup checklist: each step's check reads the module that owns it.
  const onboarding = createOnboarding({ db, featureGate: features.gate, log });
  const filled = (v: unknown) => typeof v === "string" && v.trim() !== "";
  onboarding.registerStep({
    key: "business-profile",
    module: "settings",
    label: "Add your business details",
    description: "Legal name and state for GST bills and orders.",
    href: "settings/business",
    order: 10,
    check: async (tenantId) => {
      const p = await billingProfile.get({ tenantId });
      return filled(p.legalName) && filled(p.stateCode);
    },
  });
  onboarding.registerStep({
    key: "branding",
    module: "branding",
    label: "Add your logo and colour",
    description: "Your logo and brand colour on bills and the store.",
    href: "settings/branding",
    order: 20,
    check: async (tenantId) => {
      const b = await branding.service.get(tenantId);
      return Boolean(b.logoUrl) || Boolean(b.tokens.colors?.primary);
    },
  });
  onboarding.registerStep({
    key: "first-product",
    module: "catalogue",
    feature: "catalogue",
    label: "Add your first product",
    description: "Products are shared by bills, stock and the online store.",
    href: "catalogue/products/new",
    order: 30,
    check: async (tenantId) => (await catalogue.service.listProducts(tenantId, { limit: 1 })).total > 0,
  });
  onboarding.registerStep({
    key: "first-sale",
    module: "invoices",
    label: "Make your first bill or order",
    description: "Create a GST bill or take an order.",
    href: "invoices/new",
    order: 40,
    check: async (tenantId) =>
      (await invoices.service.list(tenantId, { limit: 1 })).total > 0 || (await orders.service.list(tenantId, { limit: 1 })).total > 0,
  });
  onboarding.registerStep({
    key: "payments",
    module: "payments",
    feature: "payments",
    label: "Connect online payments",
    description: "Connect your Razorpay account to accept UPI and cards.",
    href: "settings/payments",
    order: 50,
    check: async (tenantId) => {
      const a = await payments.service.getAccount(tenantId);
      return a.configured && a.enabled;
    },
  });
  onboarding.registerStep({
    key: "delivery-zone",
    module: "delivery",
    feature: "delivery",
    label: "Set your delivery zones",
    description: "Where you deliver and what shipping costs.",
    href: "settings/delivery",
    order: 60,
    check: async (tenantId) => (await delivery.service.listZones(tenantId)).items.some((z) => z.active),
  });
  onboarding.registerStep({
    key: "store-published",
    module: "cms",
    feature: "cms",
    label: "Publish your store home page",
    description: "Design the home page and make it live.",
    href: "store/home",
    order: 70,
    check: async (tenantId) => Boolean((await cms.service.getHome(tenantId)).publishedAt),
  });

  defineJob("store.carts.purge", async () => {
    log.info(await storefront.service.purgeExpiredCarts(), "expired carts purged");
  });
  defineJob(DELIVERY_TRACK_JOB, async () => {
    log.info(await delivery.service.trackOpenShipments(), "shipments tracked");
  });
  defineJob(ANALYTICS_JOBS.rollup, async () => {
    log.info(await analytics.service.rollup(), "analytics rolled up");
  });
  defineJob(ANALYTICS_JOBS.purge, async () => {
    log.info(await analytics.service.purge(), "analytics events purged");
  });
  defineJob(TENANCY_JOBS.verifyDomains, async () => {
    const r = await tenancy.service.verifyPending();
    if (r.checked) log.info(r, "custom domains checked");
  });

  // ================================================================ batch 3 (docs/batch3.md)
  const batch3 = createBatch3({
    env,
    log,
    db,
    jobs: jobs.service,
    settings: settings.service,
    features,
    tenancy: tenancy.service,
    auth: auth.service,
    notify: notify.service,
    staff,
    payments: payments.service,
    catalogue: catalogue.service,
    inventory: inventory.service,
    invoices: invoices.service,
    orders: orders.service,
    shopName: async (tenantId) => shopName(tenantId),
    storeUrl: async (tenantId) => {
      const tenant = await tenancy.service.getById(tenantId);
      const custom = (await tenancy.service.listDomains(tenantId)).find((d) => d.verified)?.domain ?? null;
      return storeBaseUrl((appId) => billingUrlFor(env.STORE_PUBLIC_URL, appId), { slug: tenant?.slug ?? "", appId: tenant?.appId ?? null }, custom);
    },
    permissions: () => modules.flatMap((m) => m.permissions ?? []),
  });
  b3 = batch3;

  defineJob(MARKETPLACE_SETTLE_JOB, async () => {
    log.info(await batch3.marketplace.service.settleDue(), "marketplace: delivered sales settled");
  });
  defineJob(MARKETPLACE_PAYOUT_REFRESH_JOB, async () => {
    const n = await batch3.marketplace.service.refreshAllPayouts();
    if (n) log.info({ refreshed: n }, "marketplace: processing payouts refreshed");
  });
  defineJob("support.overdue", async () => {
    const r = await batch3.support.service.markOverdue();
    log.info(r, "support: overdue tickets marked");
  });
  defineJob("loyalty.expire", async () => {
    log.info(await batch3.loyalty.service.expireDue(), "loyalty: due points expired");
  });

  // Permissions of modules whose packages don't declare them on their module (staff lists them for custom roles).
  invoices.module.permissions = INVOICE_PERMISSIONS;
  catalogue.module.permissions = CATALOGUE_PERMISSION_DEFS;
  inventory.module.permissions = INVENTORY_PERMISSION_DEFS;
  batch3.loyalty.module.permissions = [...(batch3.loyalty.module.permissions ?? []), ...LOYALTY_HOST_PERMISSIONS];

  defineJob("audit.purge", async () => {
    await audit.service.purge();
  });

  defineJob("invoices.reminders", async () => {
    const result = await invoices.service.runReminders(new Date());
    log.info(result, "invoice reminders run");
  });
  defineJob("payments.retry", async () => {
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
    storefront.module,
    delivery.module,
    reviews.module,
    cms.module,
    onboarding.module,
    analytics.module,
    expenses.module,
    ...batch3.modules,
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
    storefront,
    delivery,
    reviews,
    cms,
    onboarding,
    analytics,
    expenses,
    ...batch3Parts(batch3),
    modules,
    /** Runs a job defined in the kit once, in this process (scripts, e2e). */
    async runJob(name: string) {
      const handler = jobHandlers.get(name);
      if (!handler) throw new Error(`Unknown job "${name}" (known: ${[...jobHandlers.keys()].join(", ")})`);
      await handler();
    },
    /** Host-side `config.permission` for the billing, inventory, catalogue, orders and coupons routes. */
    routeRules: routePermissions(ROUTE_PERMISSIONS, {
      ...ROUTE_GUARDS,
      "POST /v1/support/public/tickets": guestTicketGuard((tenantId, token) => auth.service.verifyGuestToken(tenantId, token)),
    }),
    /** Collects every route for the developer module's `GET /v1/developer/openapi.json` (registered after routeRules). */
    routeCollector: batch3.routeCollector,
    /**
     * Order matters: tenancy resolves the tenant; an API key (`Bearer sk_…`) then sets tenant + key principal; auth loads
     * a session user's roles in the tenant (it ignores API keys); branches picks `ctx.branch` from both.
     */
    contextHooks: [tenancy.contextHook, batch3.developer.apiKeyHook, auth.contextHook, batch3.branches.contextHook],
    /**
     * Global preHandlers, after the context hooks: API keys refused on key management / platform routes, each route's
     * `config.feature`, then `config.permission` (skipped for marketplace sellers on the catalogue product routes,
     * which the catalogue scopes to the seller's own products itself).
     */
    preHandlers: [batch3.developer.apiKeyGuard, featureCheck(features.preHandler), permissionCheck(staff.preHandler)],
    /** Records every successful mutating request in the audit log. */
    onResponse: [audit.onResponse],
    async start() {
      for (const m of modules) await m.start?.();
      await jobs.service.schedule(MARKETPLACE_SETTLE_JOB, "30 1 * * *");
      await jobs.service.schedule(MARKETPLACE_PAYOUT_REFRESH_JOB, "*/30 * * * *");
      await jobs.service.schedule("support.overdue", "*/10 * * * *");
      await jobs.service.schedule("loyalty.expire", "5 0 * * *");
      await jobs.service.schedule(DEVELOPER_JOBS.sweep, "*/5 * * * *");
      await jobs.service.schedule(batch3.reports.service.dueJob().name, batch3.reports.service.dueJob().cron);
      await jobs.service.schedule("consent.sweep", "0 * * * *");
      await jobs.service.schedule("uploads.cleanup", "30 3 * * *");
      await jobs.service.schedule("invoices.reminders", "0 10 * * *");
      await jobs.service.schedule("payments.retry", "*/15 * * * *");
      await jobs.service.schedule("audit.purge", "15 4 * * *");
      await jobs.service.schedule("store.carts.purge", "45 3 * * *");
      await jobs.service.schedule(DELIVERY_TRACK_JOB, "0 */2 * * *");
      await jobs.service.schedule(ANALYTICS_JOBS.rollup, "5 * * * *");
      await jobs.service.schedule(ANALYTICS_JOBS.purge, "20 4 * * *");
      await jobs.service.schedule(TENANCY_JOBS.verifyDomains, "*/30 * * * *");
    },
    async stop() {
      for (const m of [...modules].reverse()) await m.stop?.();
      await batch3.stop();
      await closeDb();
    },
  };
}

export type Kit = ReturnType<typeof createKit>;

/** The batch-3 modules on the kit object (scripts and seeds use their services). */
function batch3Parts(b: Batch3) {
  return {
    marketplace: b.marketplace,
    kyc: b.kyc,
    loyalty: b.loyalty,
    chat: b.chat,
    support: b.support,
    whatsapp: b.whatsapp,
    einvoice: b.einvoice,
    branches: b.branches,
    developer: b.developer,
    reports: b.reports,
  };
}

/** Webhook payload of a bill (money in paise). */
function invoiceEvent(inv: Invoice) {
  return {
    id: inv.id,
    number: inv.number,
    status: inv.status,
    date: inv.date,
    branchId: inv.branchId ?? null,
    customer: { id: inv.customerId, name: inv.customer.name, phone: inv.customer.phone, gstin: inv.customer.gstin },
    total: inv.total,
    paid: inv.paid,
    balance: inv.balance,
  };
}

/** Webhook payload of an order (money in paise). */
function orderEvent(o: Order) {
  return {
    id: o.id,
    number: o.number,
    channel: o.channel,
    status: o.status,
    paymentStatus: o.paymentStatus,
    paymentMethod: o.paymentMethod,
    branchId: o.branchId ?? null,
    customer: { name: o.customer.name, phone: o.customer.phone, email: o.customer.email },
    total: o.total,
    paid: o.paid,
    placedAt: o.placedAt,
  };
}

/** Catalogue product routes marketplace sellers may use; their scoping is done by the catalogue module. */
function permissionCheck(check: (req: FastifyRequest) => Promise<void>) {
  return async (req: FastifyRequest) => {
    const user = req.ctx.user;
    const staffMember = isSuperAdmin(req.ctx) || (user?.tenantRoles ?? []).some((r) => ["owner", "admin", "staff"].includes(r));
    if (user && !staffMember && CATALOGUE_VENDOR_ROUTE_KEYS.has(`${req.method} ${req.routeOptions.url}`)) return;
    await check(req);
  };
}

/** Routes whose feature check super-admins skip (the platform team verifies domains even below the plan). */
const SUPERADMIN_FEATURE_BYPASS = new Set([
  "POST /v1/tenancy/domains/:id/verify",
  // The platform team may also set a domain up (and remove it) for a shop.
  "GET /v1/tenancy/domains",
  "POST /v1/tenancy/domains",
  "GET /v1/tenancy/domains/:id/instructions",
  "DELETE /v1/tenancy/domains/:id",
]);

/** The features preHandler, except for super-admins on `SUPERADMIN_FEATURE_BYPASS` routes. */
function featureCheck(check: (req: FastifyRequest) => Promise<void>) {
  return async (req: FastifyRequest) => {
    if (isSuperAdmin(req.ctx) && SUPERADMIN_FEATURE_BYPASS.has(`${req.method} ${req.routeOptions.url}`)) return;
    await check(req);
  };
}

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
