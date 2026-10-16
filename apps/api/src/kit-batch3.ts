import { createHash } from "node:crypto";
import { AppError, FULL_ACCESS_ROLES, permissionsAllow, type FeatureGatePort, type TenantRef } from "@srirealtime/core";
import type { Db } from "@srirealtime/db";
import { createBranches } from "@srirealtime/branches";
import type { createCatalogue } from "@srirealtime/catalogue";
import { createChat, MemoryNonceStore, MemoryPubSub, type ChatNotification } from "@srirealtime/chat";
import { createDeveloper, createRouteCollector } from "@srirealtime/developer";
import { createEInvoice, type EInvoiceSource, type PartySource } from "@srirealtime/einvoice";
import type { createInventory } from "@srirealtime/inventory";
import type { createInvoices, Invoice } from "@srirealtime/invoices";
import { createRedisNonceStore, createRedisPubSub, type JobsService } from "@srirealtime/jobs";
import { createKyc, toVendorKycStatus } from "@srirealtime/kyc";
import { createLoyalty, toIndianE164 } from "@srirealtime/loyalty";
import { createMarketplace, razorpayRouteTransferPort, type SourceOrder } from "@srirealtime/marketplace";
import type { createNotify } from "@srirealtime/notify";
import type { createOrders, Order } from "@srirealtime/orders";
import type { createPayments } from "@srirealtime/payments";
import { createReports, DrizzleReportStore } from "@srirealtime/reports";
import type { SettingsService } from "@srirealtime/settings";
import type { createStaff } from "@srirealtime/staff";
import { storeCustomers } from "@srirealtime/storefront";
import { createSupport } from "@srirealtime/support";
import type { createTenancy } from "@srirealtime/tenancy";
import type { createAuth } from "@srirealtime/auth";
import { createWhatsApp, type AudienceMember } from "@srirealtime/whatsapp";
import { and, eq } from "@srirealtime/db";
import type { Logger } from "pino";
import type { Env } from "./env";
import { registerDatasets } from "./kit-reports";
import { whatsappLiveRoutes } from "./kit-live";

/**
 * Batch 3 (docs/batch3.md): marketplace, chat, support, kyc, loyalty, whatsapp, einvoice, branches, developer and
 * reports, wired to the existing services through their ports. Kept out of kit.ts so the composition root stays
 * readable; kit.ts passes the late-bound hooks (events, loyalty, vendor scope, branch seller) into the older modules.
 */
type Catalogue = ReturnType<typeof createCatalogue>["service"];
type Inventory = ReturnType<typeof createInventory>["service"];
type Invoices = ReturnType<typeof createInvoices>["service"];
type Orders = ReturnType<typeof createOrders>["service"];
type Payments = ReturnType<typeof createPayments>["service"];
type Notify = ReturnType<typeof createNotify>["service"];
type Tenancy = ReturnType<typeof createTenancy>["service"];
type Auth = ReturnType<typeof createAuth>["service"];
type Staff = ReturnType<typeof createStaff>;

export interface Batch3Deps {
  env: Env;
  log: Logger;
  db: Db;
  jobs: JobsService;
  settings: SettingsService;
  features: { gate: FeatureGatePort; service: { isEnabled(tenantId: string, key: string): Promise<boolean> } };
  tenancy: Tenancy;
  auth: Auth;
  notify: Notify;
  staff: Staff;
  payments: Payments;
  catalogue: Catalogue;
  inventory: Inventory;
  invoices: Invoices;
  orders: Orders;
  shopName: (tenantId: string) => Promise<string | null>;
  storeUrl: (tenantId: string) => Promise<string>;
  /** Every module's PermissionDefs (read lazily). */
  permissions: () => import("@srirealtime/core").PermissionDef[];
  /** Audit log, for events the host hook can't attribute to a shop (KYC review decisions). */
  audit?: import("@srirealtime/core").AuditPort;
}

const is404 = (e: unknown) => e instanceof AppError && e.status === 404;
const nullOn404 = (e: unknown): null => {
  if (is404(e)) return null;
  throw e;
};
const isDev = (env: Env) => env.NODE_ENV !== "production";
const STAFF_ROLES = ["owner", "admin", "staff"];
const rupees = (paise: number) => `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function createBatch3(d: Batch3Deps) {
  const { env, log, db, settings, features, tenancy, auth, notify } = d;
  const gate = features.gate;
  const dev = isDev(env);

  const notifier = {
    send: async (input: { tenantId: string; channel: "whatsapp" | "sms" | "email"; to: string; template: string; vars: Record<string, string>; locale?: string }) => ({
      logId: (await notify.send(input)).logId,
    }),
  };
  /** Owner/admin user ids of a shop. */
  const ownerIds = async (tenantId: string) =>
    (await tenancy.listMembers(tenantId)).filter((m) => m.roles.some((r) => FULL_ACCESS_ROLES.includes(r))).map((m) => m.userId);
  const storeCustomer = async (tenantId: string, userId: string) => {
    const [row] = await db
      .select()
      .from(storeCustomers)
      .where(and(eq(storeCustomers.tenantId, tenantId), eq(storeCustomers.userId, userId)))
      .limit(1);
    return row ?? null;
  };
  /** Members of the shop whose roles grant `permission` (owners/admins always). */
  const membersWith = async (tenantId: string, permission: string) => {
    const out: string[] = [];
    for (const m of await tenancy.listMembers(tenantId)) {
      if (m.status && m.status !== "active") continue;
      if (m.roles.some((r) => FULL_ACCESS_ROLES.includes(r))) {
        out.push(m.userId);
        continue;
      }
      if (!m.roles.includes("staff")) continue;
      const perms = await d.staff.resolver.permissionsFor(tenantId, m.roles);
      if (permissionsAllow(perms, permission)) out.push(m.userId);
    }
    return out;
  };

  // ================================================================ redis (chat pub/sub + stream-token nonces)
  const redis = env.REDIS_URL === "memory" ? null : { pubsub: createRedisPubSub(env.REDIS_URL), nonces: createRedisNonceStore(env.REDIS_URL) };
  const pubsub = redis?.pubsub ?? new MemoryPubSub();

  // ================================================================ marketplace + kyc
  const marketplaceSettings = settings.handle("marketplace");
  let kycRef: ReturnType<typeof createKyc> | undefined;
  const marketplace = createMarketplace({
    db,
    config: { encryptionKey: env.APP_SECRET, allowMock: dev },
    settings: { get: (tenantId) => marketplaceSettings.get({ tenantId }) },
    orders: { getOrder: (tenantId, orderId) => sourceOrder(d.orders, d.catalogue, tenantId, orderId) },
    products: {
      count: (tenantId, vendorId, opts) => d.catalogue.vendorProductCount(tenantId, vendorId, opts),
      list: (tenantId, vendorId, opts) => d.catalogue.vendorProducts(tenantId, vendorId, opts),
      productVendors: (tenantId, productIds) => d.catalogue.productVendors(tenantId, productIds),
    },
    transfers: razorpayRouteTransferPort((tenantId) => d.payments.credentials(tenantId)),
    kyc: { status: async (tenantId, subjectType, subjectId) => (await kycRef!.service.status(tenantId, subjectType, subjectId)).status },
    notifier,
    featureGate: gate,
    log,
  });

  const kyc = createKyc({
    db,
    config: {
      provider: env.KYC_BASE_URL && env.KYC_TOKEN ? "http" : "mock",
      http: env.KYC_BASE_URL && env.KYC_TOKEN ? { baseUrl: env.KYC_BASE_URL, token: env.KYC_TOKEN, provider: env.KYC_PROVIDER_NAME } : undefined,
      allowMock: dev,
      secret: env.APP_SECRET,
      // Documents and selfies must be our own uploads.
      fileUrlPrefixes: [env.PUBLIC_UPLOAD_BASE_URL, `${env.API_PUBLIC_URL.replace(/\/+$/, "")}/`].filter((p): p is string => Boolean(p)),
    },
    vendors: {
      isVendorOwner: async (tenantId, vendorId, userId) =>
        (await marketplace.service.memberships(tenantId, userId)).some((m) => m.vendorId === vendorId && m.role === "owner"),
      vendorExists: async (tenantId, vendorId) => Boolean(await marketplace.service.getVendor(tenantId, vendorId).catch(nullOn404)),
    },
    // The vendor row mirrors the KYC result (payouts read it when the kyc port is off).
    onStatusChange: async (tenantId, status) => {
      if (status.subjectType !== "vendor") return;
      await marketplace.service.updateVendor(tenantId, status.subjectId, { kycStatus: toVendorKycStatus(status.status) });
    },
    audit: d.audit,
    log,
  });
  kycRef = kyc;

  /** Catalogue vendor scoping: the seller a signed-in (non-staff) user acts for, or null. */
  const vendorFor = async (tenantId: string, userId: string, header: string | null) => {
    try {
      return (await marketplace.service.resolveVendor(tenantId, userId, header)).vendor.id;
    } catch (err) {
      if (err instanceof AppError && (err.status === 403 || err.status === 404)) return null;
      throw err;
    }
  };

  // ================================================================ loyalty
  const loyaltySettings = settings.handle("loyalty");
  const loyalty = createLoyalty({
    db,
    settings: {
      get: (tenantId) => loyaltySettings.get({ tenantId }),
      set: (tenantId, patch) => loyaltySettings.setTenant(tenantId, patch as Record<string, unknown>),
    },
    shoppers: {
      phone: async (tenantId, userId) => (await storeCustomer(tenantId, userId))?.phone ?? (await auth.getUser(userId))?.phone ?? null,
    },
    featureGate: gate,
    log,
  });
  const memberKeyOf = (phone: string) => {
    const key = toIndianE164(phone);
    if (!key) throw new AppError(400, "loyalty_phone_invalid", "Loyalty points need a valid Indian mobile number");
    return key;
  };

  // ================================================================ chat
  const chat = createChat({
    db,
    pubsub,
    nonceStore: redis?.nonces ?? new MemoryNonceStore(),
    streamTokenSecret: env.CHAT_STREAM_SECRET,
    notifier: { notify: (n) => chatNotify(n) },
    directory: {
      kindOf: async (tenantId, userId) => {
        const roles = await tenancy.rolesFor(tenantId, userId);
        if (roles.some((r) => STAFF_ROLES.includes(r))) return "staff";
        if ((await marketplace.service.memberships(tenantId, userId)).length > 0) return "vendor";
        return (await storeCustomer(tenantId, userId)) ? "shopper" : null;
      },
      names: async (_tenantId, userIds) =>
        Object.fromEntries((await auth.getUsers(userIds)).filter((u) => u.name).map((u) => [u.id, u.name as string])),
    },
    orders: {
      customerUserId: async (tenantId, orderId) => {
        const o = await d.orders.get(tenantId, orderId).catch(nullOn404);
        const accountId = o?.customer.accountId;
        if (!accountId) return null;
        const [row] = await db
          .select({ userId: storeCustomers.userId })
          .from(storeCustomers)
          .where(and(eq(storeCustomers.tenantId, tenantId), eq(storeCustomers.id, accountId)))
          .limit(1);
        return row?.userId ?? null;
      },
      label: async (tenantId, orderId) => {
        const o = await d.orders.get(tenantId, orderId).catch(nullOn404);
        return o ? `Order ${o.number}` : null;
      },
    },
    featureGate: gate,
    log,
  });

  /** Offline chat message: push first, the `chat.message` WhatsApp template when the user has no push token. */
  async function chatNotify(n: ChatNotification) {
    const vars = {
      shop: (await d.shopName(n.tenantId)) ?? "",
      sender: n.senderName ?? "Customer",
      preview: n.preview,
      title: n.conversationTitle ?? "",
      link: "",
    };
    const recipients = n.audience === "user" ? (n.recipientUserId ? [n.recipientUserId] : []) : await ownerIds(n.tenantId);
    for (const userId of recipients) {
      const pushed = await notify.sendToUser({ tenantId: n.tenantId, userId, template: n.template, vars, channels: ["push"] });
      if (pushed.some((r) => r.status === "sent" || r.status === "queued")) continue;
      await notify.sendToUser({ tenantId: n.tenantId, userId, template: n.template, vars, channels: ["whatsapp"] });
    }
  }

  // ================================================================ support
  const supportSettings = settings.handle("support");
  const contactOf = async (userId: string) => {
    const u = await auth.getUser(userId);
    return u ? { userId, name: u.name, phone: u.phone, email: u.email } : null;
  };
  const support = createSupport({
    db,
    guestVerifier: { verify: async (tenantId, token) => auth.verifyGuestToken(tenantId, token) },
    notifier,
    staff: {
      contact: async (tenantId, userId) => ((await tenancy.getMember(tenantId, userId)) ? contactOf(userId) : null),
      team: async (tenantId) => (await Promise.all((await membersWith(tenantId, "support.manage")).map(contactOf))).filter((c) => c !== null),
    },
    requesters: {
      profile: async (tenantId, userId) => {
        const c = await storeCustomer(tenantId, userId);
        const u = await auth.getUser(userId);
        return { name: c?.name || u?.name || null, phone: c?.phone ?? u?.phone ?? null, email: c?.email ?? u?.email ?? null };
      },
    },
    settings: { get: (tenantId) => supportSettings.get({ tenantId }) },
    links: {
      requester: async (tenantId, ticket) => `${await d.storeUrl(tenantId)}/account/support/${ticket.id}`,
      shopName: async (tenantId) => (await d.shopName(tenantId)) ?? "",
    },
    featureGate: gate,
    log,
  });

  // ================================================================ whatsapp
  const whatsappSettings = settings.handle("whatsapp");
  const whatsapp = createWhatsApp({
    db,
    secretKey: env.WHATSAPP_SECRET_KEY ?? createHash("sha256").update(`whatsapp:${env.APP_SECRET}`).digest("hex"),
    webhookBaseUrl: `${env.API_PUBLIC_URL.replace(/\/+$/, "")}/v1/whatsapp`,
    allowMock: dev,
    queue: d.jobs,
    audience: {
      kinds: () => ["dues", "recent_orders", "loyalty_tier", "customers"],
      resolve: (tenantId, source, opts) => resolveAudience(tenantId, source, opts.limit),
    },
    settings: {
      get: (tenantId) => whatsappSettings.get({ tenantId }),
      set: (tenantId, patch) => whatsappSettings.setTenant(tenantId, patch as Record<string, unknown>),
    },
    featureGate: gate,
    staff: { isStaff: async (tenantId, userId) => (await tenancy.rolesFor(tenantId, userId)).some((r) => STAFF_ROLES.includes(r)) },
    log,
  });

  async function resolveAudience(tenantId: string, source: Parameters<NonNullable<Parameters<typeof createWhatsApp>[0]["audience"]>["resolve"]>[1], limit: number): Promise<AudienceMember[]> {
    const out: AudienceMember[] = [];
    switch (source.kind) {
      case "dues": {
        // Credit book: customers owing at least minDue.
        for (let offset = 0; out.length < limit; offset += 200) {
          const page = await d.invoices.creditBook(tenantId, { limit: 200, offset });
          for (const c of page.items) {
            if (c.customer.phone && c.balance >= source.minDue) {
              out.push({ phone: c.customer.phone, name: c.customer.name, variables: { amount: rupees(c.balance), due_paise: c.balance } });
            }
          }
          if (page.items.length < 200) break;
        }
        break;
      }
      case "recent_orders": {
        const since = new Date(Date.now() - source.days * 86_400_000 + 330 * 60_000).toISOString().slice(0, 10);
        const seen = new Set<string>();
        for (let offset = 0; out.length < limit; offset += 200) {
          const page = await d.orders.list(tenantId, { from: since, limit: 200, offset });
          for (const o of page.items) {
            const phone = (o as { customerPhone?: string | null }).customerPhone ?? null;
            const full = phone ? null : await d.orders.get(tenantId, o.id).catch(nullOn404);
            const p = phone ?? full?.customer.phone ?? null;
            if (!p || seen.has(p) || o.status === "cancelled") continue;
            seen.add(p);
            const placed = new Date((o as { placedAt: Date | string }).placedAt);
            out.push({
              phone: p,
              name: (o as { customerName?: string }).customerName ?? full?.customer.name ?? null,
              variables: { last_order: o.number, last_order_date: placed.toISOString().slice(0, 10) },
            });
          }
          if (page.items.length < 200) break;
        }
        break;
      }
      case "loyalty_tier": {
        for (const tier of source.tiers) {
          for (let offset = 0; out.length < limit; offset += 200) {
            const page = await loyalty.service.list(tenantId, { tier, limit: 200, offset });
            for (const m of page.items) out.push({ phone: m.memberKey, name: m.name, variables: { tier: m.tier, points: m.pointsBalance } });
            if (page.items.length < 200) break;
          }
        }
        break;
      }
      case "customers": {
        for (let offset = 0; out.length < limit; offset += 200) {
          const page = await d.invoices.listCustomers(tenantId, { limit: 200, offset });
          for (const c of page.items) if (c.phone) out.push({ phone: c.phone, name: c.name });
          if (page.items.length < 200) break;
        }
        const shoppers = await db
          .select({ phone: storeCustomers.phone, name: storeCustomers.name })
          .from(storeCustomers)
          .where(eq(storeCustomers.tenantId, tenantId))
          .limit(limit);
        for (const s of shoppers) if (s.phone) out.push({ phone: s.phone, name: s.name || null });
        break;
      }
    }
    return out.slice(0, limit);
  }

  // ================================================================ e-invoice
  const einvoice = createEInvoice({
    db,
    config: {
      encryptionKey: env.APP_SECRET,
      allowMock: dev,
      maxAgeDays: 30,
      gsp: {
        ...(env.EINVOICE_GSP_BASE_URL
          ? { production: { baseUrl: env.EINVOICE_GSP_BASE_URL, clientId: env.EINVOICE_GSP_CLIENT_ID, clientSecret: env.EINVOICE_GSP_CLIENT_SECRET } }
          : {}),
        ...(env.EINVOICE_GSP_SANDBOX_URL
          ? { sandbox: { baseUrl: env.EINVOICE_GSP_SANDBOX_URL, clientId: env.EINVOICE_GSP_CLIENT_ID, clientSecret: env.EINVOICE_GSP_CLIENT_SECRET } }
          : {}),
      },
    },
    invoices: {
      getInvoice: async (tenantId, invoiceId) => {
        const inv = await d.invoices.get(tenantId, invoiceId).catch(nullOn404);
        return inv ? toEInvoiceSource(inv) : null;
      },
      listForPeriod: async (tenantId, range) => {
        const out: EInvoiceSource[] = [];
        for (let offset = 0; ; offset += 200) {
          const page = await d.invoices.list(tenantId, { from: range.from, to: range.to, limit: 200, offset });
          for (const s of page.items) {
            if (s.status === "draft" || !s.number) continue;
            const inv = await d.invoices.get(tenantId, s.id).catch(nullOn404);
            if (inv) out.push(toEInvoiceSource(inv));
          }
          if (page.items.length < 200) break;
        }
        return out;
      },
    },
    log,
  });

  // ================================================================ branches
  const branches = createBranches({
    db,
    profile: { get: (tenantId) => d.invoices.sellerProfile(tenantId) },
    locations: {
      defaultLocation: (tenantId) => d.inventory.ensureDefaultLocation(tenantId),
      getLocation: (tenantId, id) => d.inventory.getLocation(tenantId, id).catch(nullOn404),
      createLocation: (tenantId, input) => d.inventory.createLocation(tenantId, { name: input.name, code: input.code, type: "store", address: input.address }),
    },
    summary: {
      sales: (tenantId, range) => d.invoices.salesByBranch(tenantId, range),
      stockValue: async (tenantId, locationId) => (await d.inventory.summary(tenantId, { locationId })).stockValue,
    },
    members: { isMember: async (tenantId, userId) => Boolean(await tenancy.getMember(tenantId, userId)) },
    featureGate: gate,
    log,
  });

  /** The branch seller details for a bill (invoices' BranchPort). */
  const branchSeller = async (tenantId: string, branchId: string) => {
    const b = await branches.service.seller(tenantId, branchId).catch(nullOn404);
    if (!b) return null;
    const active = await branches.service.activeBranches(tenantId);
    return {
      branchId: b.branchId,
      isDefault: active.some((x) => x.id === b.branchId && x.isDefault),
      gstin: b.gstin,
      stateCode: b.stateCode,
      address: b.address,
      city: b.city,
      pincode: b.pincode,
      phone: b.phone,
      invoicePrefix: b.invoicePrefix,
      stockLocationId: b.stockLocationId,
    };
  };
  /** Store orders belong to the shop's default branch (when it uses branches). */
  const defaultBranch = async (tenantId: string) => {
    if (!(await features.service.isEnabled(tenantId, "multi-branch"))) return null;
    const active = await branches.service.activeBranches(tenantId);
    return active.find((b) => b.isDefault) ?? null;
  };

  // ================================================================ developer (API keys, webhooks, OpenAPI)
  const routeCollector = createRouteCollector();
  const developer = createDeveloper(
    {
      db,
      config: { encryptionKey: env.APP_SECRET, production: env.NODE_ENV === "production" },
      tenants: {
        byId: async (tenantId) => {
          const t = await tenancy.getById(tenantId);
          if (!t || t.status === "suspended") return null;
          return (await tenancy.getRef(tenantId)) satisfies TenantRef | null;
        },
      },
      permissions: d.permissions,
      queue: d.jobs,
      notifier,
      owners: {
        ownerContact: async (tenantId) => {
          const [id] = await ownerIds(tenantId);
          const u = id ? await auth.getUser(id) : null;
          return u ? { email: u.email, phone: u.phone, locale: u.locale } : null;
        },
      },
      featureGate: gate,
      routes: routeCollector,
      log,
    },
    {
      // The bare key uuid, so `created_by` / audit `actor_user_id` (uuid columns) accept API-key writes.
      principalId: (keyId) => keyId,
      // Platform (super-admin) areas and account/session management are never reachable with an API key.
      apiKeyDenyPrefixes: [
        "/v1/auth/",
        "/v1/features/registry",
        "/v1/features/apps",
        "/v1/features/tenants",
        "/v1/tenancy/tenants",
        "/v1/plans/overrides",
        "/v1/notify/templates",
        "/v1/audit/platform",
        "/v1/consent/",
        "/v1/kyc/review",
        "/v1/staff/",
        "/v1/payments/account",
        // Batch 5: the shop's own plan and billing, and creating shops.
        "/v1/subscriptions/",
        "/v1/signup",
      ],
    },
  );
  const events = developer.events;

  // ================================================================ reports
  const reports = createReports({
    store: new DrizzleReportStore(db),
    email: {
      send: async (m) => {
        const r = await notify.send({
          tenantId: m.tenantId,
          channel: "email",
          to: m.to,
          subject: m.subject,
          body: m.text,
          attachments: m.attachments.map((a) => ({ filename: a.filename, contentType: a.contentType, content: a.content.toString("base64") })),
        });
        if (r.status === "failed") throw new Error(r.error ?? "Email could not be sent");
        return r;
      },
    },
    features: gate,
    queue: d.jobs,
    log,
  });
  registerDatasets(reports.service, db, (tenantId, key) => features.service.isEnabled(tenantId, key));

  // Live inbox updates for staff (SSE at /v1/whatsapp/stream): whatsapp events → pub/sub → each instance's streams.
  const waLive = whatsappLiveRoutes({ pubsub, nonces: redis?.nonces ?? new MemoryNonceStore(), secret: env.CHAT_STREAM_SECRET, featureGate: gate, log });
  whatsapp.service.onEvent((e) => waLive.publish(e));
  const waRoutes = whatsapp.module.routes!;
  whatsapp.module.routes = async (app) => {
    await waRoutes(app);
    await waLive.routes(app);
  };
  const waModule = { ...whatsapp.module, start: async () => waLive.start(), stop: async () => waLive.stop() };

  return {
    marketplace,
    kyc,
    loyalty,
    chat,
    support,
    whatsapp,
    einvoice,
    branches,
    developer,
    reports,
    routeCollector,
    events,
    vendorFor,
    memberKeyOf,
    branchSeller,
    defaultBranch,
    modules: [marketplace.module, kyc.module, loyalty.module, chat.module, support.module, waModule, einvoice.module, branches.module, developer.module, reports.module],
    async stop() {
      await redis?.pubsub.close().catch(() => undefined);
      await redis?.nonces.close().catch(() => undefined);
    },
  };
}

export type Batch3 = ReturnType<typeof createBatch3>;

// ---------------------------------------------------------------- marketplace: orders with each line's seller

async function sourceOrder(orders: Orders, catalogue: Catalogue, tenantId: string, orderId: string): Promise<SourceOrder | null> {
  const o: Order | null = await orders.get(tenantId, orderId).catch(nullOn404);
  if (!o) return null;
  const vendors = await catalogue.productVendors(tenantId, [...new Set(o.lines.map((l) => l.productId))]);
  return {
    id: o.id,
    number: o.number,
    status: o.status,
    placedAt: new Date(o.placedAt),
    deliveredAt: o.deliveredAt ? new Date(o.deliveredAt) : null,
    customerName: o.customer.name,
    lines: o.lines.map((l) => ({
      variantId: l.variantId,
      productId: l.productId,
      vendorId: vendors[l.productId] ?? null,
      name: l.name,
      sku: l.sku,
      image: l.image,
      qty: l.qty,
      unit: l.unit,
      price: l.price,
      gstRate: l.gstRate,
      discount: l.discount,
      total: l.total,
    })),
    // Loyalty points are the shop's own discount: sellers are paid on the coupon-discounted price.
    totals: { subtotal: o.totals.subtotal, discount: o.totals.discount, shipping: o.totals.shipping, total: o.total },
  };
}

// ---------------------------------------------------------------- e-invoice: a bill as the NIC builder needs it

const PINCODE_RE = /\b([1-9][0-9]{5})\b/;
/** "12, Big Bazaar Street, Coimbatore, 641001" → { city: "Coimbatore", pincode: "641001" }. */
export function addressParts(address: string | null | undefined): { city: string | null; pincode: string | null } {
  if (!address) return { city: null, pincode: null };
  const pincode = PINCODE_RE.exec(address)?.[1] ?? null;
  const parts = address
    .split(/[,\n]/)
    .map((p) => p.replace(PINCODE_RE, "").replace(/[-–]\s*$/, "").trim())
    .filter((p) => p && !/^\d+$/.test(p));
  return { city: parts.length > 1 ? parts[parts.length - 1]! : null, pincode };
}

function toEInvoiceSource(inv: Invoice): EInvoiceSource {
  const s = inv.seller;
  const seller: PartySource = {
    name: s.legalName,
    gstin: s.gstin,
    address: s.address,
    city: s.city ?? addressParts(s.address).city,
    pincode: s.pincode ?? addressParts(s.address).pincode,
    stateCode: s.stateCode,
    phone: s.phone,
    email: s.email,
  };
  const c = inv.customer;
  const parts = addressParts(c.address);
  const buyer: PartySource = {
    name: c.name,
    gstin: c.gstin,
    address: c.address,
    city: parts.city,
    pincode: parts.pincode,
    stateCode: c.stateCode,
    phone: c.phone,
    email: c.email,
  };
  return {
    id: inv.id,
    number: inv.number,
    status: inv.status,
    date: inv.date,
    seller,
    buyer,
    placeOfSupply: inv.placeOfSupply,
    interState: inv.interState,
    lines: inv.lines.map((l) => ({
      description: l.description,
      hsn: l.hsn ?? null,
      qty: l.qty,
      unit: l.unit ?? null,
      rate: l.rate,
      discount: l.discount ?? 0,
      gstRate: l.gstRate,
      amount: l.amount,
      taxable: l.taxable,
      cgst: l.cgst,
      sgst: l.sgst,
      igst: l.igst,
      total: l.total,
    })),
    totals: {
      taxable: inv.totals.taxable,
      cgst: inv.totals.cgst,
      sgst: inv.totals.sgst,
      igst: inv.totals.igst,
      roundOff: inv.totals.roundOff,
      total: inv.total,
    },
  };
}

