import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { isValidGstin } from "@rbms/gst";
import { buildNavModel, featureChecker, normalizeBase, type FeatureState, type MountedModule } from "@rbms/web";
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

/** The settings pages the shop may open (listed by the settings rail since 192ea93, not by the sidebar). */
function settingsHrefs(shop: string, module: MountedModule) {
  const visible = visibleFor(shop);
  return (module.settings ?? []).filter((p) => visible(p, module)).map((p) => `/settings/${p.path}`.replace(/\/$/, ""));
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

  it("hides the report and credit-book dashboard widgets (and the receive-money action) from roles without the permission", () => {
    const m = billingModule();
    const need = (id: string) => m.widgets?.find((w) => w.id === id)?.permission;
    expect(need("sales-trend")).toBe("reports.view");
    expect(need("payments-by-method")).toBe("reports.view");
    expect(need("top-dues")).toBe("invoices.credit-book");
    expect(m.actions?.find((a) => a.id === "receive-money")?.permission).toBe("invoices.credit-book");
    // the widgets that only use the bill summary stay open to every member
    expect(need("recent-bills")).toBeUndefined();
    expect(need("kpi-sales")).toBeUndefined();
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
      "/batches",
      "/pricing-hints",
      "/stock-audit",
      "/purchases",
      "/purchase-orders",
      "/suppliers",
      "/payables",
      "/reports",
      "/gst",
      "/settings",
    ]);
    // The sidebar has one Settings link; the pages themselves are in the settings rail.
    expect(settingsHrefs("raja", mount("/"))).toEqual(["/settings", "/settings/payments", "/settings/reminders"]);
  });

  it("kumar (BL, starter) loses purchases, suppliers and reminders", () => {
    const hrefs = navHrefs("kumar", mount("/"));
    expect(hrefs).toContain("/credit-book");
    expect(hrefs).toContain("/stock");
    expect(hrefs).not.toContain("/purchases");
    expect(hrefs).not.toContain("/suppliers");
    expect(hrefs).not.toContain("/purchase-orders");
    expect(hrefs).not.toContain("/payables");
    expect(settingsHrefs("kumar", mount("/"))).not.toContain("/settings/reminders");
  });

  it("anbu (EC) at /billing: no credit book, reminders or purchases, with no special-casing", () => {
    const m = mount("/billing");
    expect(navHrefs("anbu", m)).toEqual([
      "/billing",
      "/billing/invoices",
      "/billing/customers",
      "/billing/items",
      "/billing/stock",
      "/billing/batches",
      "/billing/pricing-hints",
      "/billing/stock-audit",
      "/billing/reports",
      "/billing/gst",
      "/settings",
    ]);
    expect(settingsHrefs("anbu", m)).toEqual(["/settings", "/settings/payments"]);
    const visible = visibleFor("anbu");
    expect((m.widgets ?? []).filter((w) => visible(w, m)).map((w) => w.id)).toEqual([
      "kpi-sales",
      "kpi-to-collect",
      "kpi-collected",
      "kpi-overdue",
      "kpi-expiry",
      "attention",
      "sales-trend",
      "recent-bills",
      "payments-by-method",
      "low-stock",
    ]);
    // Every widget sits in an explicit zone of the structured dashboard.
    for (const w of m.widgets ?? []) expect(w.zone, w.id).toBeTruthy();
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
    expect(insights.items.filter((i) => on.check(i.feature, m.features).ok).map((i) => i.href)).toEqual(["reports", "gst", "expenses"]);
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

describe("accounting screens", () => {
  const { en, ta } = billingMessages;
  const files = [
    "pages/accounting.tsx",
    "pages/accounting-accounts.tsx",
    "pages/accounting-journal.tsx",
    "pages/accounting-journal-new.tsx",
    "pages/accounting-day-book.tsx",
    "pages/accounting-ledger.tsx",
    "pages/accounting-trial-balance.tsx",
    "pages/accounting-profit-loss.tsx",
    "pages/accounting-balance-sheet.tsx",
    "pages/accounting-gst.tsx",
    "pages/accounting-checks.tsx",
    "pages/accounting-settings.tsx",
    "pages/accounting-help.tsx",
    "components/accounting/parts.tsx",
    "components/accounting/entry-dialog.tsx",
    "module.tsx",
  ];

  it("defines every billing.accounting.* key the screens use, in English and Tamil", () => {
    const used = new Set<string>();
    for (const f of files) for (const m of readFileSync(join(__dirname, f), "utf8").matchAll(/["'`](billing\.accounting\.[a-zA-Z0-9_.]+)["'`]/g)) used.add(m[1]!);
    const groups = ["cash_bank", "receivables", "stock", "tax_assets", "current_assets", "fixed_assets", "payables", "tax_liabilities", "current_liabilities", "loans", "capital", "sales", "other_income", "direct", "indirect"];
    const sources = ["account_opening", "opening_parties", "invoice", "invoice_cancel", "invoice_payment", "customer_receipt", "credit_note", "purchase", "purchase_cancel", "supplier_payment", "supplier_payment_reversal", "debit_note", "debit_note_cancel", "expense", "expense_cancel", "till_difference", "till_cash", "stock_adjustment"];
    const dynamic = [
      ...["newEntry", "dayBook", "trialBalance", "profitLoss", "balanceSheet", "accounts", "settings", "howItWorks"].flatMap((k) => [`billing.accounting.nav.${k}`, `billing.accounting.about.${k}`]),
      ...groups.flatMap((g) => [`billing.accounting.group.${g}`, `billing.accounting.groupAbout.${g}`]),
      ...["asset", "liability", "equity", "income", "expense"].map((x) => `billing.accounting.type.${x}`),
      ...["journal", "contra", "payment", "receipt", "auto", "reversal"].map((x) => `billing.accounting.voucher.${x}`),
      ...sources.map((s) => `billing.accounting.source.${s}`),
      ...["payment", "receipt", "contra", "journal"].map((k) => `billing.accounting.new.about.${k}`),
      ...["payment", "receipt", "contra"].map((k) => `billing.accounting.new.preview.${k}`),
      ...["trial_balance", "sales", "sales_taxable", "sales_returns", "receivables", "payables", "gst_output", "gst_input"].map((k) => `billing.accounting.checks.${k}`),
      ...["invoice", "payment", "receipt", "creditNote", "purchase", "supplierPayment", "debitNote", "expense", "till", "stock", "opening"].flatMap((k) => [`billing.accounting.help.auto.${k}.when`, `billing.accounting.help.auto.${k}.what`]),
      ...["lock", "reports", "basis", "stockValue", "limits"].flatMap((k) => [`billing.accounting.help.${k}Title`, `billing.accounting.help.${k}Body`]),
    ];
    const all = [...used, ...dynamic].filter((k) => !k.endsWith("."));
    expect(all.filter((k) => !(k in en))).toEqual([]);
    expect(all.filter((k) => !(k in ta))).toEqual([]);
  });

  it("has Tamil script in every Tamil accounting string (apart from numbers and symbols)", () => {
    const keys = Object.keys(en).filter((k) => k.startsWith("billing.accounting."));
    const latin = keys.filter((k) => !/[஀-௿]/.test(ta[k]!) && !/^[A-Z0-9 ()%/.{}+·#-]+$/i.test(ta[k]!));
    expect(latin).toEqual([]);
  });

  it("keeps the same {placeholders} in both languages", () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]).sort().join(",");
    const bad = Object.keys(en).filter((k) => k.startsWith("billing.accounting.") && ph(en[k]!) !== ph(ta[k]!));
    expect(bad).toEqual([]);
  });

  it("shows the accounting pages only with the accounting feature and the view permission", () => {
    const m = billingModule();
    const items = m.nav.flatMap((s) => s.items).filter((i) => i.href.startsWith("accounting"));
    expect(items.length).toBeGreaterThanOrEqual(8);
    for (const i of items) {
      expect(i.feature, i.href).toBe("accounting");
      expect(i.permission, i.href).toBe("accounting.view");
    }
    const routes = m.routes.filter((r) => r.path.startsWith("accounting"));
    expect(routes.map((r) => r.path)).toEqual(expect.arrayContaining(["accounting", "accounting/accounts", "accounting/journal", "accounting/journal/new", "accounting/day-book", "accounting/ledger", "accounting/trial-balance", "accounting/profit-loss", "accounting/balance-sheet", "accounting/settings", "accounting/how-it-works"]));
    expect(routes.find((r) => r.path === "accounting/journal/new")?.permission).toBe("accounting.post");
    expect(m.settings?.find((s) => s.path === "accounting")?.feature).toBe("accounting");
  });

  it("is hidden for shops whose plan lacks the feature", () => {
    expect(navHrefs("raja", mount("/")).some((h) => h.startsWith("/accounting"))).toBe(false);
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

describe("GST center", () => {
  const { en, ta } = billingMessages;
  const files = [
    "pages/gst.tsx",
    "components/gst/shared.tsx",
    "components/gst/overview-tab.tsx",
    "components/gst/gstr1-tab.tsx",
    "components/gst/gstr3b-tab.tsx",
    "components/gst/itc-tab.tsx",
    "components/gst/itc-dialog.tsx",
    "components/gst/rcm-section.tsx",
    "components/gst/gstr2b-tab.tsx",
    "components/gst/composition-tab.tsx",
    "components/gst/settings-tab.tsx",
    "lib/gst.ts",
  ];
  const profile = ["no_gstin", "invalid_gstin", "no_state"];
  const g1 = ["seller_gstin_missing", "seller_gstin_other", "buyer_gstin_invalid", "hsn_missing", "hsn_short", "hsn_invalid", "unit_missing", "pos_invalid", "inter_flag_mismatch", "tax_mismatch", "rate_unusual", "duplicate_number", "number_gap", "tax_on_bill_of_supply", "negative_total", "no_documents"];
  const others = ["overdue", "itc_no_gstin", "itc_lapsed", "itc_rule37", "rcm_unpaid", "composition_inter_state", "composition_tax_charged", "composition_limit", "qrmp_over_5cr", "turnover_over_5cr"];
  const cells = ["3.1a", "3.1b", "3.1c", "3.1d", "3.1e", "3.2", "4A1", "4A2", "4A3", "4A4", "4A5", "4B1", "4B2", "4D1", "4D2", "5.exempt.inter", "5.exempt.intra", "5.nongst.inter", "5.nongst.intra", "5.1.interest", "5.1.latefee"];
  const adjustments = ["itc_impg", "itc_isd", "itc_other", "itc_rev_rules", "itc_rev_other", "itc_reclaim", "itc_ineligible", "inward_exempt_inter", "inward_exempt_intra", "inward_nongst_inter", "inward_nongst_intra", "interest", "late_fee", "outward_zero"];
  const tables = ["b2b", "b2cl", "b2cs", "cdnr", "cdnur", "exp", "nil", "at", "txpd", "docs", "voided"];
  const dynamic = [
    ...["error", "warning", "info"].map((x) => `billing.gst.severity.${x}`),
    ...["gstr1", "gstr3b", "pmt06", "cmp08", "gstr4", "gstr2b"].map((x) => `billing.gst.return.${x}`),
    ...["overview", "gstr1", "gstr3b", "itc", "gstr2b", "composition", "settings"].map((x) => `billing.gst.tabs.${x}`),
    ...["regular", "qrmp", "composition"].flatMap((x) => [`billing.gst.scheme.${x}`, `billing.gst.scheme.${x}Body`, `billing.gst.settings.scheme.${x}`]),
    ...["filed", "overdue", "due_soon", "upcoming"].map((x) => `billing.gst.cal.status.${x}`),
    ...[...profile, ...g1.map((c) => `g1_${c}`), ...others].map((c) => `billing.gst.issue.${c}`),
    ...g1.map((c) => `billing.gst.g1.problem.${c}`),
    ...tables.flatMap((x) => [`billing.gst.g1.table.${x}`, `billing.gst.g1.tableHelp.${x}`]),
    ...["INTRB2B", "INTRB2C", "INTRAB2B", "INTRAB2C"].map((x) => `billing.gst.g1.nilKind.${x}`),
    ...["no_gstin", "invalid_gstin", "composition", "lapsed_16_4"].map((x) => `billing.gst.g3.warn.${x}`),
    ...["outward", "unreg", "itc", "inward"].flatMap((x) => [`billing.gst.g3.group.${x}`, `billing.gst.g3.groupHint.${x}`]),
    ...cells.map((c) => `billing.gst.cell.${c}`),
    ...["invoice", "credit_note", "purchase", "expense", "debit_note", "adjustment"].map((x) => `billing.gst.doc.${x}`),
    ...adjustments.flatMap((x) => [`billing.gst.adj.kinds.${x}`, `billing.gst.adj.help.${x}`]),
    ...["eligible", "ineligible", "blocked", "reversal"].flatMap((x) => [`billing.gst.itc.status.${x}`, `billing.gst.itc.choice.${x}`, `billing.gst.itc.choiceHelp.${x}`]),
    "billing.gst.itc.choice.auto",
    ...["ok", "no_gstin", "no_tax", "composition", "owner_ineligible", "owner_blocked", "owner_reversal", "lapsed_16_4", "rcm_unpaid", "rcm_paid"].map((x) => `billing.gst.itc.reason.${x}`),
    ...["rule37", "rule38", "rule42", "rule43", "section17_5", "other"].map((x) => `billing.gst.itc.rev.${x}`),
    ...["oth", "impg", "imps", "isd"].map((x) => `billing.gst.itc.class.${x}`),
    ...["matched", "fuzzy", "amount_mismatch", "missing_in_books", "accepted", "ignored"].map((x) => `billing.gst.b2.status.${x}`),
    ...["inv", "cn", "dn"].map((x) => `billing.gst.b2.kind.${x}`),
    ...["accept", "ignore", "reopen"].map((x) => `billing.gst.b2.done.${x}`),
    ...["taxable", "igst", "cgst", "sgst", "cess", "date", "number"].map((x) => `billing.gst.b2.diff.${x}`),
    ...["bank", "cash", "upi", "cheque", "other"].map((x) => `billing.gst.pay.methods.${x}`),
    ...["registered", "rcmRegistered", "rcmUnregistered", "imports"].map((x) => `billing.gst.g4.inward.${x}`),
    ...["trader", "manufacturer", "restaurant", "services"].map((x) => `billing.gst.type.${x}`),
    ...["nil", "exempt", "nongst"].flatMap((x) => [`billing.gst.zero.${x}`, `billing.gst.zeroHelp.${x}`]),
  ];

  it("defines every billing.gst.* key the screens use, in English and Tamil", () => {
    const used = new Set<string>(["billing.nav.gst"]);
    for (const f of files) for (const m of readFileSync(join(__dirname, f), "utf8").matchAll(/["'`](billing\.(?:gst|nav\.gst)[a-zA-Z0-9_.]*)["'`]/g)) used.add(m[1]!);
    const all = [...used, ...dynamic].filter((k) => !k.endsWith("."));
    expect(all.filter((k) => !(k in en))).toEqual([]);
    expect(all.filter((k) => !(k in ta))).toEqual([]);
  });

  it("has the same keys in both languages", () => {
    const keys = (m: Record<string, string>) => Object.keys(m).filter((k) => k.startsWith("billing.gst.") || k === "billing.nav.gst").sort();
    expect(keys(ta)).toEqual(keys(en));
  });

  it("has Tamil script in every Tamil GST string (apart from names, numbers and symbols)", () => {
    const keys = Object.keys(en).filter((k) => k.startsWith("billing.gst.") || k === "billing.nav.gst");
    const latin = keys.filter((k) => !/[஀-௿]/.test(ta[k]!) && !/^[A-Z0-9 ()%/.{}+·#-]+$/i.test(ta[k]!));
    expect(latin).toEqual([]);
  });

  it("keeps the same {placeholders} in both languages", () => {
    const ph = (s: string) => [...new Set([...s.matchAll(/\{(\w+)[,}]/g)].map((m) => m[1]))].sort().join(",");
    const bad = Object.keys(en).filter((k) => k.startsWith("billing.gst.") && ph(en[k]!) !== ph(ta[k]!));
    expect(bad).toEqual([]);
  });

  it("adds the GST page to the insights group behind the GST reports feature and reports.view", () => {
    const m = billingModule();
    const item = m.nav.find((s) => s.id === "insights")?.items.find((i) => i.href === "gst");
    expect(item?.label).toBe("billing.nav.gst");
    expect(item?.feature).toBe("invoices.gst-reports");
    expect(item?.permission).toBe("reports.view");
    const route = m.routes.find((r) => r.path === "gst");
    expect(route?.feature).toBe("invoices.gst-reports");
    expect(route?.permission).toBe("reports.view");
  });

  it("numbers quarters like the back end (Q1 = April to June, the key carries the year of the last month)", async () => {
    const { quarterOfMonth, parseQuarter, quarterOptions } = await import("./lib/gst");
    expect(quarterOfMonth("2026-04").key).toBe("2026-Q1");
    expect(quarterOfMonth("2026-09").key).toBe("2026-Q2");
    expect(quarterOfMonth("2026-10").months).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(quarterOfMonth("2027-02").key).toBe("2027-Q4");
    expect(parseQuarter("2027-Q4")?.from).toBe("2027-01-01");
    expect(parseQuarter("2026-Q3")?.to).toBe("2026-12-31");
    expect(quarterOptions("2026-10-24", 3)).toEqual(["2026-Q3", "2026-Q2", "2026-Q1"]);
  });
});
