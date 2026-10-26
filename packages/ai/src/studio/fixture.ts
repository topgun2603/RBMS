import { DEFAULT_BRAND_TOKENS } from "@srirealtime/branding/tokens";
import { homeDocSchema } from "@srirealtime/cms";
import type { FeatureStatus } from "./check";
import type { CatalogueGlance, FeatureRow, StudioPorts } from "./ports";
import type { AreaId, StudioActor, StudioEnv } from "./types";

/**
 * A small in-memory shop that implements StudioPorts: the tests and the evals run the whole Studio pipeline against it
 * (no database, no services). It follows the same rules as the real ports: settings keep a saved layer over defaults,
 * pages get an id when created, writes replace an area.
 */

const STORE_DEFAULTS = {
  open: true,
  closedMessage: "",
  codEnabled: true,
  codMaxAmount: 500_000,
  minOrderValue: 0,
  deliveryEnabled: true,
  pickupEnabled: false,
  pickupNote: "",
  contactPhone: "",
  contactEmail: "",
  social: { instagram: "", facebook: "", youtube: "", whatsapp: "" },
  policies: { shipping: "", returns: "", privacy: "", terms: "" },
  businessType: "fashion",
  installBanner: true,
  trust: { returns: "auto", payment: "auto", badges: [] },
};
const DEFAULTS: Record<string, Record<string, unknown>> = {
  store: STORE_DEFAULTS,
  billing: { legalName: "Anbu Textiles", gstin: "33AAACA1234A1Z5", address: "12 Gandhi Road", city: "Madurai", pincode: "625001", stateCode: "33", phone: "9876543210", email: "", invoicePrefix: "INV", terms: "Goods once sold will not be taken back.", bankName: "", accountNumber: "", ifsc: "", upiId: "", autoReminders: false, reminderDays: [1, 7, 15], sendPaymentReceipts: true },
  printing: { paperWidth: 80, charsPerLine: 48, widthDots: 576, headerLines: [], footerLines: [], showLogo: false, showQr: true, autoPrint: false, openDrawerOnCash: true, cut: "partial", drawerPin: 0 },
  quotations: { prefix: "QT", validityDays: 15, advancePercent: null, terms: "Prices are valid until the date shown." },
  ai: { enabled: true, features: {}, maskGstin: false, storePrompts: false },
};

export const FIXTURE_PERMISSIONS = [
  "invoices.create", "invoices.cancel", "invoices.discount", "invoices.discount-approve", "invoices.credit-note", "invoices.credit-book", "quotations.view", "quotations.manage",
  "payments.receive", "customers.create", "pos.till", "reports.view", "catalogue.view", "catalogue.manage", "inventory.view", "inventory.purchases", "orders.view", "orders.manage",
  "cms.manage", "reviews.manage", "coupons.manage", "expenses.manage", "documents.view", "audit.view", "staff.manage", "ai.use", "ai.manage", "settings.manage", "loyalty.redeem", "importexport.run",
];

function homeSeed() {
  return homeDocSchema.parse({
    sections: [
      { type: "hero", id: "hero-1", slides: [{ imageUrl: "https://cdn.example.com/hero1.jpg", heading: "Welcome to Anbu Textiles", subheading: "Silk and cotton sarees", cta: { label: "Shop now", href: "/products" } }] },
      { type: "usp", id: "usp-1", items: [{ icon: "truck", title: "Delivery across Tamil Nadu", text: "" }, { icon: "return", title: "Easy exchange", text: "" }] },
      { type: "categories", id: "cat-1", title: "Shop by category", layout: "circles" },
      { type: "collection", id: "col-1", title: "Silk sarees", collectionSlug: "silk-sarees", layout: "carousel", limit: 8 },
      { type: "offer", id: "offer-1", heading: "Festival offer", text: "Special prices this week", cta: { label: "See offers", href: "/collections/offers" } },
      { type: "faq", id: "faq-1", title: "Questions", items: [{ q: "Do you deliver?", a: "Yes, we deliver." }] },
    ],
  });
}

export interface FakeShop {
  ports: StudioPorts;
  areas: Map<AreaId, unknown>;
  writes: { area: AreaId; before: unknown; after: unknown }[];
  /** Set a feature's state (reason when off). */
  setFeature(key: string, on: boolean, reason?: FeatureStatus["reason"]): void;
  env: StudioEnv;
  /** Staff members holding a role key. */
  roleMembers: Record<string, number>;
  failWrite?: AreaId;
}

export function fakeShop(over: { trade?: string } = {}): FakeShop {
  const areas = new Map<AreaId, unknown>();
  const writes: FakeShop["writes"] = [];
  const features = new Map<string, FeatureStatus & { shopToggle: boolean; shopEnabled: boolean | null }>();
  const feat = (key: string, label: string, on = true, shopToggle = false) => features.set(key, { enabled: on, reason: on ? null : "shop", label, shopToggle, shopEnabled: shopToggle ? on : null });
  feat("storefront", "Online store");
  feat("cms", "Website content");
  feat("invoices", "Billing");
  feat("invoices.quotations", "Quotations");
  feat("staff", "Team");
  feat("ai", "AI assistance");
  feat("cms.blog", "Blog", true, true);
  feat("reviews", "Reviews", true, true);
  feat("loyalty", "Loyalty points", false, true);

  areas.set("branding", { appName: null, tokens: {} });
  areas.set("home", { doc: homeSeed(), unpublished: false });
  areas.set("menu:header", { items: [{ id: "h1", label: "Home", type: "url", href: "/" }, { id: "h2", label: "Sarees", type: "category", ref: "sarees" }, { id: "h3", label: "About", type: "page", ref: "about" }] });
  areas.set("menu:footer", { items: [{ id: "f1", label: "Contact", type: "url", href: "/contact" }] });
  areas.set("page:about", { exists: true, id: "pg-about", slug: "about", title: "About us", blocks: [{ type: "paragraph", id: "p1", markdown: "We are a family shop." }], status: "published" });
  for (const ns of Object.keys(DEFAULTS)) areas.set(`settings:${ns}`, { layer: {}, effective: structuredClone(DEFAULTS[ns]) });
  areas.set("roles", {
    roles: [
      { key: "default", name: "Staff (default)", description: "", permissions: ["*.view", "invoices.create", "invoices.discount"], builtin: true },
      { key: "manager", name: "Manager", description: "", permissions: ["*.view", "catalogue.*", "cms.*", "invoices.*", "ai.use"], builtin: true },
      { key: "cashier", name: "Cashier", description: "", permissions: ["invoices.create", "invoices.credit-note", "payments.receive", "customers.create", "catalogue.view"], builtin: true },
      { key: "accountant", name: "Accountant", description: "", permissions: ["reports.view", "expenses.manage"], builtin: true },
    ],
  });
  areas.set("discounts", { items: [] });
  areas.set("signin", { staff: { methods: ["sms", "whatsapp", "email_code", "google"], default: "sms" }, customer: { methods: ["google", "sms", "whatsapp", "email_code"], default: "google" } });

  const shop: FakeShop = {
    areas,
    writes,
    roleMembers: {},
    setFeature(key, on, reason = on ? null : "shop") {
      const cur = features.get(key) ?? { enabled: on, reason: null, label: key, shopToggle: false, shopEnabled: null };
      features.set(key, { ...cur, enabled: on, reason: on ? null : reason });
    },
    env: {
      now: new Date("2026-10-25T10:00:00Z"),
      brandDefaults: JSON.parse(JSON.stringify(DEFAULT_BRAND_TOKENS)),
      knownPermissions: FIXTURE_PERMISSIONS,
      signInPlatform: { sms: true, whatsapp: true, email_code: true, google: true, password: false },
      trade: over.trade ?? "fashion",
      refs: { categories: ["sarees", "kurtas", "kids"], categoryIds: ["11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222", "33333333-3333-4333-8333-333333333333"], collections: ["silk-sarees", "pongal-special", "offers"], pages: ["about", "contact"] },
      toggles: [...features].filter(([, f]) => f.shopToggle).map(([key, f]) => ({ key, label: f.label })),
    },
    ports: undefined as never,
  };

  const readOne = (area: AreaId): unknown => {
    if (area.startsWith("page:") && !areas.has(area)) return { exists: false, id: null, slug: area.slice(5), title: "", blocks: [], status: "draft" };
    if (area.startsWith("feature:")) {
      const key = area.slice(8);
      const f = features.get(key);
      return f ? { key, label: f.label, shopEnabled: f.shopEnabled, enabled: f.enabled, reason: f.reason, shopToggle: f.shopToggle } : { key, label: key, shopEnabled: null, enabled: false, reason: "app", shopToggle: false };
    }
    if (!areas.has(area)) throw new Error(`fake shop has no area ${area}`);
    return structuredClone(areas.get(area));
  };

  shop.ports = {
    async env() {
      return structuredClone(shop.env);
    },
    async readAreas(_t, list) {
      return Object.fromEntries(list.map((a) => [a, readOne(a)]));
    },
    async writeArea(_ctx, area, before, after) {
      if (shop.failWrite === area) throw new Error("write refused");
      writes.push({ area, before: structuredClone(before), after: structuredClone(after) });
      const a = structuredClone(after) as any;
      if (area.startsWith("settings:")) {
        const ns = area.slice(9);
        a.effective = { ...structuredClone(DEFAULTS[ns]), ...a.layer };
        areas.set(area, a);
      } else if (area.startsWith("page:")) {
        if (!a.exists) areas.delete(area);
        else areas.set(area, { ...a, id: a.id ?? `pg-${a.slug}` });
      } else if (area.startsWith("feature:")) {
        const key = area.slice(8);
        const f = features.get(key)!;
        features.set(key, { ...f, shopEnabled: a.shopEnabled, enabled: a.shopEnabled === null ? true : a.shopEnabled, reason: a.shopEnabled === false ? "shop" : null });
      } else if (area === "home") areas.set(area, { doc: a.doc, unpublished: false });
      else areas.set(area, a);
    },
    async feature(_t, key): Promise<FeatureStatus> {
      const f = features.get(key);
      return f ? { enabled: f.enabled, reason: f.reason, label: f.label } : { enabled: false, reason: "app", label: key };
    },
    async features(): Promise<FeatureRow[]> {
      return [...features].map(([key, f]) => ({ key, label: f.label, enabled: f.enabled, switchable: f.shopToggle }));
    },
    async catalogue(): Promise<CatalogueGlance> {
      return {
        categories: [
          { id: "11111111-1111-4111-8111-111111111111", slug: "sarees", name: "Sarees", products: 40 },
          { id: "22222222-2222-4222-8222-222222222222", slug: "kurtas", name: "Kurtas", products: 18 },
          { id: "33333333-3333-4333-8333-333333333333", slug: "kids", name: "Kids wear", products: 9 },
        ],
        collections: [{ slug: "silk-sarees", title: "Silk sarees" }, { slug: "pongal-special", title: "Pongal special" }, { slug: "offers", title: "Offers" }],
        products: [{ name: "Kanchipuram silk saree", price: 8500 }, { name: "Cotton kurta", price: 899 }],
      };
    },
    async pages() {
      return [{ slug: "about", title: "About us", status: "published" }, { slug: "contact", title: "Contact", status: "draft" }];
    },
    async roleMembers(_t, key) {
      return shop.roleMembers[key] ?? 0;
    },
    async audit() {},
  };
  return shop;
}

export const OWNER: StudioActor = { userId: "u-owner", fullAccess: true, permissions: ["*"] };
/** A team member with Studio access but no owner rights: AI management and content, no team or settings. */
export const MANAGER: StudioActor = { userId: "u-manager", fullAccess: false, permissions: ["ai.use", "ai.manage", "cms.*", "catalogue.*", "invoices.*", "reports.*"] };
export const CASHIER: StudioActor = { userId: "u-cashier", fullAccess: false, permissions: ["invoices.create", "ai.manage"] };
export const DEMO: StudioActor = { userId: "u-demo", fullAccess: false, permissions: ["*.view"], demo: true };
