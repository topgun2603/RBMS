import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isValidGstin } from "@srirealtime/gst";
import { buildNavModel, featureChecker, normalizeBase, type FeatureState, type MountedModule } from "@srirealtime/web";
import { permissionMatches } from "./lib/access";
import { gstFromInclusive, itcFor } from "./lib/expenses";
import { billingMessages } from "./lib/messages";
import { PDF_PATHS } from "./lib/pdf";
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

describe("expenses, profit and PDFs", () => {
  it("shows Expenses under Insights only when the expenses feature is on", () => {
    const m = mount("/");
    const on = featureChecker({
      ...featuresOf("raja"),
      enabled: [...featuresOf("raja").enabled, "expenses"],
      features: [
        ...featuresOf("raja").features,
        { key: "expenses", module: "expenses", label: "", description: "", dependsOn: [], shopToggle: true, enabled: true, reason: null, available: true, shopEnabled: null },
      ],
    });
    const insights = m.nav.find((s) => s.id === "insights")!;
    expect(insights.items.filter((i) => on.check(i.feature, m.features).ok).map((i) => i.href)).toEqual(["reports", "expenses"]);
    expect(m.routes.find((r) => r.path === "expenses")?.feature).toBe("expenses");
    expect(navHrefs("raja", m)).not.toContain("/expenses");
  });

  it("works out GST inside an inclusive amount and ITC only with a valid GSTIN", () => {
    expect(gstFromInclusive(11800, 18)).toBe(1800);
    expect(gstFromInclusive(10000, 0)).toBe(0);
    expect(itcFor(1800, "33ABCDE1234F1Z5")).toBe(isValidGstin("33ABCDE1234F1Z5") ? 1800 : 0);
    expect(itcFor(1800, "")).toBe(0);
    expect(itcFor(1800, "33ABCDE1234F1Z4X")).toBe(0);
  });

  it("matches permission patterns like the server", () => {
    expect(permissionMatches("expenses.*", "expenses.manage")).toBe(true);
    expect(permissionMatches("*.view", "expenses.manage")).toBe(false);
    expect(permissionMatches("*", "expenses.manage")).toBe(true);
  });

  it("builds the documents PDF paths", () => {
    expect(PDF_PATHS.invoice("abc")).toBe("/documents/invoice/abc.pdf");
    expect(PDF_PATHS.invoiceThermal("abc")).toBe("/documents/invoice-thermal/abc.pdf");
    expect(PDF_PATHS.statement("c1")).toBe("/documents/statement/c1.pdf");
    expect(PDF_PATHS.purchase("p1")).toBe("/documents/purchase/p1.pdf");
  });
});

describe("messages", () => {
  const { en, ta } = billingMessages;

  it("has the same keys in English and Tamil", () => {
    expect(Object.keys(ta).sort()).toEqual(Object.keys(en).sort());
  });

  it("defines every literal billing.* key used by the expenses, profit and PDF screens", () => {
    const files = [
      "pages/expenses.tsx",
      "components/expenses/expense-dialog.tsx",
      "components/expenses/categories-dialog.tsx",
      "components/reports/profit-tab.tsx",
      "lib/pdf.ts",
      "pages/invoice-detail.tsx",
      "pages/customer-detail.tsx",
      "pages/purchase-detail.tsx",
      "pages/reports.tsx",
      "module.tsx",
    ];
    const used = new Set<string>();
    for (const f of files) for (const m of readFileSync(join(__dirname, f), "utf8").matchAll(/["'`](billing\.[a-zA-Z0-9_.-]+)["'`]/g)) used.add(m[1]!);
    const dynamic = [
      ...["rent", "salaries", "electricity", "transport", "packaging", "marketing", "repairs", "other"].map((c) => `billing.expenses.categories.${c}`),
      ...["cash", "upi", "card", "bank", "cheque", "other"].map((m) => `billing.payment.methods.${m}`),
      "billing.reports.tabs.profit",
    ];
    expect([...used, ...dynamic].filter((k) => !(k in en) && !k.endsWith("."))).toEqual([]);
  });

  it("uses Tamil script for the new Tamil strings", () => {
    const keys = Object.keys(en).filter((k) => /^billing\.(expenses|pdf|reports\.profit)\./.test(k) || k === "billing.nav.expenses");
    const latin = keys.filter((k) => !/[஀-௿]/.test(ta[k]!) && !/^[A-Z0-9 ()%/.{}+·#-]+$/i.test(ta[k]!));
    expect(latin).toEqual([]);
  });
});

describe("permission gating (Gated.permission)", () => {
  it("gates expenses nav and route by expenses.manage", () => {
    const m = billingModule();
    const item = m.nav.flatMap((s) => s.items).find((i) => i.href === "expenses");
    const route = m.routes.find((r) => r.path === "expenses");
    expect(item?.permission).toBe("expenses.manage");
    expect(route?.permission).toBe("expenses.manage");
  });
});
