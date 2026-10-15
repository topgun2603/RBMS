import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildNavModel, checkGate, createWebApp, matchRoute, normalizeBase, type GateContext, type MountedModule } from "@srirealtime/web";
import { kycErrorKey } from "./lib/logic";
import { marketplaceMessages } from "./lib/messages";
import {
  KYC_CHECK_TYPES,
  LEDGER_TYPES,
  ORDER_STATUSES,
  PAYOUT_ACCOUNT_STATUSES,
  PAYOUT_PROVIDERS,
  PAYOUT_STATUSES,
  SETTLEMENT_STATUSES,
  VENDOR_KYC_STATUSES,
  VENDOR_STATUSES,
} from "./lib/types";
import { MARKETPLACE_MANAGE, marketplaceModule, VENDOR_PAGES } from "./module";
import { portalPageOf, PORTAL_NAV, relativePath } from "./portal/pages";

const mount = (opts: Parameters<typeof marketplaceModule>[0] = {}): MountedModule => {
  const m = marketplaceModule(opts);
  return { ...m, basePath: normalizeBase(m.basePath) };
};

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? sources(p) : /\.tsx?$/.test(f) && !f.endsWith(".test.ts") ? [p] : [];
  });
}

const on = (keys: string[]) => (req: unknown) => {
  const need = req === undefined ? [] : Array.isArray(req) ? (req as string[]) : [req as string];
  const off = need.find((k) => !keys.includes(k));
  return off ? { ok: false as const, key: off, reason: "plan" as const } : { ok: true as const };
};

const ctx = (o: { roles?: string[]; permissions?: string[] | null; full?: boolean; features?: string[] }): GateContext =>
  ({
    roles: o.roles ?? ["staff"],
    access: { fullAccess: o.full ?? false, permissions: o.permissions === undefined ? [] : o.permissions },
    checkFeature: on(o.features ?? ["marketplace", "marketplace.payouts", "kyc"]),
  }) as unknown as GateContext;

describe("admin module", () => {
  const m = mount();

  it("mounts at /marketplace by default and as given", () => {
    expect(m.basePath).toBe("/marketplace");
    expect(mount({ basePath: "/sellers" }).basePath).toBe("/sellers");
  });

  it("gates every nav item, route, widget and settings page by feature and marketplace.manage", () => {
    const gated = [...m.nav, ...m.nav.flatMap((s) => s.items), ...m.routes, ...(m.widgets ?? []), ...(m.settings ?? [])];
    for (const g of gated) {
      expect(g.feature, JSON.stringify(g)).toBeTruthy();
      expect(g.permission).toBe(MARKETPLACE_MANAGE);
    }
    const payouts = [m.nav[0]!.items.find((i) => i.href === "payouts"), m.routes.find((r) => r.path === "payouts"), m.widgets?.find((w) => w.id === "marketplace-payable")];
    for (const g of payouts) expect(g?.feature).toEqual(["marketplace", "marketplace.payouts"]);
  });

  it("hides the section from staff without the permission and shows it to holders and owners", () => {
    const section = m.nav[0]!;
    expect(checkGate(section, m, ctx({ permissions: ["orders.view"] })).ok).toBe(false);
    expect(checkGate(section, m, ctx({ permissions: ["marketplace.manage"] })).ok).toBe(true);
    expect(checkGate(section, m, ctx({ permissions: ["marketplace.*"] })).ok).toBe(true);
    expect(checkGate(section, m, ctx({ roles: ["owner"], full: true })).ok).toBe(true);
  });

  it("hides payouts when marketplace.payouts is off, and everything when marketplace is off", () => {
    const holder = { permissions: ["marketplace.manage"] };
    const payouts = m.routes.find((r) => r.path === "payouts")!;
    const vendors = m.routes.find((r) => r.path === "vendors")!;
    expect(checkGate(payouts, m, ctx({ ...holder, features: ["marketplace"] })).ok).toBe(false);
    expect(checkGate(vendors, m, ctx({ ...holder, features: ["marketplace"] })).ok).toBe(true);
    expect(checkGate(vendors, m, ctx({ ...holder, features: [] })).ok).toBe(false);
  });

  it("keeps settings for owners and admins (the settings API needs them)", () => {
    const settings = m.routes.find((r) => r.path === "settings")!;
    expect(checkGate(settings, m, ctx({ roles: ["staff"], permissions: ["marketplace.manage"] })).ok).toBe(false);
    expect(checkGate(settings, m, ctx({ roles: ["admin"], full: true })).ok).toBe(true);
  });

  it("matches vendors/:id and the module root", () => {
    const app = { modules: [m] } as Parameters<typeof matchRoute>[0];
    const id = "0b6f5f36-0000-4000-8000-000000000000";
    expect(matchRoute(app, `/marketplace/vendors/${id}`, (x) => x.routes)?.params).toEqual({ id });
    expect(matchRoute(app, "/marketplace", (x) => x.routes)?.route.path).toBe("");
    expect(matchRoute(app, "/marketplace/payouts", (x) => x.routes)?.route.path).toBe("payouts");
  });

  it("builds nav hrefs under the base path", () => {
    const app = createWebApp({ appId: "EC", tenant: { from: "hostname" }, modules: [marketplaceModule()] });
    const nav = buildNavModel(app, () => true, []);
    const hrefs = nav.sections.flatMap((s) => s.items.map((i) => i.href));
    expect(hrefs).toEqual(["/marketplace/vendors", "/marketplace/payouts", "/marketplace/settings"]);
  });
});

describe("vendor portal module", () => {
  const m = mount({ portal: "vendor", basePath: "/" });

  it("serves every portal page as a public route (sellers hold no shop role) behind the marketplace feature", () => {
    expect(m.routes).toEqual([]);
    expect(m.nav).toEqual([]);
    expect(m.publicRoutes?.map((r) => r.path)).toEqual([...VENDOR_PAGES]);
    for (const r of m.publicRoutes ?? []) expect(r.feature).toBe("marketplace");
    // One component for every page keeps the portal frame mounted between pages.
    expect(new Set(m.publicRoutes?.map((r) => r.component)).size).toBe(1);
  });

  it("matches products/new before products/:id", () => {
    const app = { modules: [m] } as Parameters<typeof matchRoute>[0];
    expect(matchRoute(app, "/products/new", (x) => x.publicRoutes)?.route.path).toBe("products/new");
    expect(matchRoute(app, "/products/abc", (x) => x.publicRoutes)?.params).toEqual({ id: "abc" });
    expect(matchRoute(app, "/", (x) => x.publicRoutes)?.route.path).toBe("");
    expect(matchRoute(app, "/login", (x) => x.publicRoutes)).toBeNull();
  });

  it("resolves portal pages from the path", () => {
    expect(relativePath("/", "/products/42")).toBe("products/42");
    expect(relativePath("/seller", "/seller")).toBe("");
    expect(relativePath("/seller", "/seller/orders?x=1")).toBe("orders");
    expect(relativePath("/seller", "/other")).toBeNull();
    expect(portalPageOf("")?.page).toBe("dashboard");
    expect(portalPageOf("products/new")?.page).toBe("product-new");
    expect(portalPageOf("products/7")).toEqual({ page: "product-edit", params: { id: "7" } });
    expect(portalPageOf("nope")).toBeNull();
    for (const p of VENDOR_PAGES) expect(portalPageOf(p.replace(":id", "x")), p).not.toBeNull();
    for (const n of PORTAL_NAV) expect(portalPageOf(n.href)?.page).toBe(n.page);
  });
});

describe("messages", () => {
  const { en, ta } = marketplaceMessages;

  it("has the same keys in English and Tamil", () => {
    expect(Object.keys(ta).sort()).toEqual(Object.keys(en).sort());
  });

  it("defines every literal marketplace.* key used in the source", () => {
    const used = new Set<string>();
    for (const file of sources(__dirname)) {
      for (const m of readFileSync(file, "utf8").matchAll(/["'`](marketplace\.[a-zA-Z0-9_.-]+)["'`]/g)) used.add(m[1]!);
    }
    const notMessages = new Set(["marketplace.manage", "marketplace.payouts"]); // feature / permission keys
    const missing = [...used].filter((k) => !(k in en) && !notMessages.has(k) && !k.endsWith("."));
    expect(missing).toEqual([]);
  });

  it("defines every key built from a status or type", () => {
    const families: [string, readonly string[]][] = [
      ["marketplace.status.", VENDOR_STATUSES],
      ["marketplace.kyc.status.", [...VENDOR_KYC_STATUSES, "manual_review"]],
      ["marketplace.kyc.check.", ["pending", "verified", "failed", "manual_review"]],
      ["marketplace.kyc.type.", KYC_CHECK_TYPES],
      ["marketplace.account.status.", PAYOUT_ACCOUNT_STATUSES],
      ["marketplace.payout.status.", PAYOUT_STATUSES],
      ["marketplace.settlement.", SETTLEMENT_STATUSES],
      ["marketplace.orderStatus.", ORDER_STATUSES],
      ["marketplace.ledger.type.", LEDGER_TYPES],
      ["marketplace.settings.provider.", PAYOUT_PROVIDERS],
      ["marketplace.settings.providerHint.", PAYOUT_PROVIDERS],
      ["marketplace.payouts.skip.", ["nothing_due", "below_minimum", "vendor_not_active", "kyc_not_verified", "no_payout_account", "account_not_supported"]],
      ["marketplace.products.status.", ["draft", "active", "archived"]],
      ["marketplace.role.", ["owner", "staff"]],
      ["marketplace.onboarding.state.", ["done", "waiting", "failed", "todo"]],
      ["marketplace.onboarding.approval.", VENDOR_STATUSES],
    ];
    const missing = families.flatMap(([prefix, values]) => values.map((v) => prefix + v)).filter((k) => !(k in en));
    expect(missing).toEqual([]);
    for (const code of ["invalid_pan", "account_not_found", "vpa_not_found", "name_mismatch", "provider_server_error", "x"]) expect(en[kycErrorKey(code)], code).toBeTruthy();
  });

  it("keeps placeholders the same in both languages", () => {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
    const diff = Object.keys(en).filter((k) => JSON.stringify(vars(en[k]!)) !== JSON.stringify(vars(ta[k]!)));
    expect(diff).toEqual([]);
  });

  it("uses Tamil script for Tamil strings, with no Hindi", () => {
    const latinOnly = Object.entries(ta).filter(([, v]) => !/[஀-௿]/.test(v));
    // Identifiers and brand names stay Latin.
    const allowed = /(type\.(pan|gstin)|kyc\.(pan|title)|col\.kyc|account\.(ifsc|upi|route)|provider\.razorpayRoute|editor\.(mrp|sku|tax|optionValuesPlaceholder)|profile\.gstin|payouts\.period|common\.range)$/;
    expect(latinOnly.map(([k]) => k).filter((k) => !allowed.test(k))).toEqual([]);
    const hindi = Object.entries(ta).filter(([, v]) => /[ऀ-ॿ]|\b(khata|khaata|bahi|udhaar|hisaab)\b/i.test(v));
    expect(hindi).toEqual([]);
  });
});
