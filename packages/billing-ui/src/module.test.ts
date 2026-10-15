import { describe, expect, it } from "vitest";
import { buildNavModel, featureChecker, normalizeBase, type FeatureState, type MountedModule } from "@srirealtime/web";
import { billingModule } from "./module";

/** GET /v1/features answers of the demo shops (enabled / reason), as seeded in apps/api. */
const SHOPS: Record<string, Record<string, [boolean, FeatureState["reason"]]>> = {
  raja: {},
  kumar: { "invoices.reminders": [false, "plan"], "inventory.purchases": [false, "plan"] },
  anbu: { "invoices.reminders": [false, "app"], "invoices.credit-book": [false, "app"], "inventory.purchases": [false, "app"] },
};
const KEYS = ["invoices", "invoices.whatsapp", "invoices.reminders", "invoices.credit-book", "invoices.reports", "invoices.gst-reports", "payments", "inventory", "inventory.purchases"];

function featuresOf(shop: string) {
  const off = SHOPS[shop]!;
  return {
    appId: shop === "anbu" ? "EC" : "BL",
    planId: shop === "kumar" ? "starter" : "pro",
    enabled: KEYS.filter((k) => !off[k]),
    features: KEYS.map<FeatureState>((key) => ({
      key,
      module: key.split(".")[0]!,
      label: key,
      description: "",
      dependsOn: [],
      shopToggle: true,
      enabled: !off[key],
      reason: off[key]?.[1] ?? null,
      available: !off[key],
      shopEnabled: null,
    })),
  };
}

function mount(basePath: string, features?: string[]): MountedModule {
  const m = billingModule({ basePath, features });
  return { ...m, basePath: normalizeBase(m.basePath) };
}

function visibleFor(shop: string) {
  const { check } = featureChecker(featuresOf(shop));
  return (g: { feature?: string | readonly string[] }, m?: { features?: readonly string[] }) => check(g.feature, m?.features).ok;
}

function navHrefs(shop: string, module: MountedModule) {
  const visible = visibleFor(shop);
  const settings = (module.settings ?? []).filter((p) => visible(p, module)).map((p) => ({ href: `/settings/${p.path}`.replace(/\/$/, ""), label: p.label }));
  return buildNavModel({ modules: [module] }, visible, settings).sections.flatMap((s) => s.items.map((i) => i.href));
}

describe("billingModule", () => {
  it("declares a feature on every route, widget, action and settings page", () => {
    const m = billingModule();
    for (const r of [...m.routes, ...(m.publicRoutes ?? [])]) expect(r.feature, r.path).toBeTruthy();
    for (const w of m.widgets ?? []) expect(w.feature, w.id).toBeTruthy();
    for (const a of m.actions ?? []) expect(a.feature, a.id).toBeTruthy();
    for (const p of m.settings ?? []) expect(p.feature, p.path).toBeTruthy();
    for (const s of m.nav) for (const i of s.items) if (i.href !== "") expect(i.feature, i.href).toBeTruthy();
  });

  it("never uses absolute paths (the host picks the basePath)", () => {
    const m = billingModule({ basePath: "/billing" });
    const paths = [...m.routes.map((r) => r.path), ...m.nav.flatMap((s) => s.items.map((i) => i.href)), ...(m.actions ?? []).map((a) => a.href)];
    for (const p of paths) expect(p.startsWith("/"), p).toBe(false);
  });

  it("raja (BL, pro) gets everything at /", () => {
    expect(navHrefs("raja", mount("/"))).toEqual([
      "/",
      "/invoices",
      "/credit-book",
      "/customers",
      "/items",
      "/stock",
      "/purchases",
      "/suppliers",
      "/reports",
      "/settings",
      "/settings/payments",
      "/settings/reminders",
    ]);
  });

  it("kumar (BL, starter) loses purchases, suppliers and reminders", () => {
    const hrefs = navHrefs("kumar", mount("/"));
    expect(hrefs).toContain("/credit-book");
    expect(hrefs).toContain("/stock");
    expect(hrefs).not.toContain("/purchases");
    expect(hrefs).not.toContain("/suppliers");
    expect(hrefs).not.toContain("/settings/reminders");
  });

  it("anbu (EC) at /billing: no credit book, reminders or purchases, with no special-casing", () => {
    const m = mount("/billing");
    expect(navHrefs("anbu", m)).toEqual([
      "/billing",
      "/billing/invoices",
      "/billing/customers",
      "/billing/items",
      "/billing/stock",
      "/billing/reports",
      "/settings",
      "/settings/payments",
    ]);
    const visible = visibleFor("anbu");
    expect((m.widgets ?? []).filter((w) => visible(w, m)).map((w) => w.id)).toEqual([
      "sales-hero",
      "sales-trend",
      "payments-by-method",
      "recent-bills",
      "low-stock",
    ]);
    expect((m.actions ?? []).filter((a) => visible(a, m)).map((a) => a.id)).toEqual(["new-bill"]);
    expect(m.nav.map((s) => s.id)).toEqual(["billing"]);
  });

  it("the host can restrict features further", () => {
    const m = mount("/", ["invoices"]);
    expect(navHrefs("raja", m)).toEqual(["/", "/invoices", "/customers", "/items", "/settings"]);
  });
});
