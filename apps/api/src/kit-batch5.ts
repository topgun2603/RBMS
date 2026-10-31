import { AppError, badRequest, defineModule, FULL_ACCESS_ROLES, requireUser, type AuditPort, type SrModule } from "@rbms/core";
import type { Db } from "@rbms/db";
import { isValidGstin, isValidStateCode, normalizeGstin, normalizeStateCode, stateFromGstin } from "@rbms/gst";
import type { createAuth } from "@rbms/auth";
import { prefixFromName } from "@rbms/branches";
import type { createBranding } from "@rbms/branding";
import { renderPlatformInvoice, type createDocuments, DEFAULT_BRANDING } from "@rbms/documents";
import type { JobsService } from "@rbms/jobs";
import type { createNotify } from "@rbms/notify";
import type { createPlans } from "@rbms/plans";
import type { SettingsService } from "@rbms/settings";
import {
  createSubscriptions,
  MockSubscriptionProvider,
  RazorpaySubscriptionProvider,
  SUBSCRIPTIONS_LIFECYCLE_JOB,
  type SubscriptionProvider,
} from "@rbms/subscriptions";
import { publicTenant, type createTenancy, type Tenant } from "@rbms/tenancy";
import type { FastifyInstance } from "fastify";
import type { Logger } from "pino";
import { z } from "zod";
import type { Env } from "./env";
import { WindowLimiter } from "./permissions";

/**
 * Batch 5 (docs/batch5.md): plan subscriptions, the on-tenant-created hooks that seed a new shop, `POST /v1/signup`
 * and the login handoff targets. kit.ts creates it after the modules it builds on.
 */
type Tenancy = ReturnType<typeof createTenancy>["service"];
type Auth = ReturnType<typeof createAuth>["service"];
type Notify = ReturnType<typeof createNotify>["service"];
type Plans = ReturnType<typeof createPlans>["service"];
type Branding = ReturnType<typeof createBranding>["service"];
type Documents = ReturnType<typeof createDocuments>["service"];

export interface Batch5Deps {
  env: Env;
  log: Logger;
  db: Db;
  jobs: JobsService;
  settings: SettingsService;
  tenancy: Tenancy;
  auth: Auth;
  notify: Notify;
  plans: Plans;
  branding: Branding;
  documents: Documents;
  audit: AuditPort;
  /** Registers a job the kit can also run on demand (`kit.runJob`). */
  defineJob: (name: string, handler: () => Promise<void>) => void;
}

/** Sign-up details passed to the on-tenant-created hooks (`details.signup`). */
export interface SignupDetails {
  appId: "BL" | "EC" | "PH" | "RS" | "SV" | "SC";
  planId: string;
  interval: "monthly" | "yearly";
  state: string;
  gstin: string | null;
  phone: string | null;
  businessType: string | null;
  /** The trade in the owner's own words (sign-up "Not listed: tell us", or a typed trade). */
  businessLabel?: string | null;
}

/** Brand colour by business type (the owner changes it in Settings → Branding). */
const TYPE_COLOURS: Record<string, string> = {
  grocery: "#15803d",
  supermarket: "#15803d",
  textiles: "#7c3aed",
  fashion: "#be185d",
  clothing: "#be185d",
  electronics: "#1d4ed8",
  mobile: "#1d4ed8",
  hardware: "#b45309",
  pharmacy: "#0f766e",
  medical: "#0f766e",
  restaurant: "#c2410c",
  bakery: "#c2410c",
  jewellery: "#a16207",
  stationery: "#4338ca",
};
const DEFAULT_COLOUR = "#0f766e";

const signupBody = z.object({
  shopName: z.string().trim().min(2).max(120),
  slug: z.string().trim().toLowerCase().min(1).max(60),
  appId: z.enum(["BL", "EC", "PH", "RS", "SV", "SC"]),
  planId: z.string().trim().min(1).max(40),
  interval: z.enum(["monthly", "yearly"]).default("monthly"),
  businessType: z.string().trim().max(60).optional().nullable(),
  businessLabel: z.string().trim().max(60).optional().nullable(),
  state: z.string().trim().min(1).max(4),
  gstin: z.string().trim().max(20).optional().nullable(),
  phone: z.string().trim().max(20).optional().nullable(),
});

/** "BL=http://{slug}.localhost:3001,EC=…" → the template for `appId` (first entry when not listed). */
export function appUrlFor(setting: string, appId: string | null, slug: string): string {
  let template = setting;
  if (setting.includes("=")) {
    const entries = setting.split(",").map((e) => {
      const i = e.indexOf("=");
      return [e.slice(0, i).trim(), e.slice(i + 1).trim()] as const;
    });
    template = (entries.find(([app]) => app === appId) ?? entries[0])?.[1] ?? "";
  }
  return template.replace("{slug}", slug).replace(/\/+$/, "");
}

/**
 * A new shop's seller profile on bills: its name, and the state, GSTIN and phone from sign-up. The bill prefix comes
 * from the name ("ByteFix Computers" → "BFC"): left at the settings default, a shop's first bills went out as INV/…
 * before it set its own, and issued numbers can't be changed afterwards (GST).
 */
export function signupBillingDefaults(name: string, s: Pick<SignupDetails, "state" | "gstin" | "phone"> | null): Record<string, unknown> {
  const billing: Record<string, unknown> = { legalName: name, invoicePrefix: prefixFromName(name) };
  if (s?.state) billing.stateCode = s.state;
  if (s?.gstin) billing.gstin = s.gstin;
  if (s?.phone) billing.phone = s.phone;
  return billing;
}

/**
 * The subscription a new shop starts with, from its sign-up details: null when there is no plan to start (a shop
 * created by the seed / admin carries `signup.businessType` only and gets its plan, and then its subscription via
 * `ensure`, right after creation). Real sign-ups always carry a validated plan id.
 */
export function signupSubscriptionStart(
  tenantId: string,
  ownerUserId: string,
  s: Partial<Pick<SignupDetails, "planId" | "interval">> | null,
): { tenantId: string; ownerUserId: string; planId: string; interval: SignupDetails["interval"] } | null {
  const planId = typeof s?.planId === "string" ? s.planId.trim() : "";
  if (!planId) return null;
  return { tenantId, ownerUserId, planId, interval: s?.interval === "yearly" ? "yearly" : "monthly" };
}

export function createBatch5(d: Batch5Deps) {
  const { env, log, db, tenancy, auth, notify, plans, settings, branding } = d;
  const dev = env.NODE_ENV !== "production";
  const billingProfile = settings.handle("billing");
  const shopAppUrl = (t: Pick<Tenant, "appId" | "slug">) => appUrlFor(env.APP_PUBLIC_URL, t.appId, t.slug);
  /** The shop app's Plan & billing page (workspace-ui: /settings/plan). */
  const planPageUrl = async (tenantId: string) => {
    const t = await tenancy.getById(tenantId);
    return t ? `${shopAppUrl(t)}/settings/plan` : "";
  };

  // ---------------------------------------------------------------- provider (the platform's own Razorpay account)
  const live = env.PLATFORM_RAZORPAY_KEY_ID && env.PLATFORM_RAZORPAY_KEY_SECRET && env.PLATFORM_RAZORPAY_WEBHOOK_SECRET;
  let provider: SubscriptionProvider;
  if (live) {
    provider = new RazorpaySubscriptionProvider({
      keyId: env.PLATFORM_RAZORPAY_KEY_ID!,
      keySecret: env.PLATFORM_RAZORPAY_KEY_SECRET!,
      webhookSecret: env.PLATFORM_RAZORPAY_WEBHOOK_SECRET!,
    });
  } else if (dev) {
    provider = new MockSubscriptionProvider({
      authUrl: async (id, notes) => `${await planPageUrl(notes.tenantId ?? "")}?mockAuth=${encodeURIComponent(id)}`,
      // Add-on payment links (prorated add-ons, credits packs): the Plan & billing page's ?mockPay= dialog pays them.
      payUrl: async (id, notes) => `${await planPageUrl(notes.tenantId ?? "")}?mockPay=${encodeURIComponent(id)}`,
    });
    log.warn("subscriptions: PLATFORM_RAZORPAY_* not set, using the mock provider (development only)");
  } else {
    provider = disabledProvider();
    log.error("subscriptions: PLATFORM_RAZORPAY_* not set in production; checkout is disabled");
  }

  const ownerIds = async (tenantId: string) =>
    (await tenancy.listMembers(tenantId)).filter((m) => m.status === "active" && m.roles.some((r) => FULL_ACCESS_ROLES.includes(r))).map((m) => m.userId);

  const subs = createSubscriptions({
    db,
    provider,
    config: {
      seller: {
        legalName: env.PLATFORM_LEGAL_NAME,
        gstin: env.PLATFORM_GSTIN ?? null,
        stateCode: env.PLATFORM_STATE_CODE,
        address: env.PLATFORM_ADDRESS ?? null,
      },
      invoicePrefix: env.PLATFORM_INVOICE_PREFIX,
      allowMock: dev,
      billingPageUrl: planPageUrl,
    },
    plans: {
      getPlan: (id) => plans.getPlan(id),
      listPlans: (opts) => plans.listPlans(opts),
      defaultPlanFor: (appId) => plans.defaultPlanFor(appId),
      planForTier: (appId, tier) => plans.planForTier(appId, tier),
      offeredTo: (plan, appId) => plans.offeredTo({ appId: plan.appId ?? null }, appId),
      usage: async (tenantId) => {
        const ref = await tenancy.getRef(tenantId);
        return ref ? plans.usageSummary(ref) : [];
      },
      // Plan add-ons: the app's catalogue, credits packs and entitlement cache invalidation (plans module).
      listAddons: (appId, opts) => plans.listAddons({ appId, publicOnly: opts?.publicOnly }),
      getAddon: (id) => plans.getAddon(id),
      appFeatures: (appId) => plans.appFeatures(appId),
      invalidate: (tenantId) => plans.invalidate(tenantId),
      credits: (tenantId) => plans.credits(tenantId),
      grantCredits: (tenantId, grants) => plans.grantCredits(tenantId, grants),
    },
    tenancy: {
      getTenant: (id) => tenancy.getById(id),
      getTenants: (ids) => tenancy.getByIds(ids),
      search: async (q) => (await tenancy.list({ q, limit: 200 })).items.map((t) => t.id),
      setPlan: async (tenantId, planId) => {
        await tenancy.setPlan(tenantId, planId);
      },
    },
    shop: {
      buyer: async (tenantId) => {
        const p = await billingProfile.get({ tenantId });
        const s = (k: string) => (typeof p[k] === "string" && p[k] ? (p[k] as string) : null);
        const t = await tenancy.getById(tenantId);
        const address = [s("address"), s("city"), s("pincode")].filter(Boolean).join(", ") || null;
        return { legalName: s("legalName") ?? t?.name ?? "", gstin: s("gstin"), stateCode: s("stateCode"), address };
      },
    },
    notify: {
      // Email (with the invoice PDF) and WhatsApp to every owner/admin, in their language.
      toOwners: async ({ tenantId, template, vars, attachments }) => {
        for (const userId of await ownerIds(tenantId)) {
          const u = await auth.getUser(userId);
          if (!u) continue;
          if (u.email) await notify.send({ tenantId: null, userId, channel: "email", to: u.email, template, vars, locale: u.locale, attachments });
          if (u.phone) await notify.send({ tenantId: null, userId, channel: "whatsapp", to: u.phone, template, vars, locale: u.locale });
        }
      },
    },
    documents: {
      platformInvoicePdf: async ({ invoice, planName, sac, lines }) => {
        const html = renderPlatformInvoice(
          {
            ...invoice,
            description: `${planName} plan (${invoice.interval})`,
            sac,
            // The plan line and, after an upgrade, the proration credit as its own negative line.
            lines,
          },
          { locale: "en", branding: { ...DEFAULT_BRANDING, appName: env.APP_NAME } },
        );
        return { pdf: await d.documents.htmlToPdf(html, "A4"), filename: `${invoice.number.replace(/[^A-Za-z0-9-]+/g, "-")}.pdf` };
      },
    },
    audit: d.audit,
    log,
  });

  d.defineJob(SUBSCRIPTIONS_LIFECYCLE_JOB, async () => {
    log.info(await subs.service.runLifecycle(), "subscriptions: lifecycle run");
  });

  // ---------------------------------------------------------------- on-tenant-created hooks (every new shop)
  const signupOf = (details: Record<string, unknown>) => (details.signup ?? null) as SignupDetails | null;

  tenancy.onTenantCreated({
    name: "defaults",
    // Business name, state, GSTIN and phone on bills; the shop's name and a colour in branding. A shop created
    // without sign-up details gets its name everywhere and the default state (Tamil Nadu).
    run: async ({ tenant, details }) => {
      const s = signupOf(details);
      await billingProfile.setTenant(tenant.id, signupBillingDefaults(tenant.name, s));
      const general: Record<string, unknown> = { businessName: tenant.name };
      if (s?.phone) general.supportPhone = s.phone;
      if (s?.gstin) general.gstin = s.gstin;
      await settings.handle("general").setTenant(tenant.id, general);
      if (s?.appId && s.appId !== "BL" && s.phone) {
        await settings.handle("store").setTenant(tenant.id, { contactPhone: s.phone, social: { whatsapp: s.phone } });
      }
      const colour = (s?.businessType && TYPE_COLOURS[s.businessType.toLowerCase()]) || DEFAULT_COLOUR;
      await branding.update(tenant.id, { appName: tenant.name, tokens: { colors: { primary: colour } } });
      if (s) {
        await tenancy.update(tenant.id, {
          metadata: { ...tenant.metadata, signup: { source: "www", businessType: s.businessType, businessLabel: s.businessLabel ?? null, planId: s.planId, interval: s.interval, at: new Date().toISOString() } },
        });
      }
    },
  });

  tenancy.onTenantCreated({
    name: "subscription",
    // Sign-up's plan: a 14-day trial of a paid plan (once per owner) or the free plan. Shops created elsewhere get
    // their subscription lazily from their plan (`ensure`).
    run: async ({ tenant, ownerUserId, details }) => {
      const start = signupSubscriptionStart(tenant.id, ownerUserId, signupOf(details));
      if (!start) return;
      await subs.service.startForNewTenant(start);
    },
  });

  // ---------------------------------------------------------------- POST /v1/signup
  const perUser = new WindowLimiter(5, 3_600_000);
  const signupModule: SrModule = defineModule({
    id: "signup",
    routes: async (app: FastifyInstance) => {
      app.post("/", async (req) => {
        const user = requireUser(req.ctx);
        const b = signupBody.parse(req.body ?? {});
        const state = normalizeStateCode(b.state);
        if (!state || !isValidStateCode(state)) throw badRequest("Choose your state", { field: "state" });
        let gstin: string | null = null;
        if (b.gstin) {
          gstin = normalizeGstin(b.gstin);
          if (!isValidGstin(gstin)) throw badRequest("That doesn't look like a valid GSTIN", { field: "gstin" });
          if (stateFromGstin(gstin) !== state) throw badRequest("The GSTIN belongs to a different state", { field: "gstin" });
        }
        const plan = await plans.getPlan(b.planId);
        if (!plan || !plan.isPublic || !(await plans.offeredTo(plan, b.appId))) throw badRequest("Choose a plan", { field: "planId" });
        const check = await tenancy.slugAvailable(b.slug);
        if (!check.available) {
          throw new AppError(check.code === "taken" ? 409 : 400, check.code === "taken" ? "slug_taken" : "invalid_slug", check.reason ?? "Choose another address", {
            field: "slug",
            suggestions: check.suggestions,
          });
        }
        const signup: SignupDetails = {
          appId: b.appId,
          planId: plan.id,
          interval: b.interval,
          state,
          gstin,
          phone: b.phone?.trim() || null,
          businessType: b.businessType?.trim() || null,
          businessLabel: b.businessLabel?.trim() || null,
        };
        // At most 5 new shops an hour per user (valid requests only, so typos while filling the form don't count).
        if (!perUser.hit(user.id)) throw new AppError(429, "rate_limited", "Too many shops created; please try again in an hour");
        const tenant = await tenancy.create({ slug: b.slug, name: b.shopName, ownerUserId: user.id, appId: b.appId, details: { signup } });
        // A hook failure is logged; the shop still gets a subscription here.
        const current = await subs.service.ensure(tenant.id);
        const handoff = await auth.createHandoff(user.id, { ip: req.ctx.ip });
        const appUrl = shopAppUrl(tenant);
        const fresh = (await tenancy.getById(tenant.id)) ?? tenant;
        return {
          tenant: { ...publicTenant(fresh), planId: fresh.planId },
          appUrl,
          handoff,
          loginUrl: `${appUrl}/login?handoff=${encodeURIComponent(handoff.code)}`,
          subscription: { status: current.status, planId: current.planId, interval: current.interval, trialEndsAt: current.trialEndsAt },
          trial: current.status === "trialing",
        };
      });
    },
  });

  return {
    subscriptions: subs,
    shopAppUrl,
    /** Auth's `handoffTargets` port: the app URL of a shop the user is an active member of. */
    handoffTargets: {
      appUrl: async (userId: string, tenantId: string) => {
        const t = await tenancy.getById(tenantId);
        if (!t || (await tenancy.rolesFor(tenantId, userId)).length === 0) return null;
        return shopAppUrl(t);
      },
    },
    modules: [subs.module, signupModule],
    /** The daily schedule (09:00 IST). */
    async schedule() {
      await d.jobs.schedule(SUBSCRIPTIONS_LIFECYCLE_JOB, "0 9 * * *");
    },
  };
}

export type Batch5 = ReturnType<typeof createBatch5>;

/** Production without the platform Razorpay keys: every provider call answers 503. */
function disabledProvider(): SubscriptionProvider {
  const off = () => {
    throw new AppError(503, "not_configured", "Online plan payments are not configured yet");
  };
  return {
    name: "razorpay",
    createPlan: async () => off(),
    createSubscription: async () => off(),
    cancel: async () => undefined,
    fetch: async () => off(),
    verifyWebhook: () => false,
  };
}
