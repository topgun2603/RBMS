import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildNavModel, featureChecker, normalizeBase, type FeatureState, type MountedModule } from "@srirealtime/web";
import { billingMessages, billingModule } from "./index";
import { permissionMatches } from "./lib/access";
import { CHALLAN_REASONS, CHALLAN_STATUSES, PROFORMA_DISPLAY_STATUSES, SALE_ORDER_STATUSES, SALES_DOC_EVENT_TYPES, salesDocAsInvoice, TRANSPORT_MODES } from "./lib/types-sales-docs";
import { SALES_DOC_PDF } from "./components/sales-docs/sd-detail";

const KEYS = ["invoices", "invoices.quotations", "invoices.sales-docs", "inventory"];

function featuresOf(off: string[] = []) {
  return {
    appId: "BL",
    planId: "pro",
    enabled: KEYS.filter((k) => !off.includes(k)),
    features: KEYS.map<FeatureState>((key) => ({
      key,
      module: key.split(".")[0]!,
      label: key,
      description: "",
      dependsOn: [],
      shopToggle: true,
      enabled: !off.includes(key),
      reason: off.includes(key) ? "app" : null,
      available: !off.includes(key),
      shopEnabled: null,
    })),
  };
}

const visible = (off: string[]) => {
  const { check } = featureChecker(featuresOf(off));
  return (g: { feature?: string | readonly string[] }, m?: { features?: readonly string[] }) => check(g.feature, m?.features).ok;
};

describe("sales documents in the billing module", () => {
  it("adds proformas, sale orders and challans to the sell section after quotations, behind the feature and sales-docs.view", () => {
    const m = billingModule({ basePath: "/" });
    const mounted: MountedModule = { ...m, basePath: normalizeBase(m.basePath) };
    const sell = m.nav.find((s) => s.id === "sell")!;
    const hrefs = sell.items.map((i) => i.href);
    expect(hrefs.slice(hrefs.indexOf("quotations"), hrefs.indexOf("quotations") + 4)).toEqual(["quotations", "proformas", "sale-orders", "challans"]);
    for (const h of ["proformas", "sale-orders", "challans"]) {
      expect(sell.items.find((i) => i.href === h)).toMatchObject({ feature: "invoices.sales-docs", permission: "sales-docs.view" });
    }
    const navHrefs = (off: string[]) => buildNavModel({ modules: [mounted] }, visible(off), []).sections.flatMap((s) => s.items.map((i) => i.href));
    expect(navHrefs([])).toContain("/challans");
    expect(navHrefs(["invoices.sales-docs"])).not.toContain("/challans");
  });

  it("lists, creates and shows each kind with the right permission; static segments before :id", () => {
    const m = billingModule();
    const route = (p: string) => m.routes.find((r) => r.path === p)!;
    for (const base of ["proformas", "sale-orders", "challans"]) {
      expect(route(base)).toMatchObject({ feature: "invoices.sales-docs", permission: "sales-docs.view" });
      expect(route(`${base}/new`)).toMatchObject({ feature: "invoices.sales-docs", permission: "sales-docs.manage" });
      expect(route(`${base}/:id`)).toMatchObject({ feature: "invoices.sales-docs", permission: "sales-docs.view" });
      const paths = m.routes.map((r) => r.path);
      expect(paths.indexOf(`${base}/new`)).toBeLessThan(paths.indexOf(`${base}/:id`));
    }
    expect(route("proformas/:id/edit").permission).toBe("sales-docs.manage");
    expect(route("sale-orders/:id/edit").permission).toBe("sales-docs.manage");
    // The quotation and Part B screens are still there.
    expect(route("quotations/:id")).toBeDefined();
    expect(route("accounting/bank")).toBeDefined();
  });

  it("serves the customer's page without sign-in at d/:token, keeps q/:token, and adds settings and quick actions", () => {
    const m = billingModule();
    expect(m.publicRoutes?.find((r) => r.path === "d/:token")?.feature).toBe("invoices.sales-docs");
    expect(m.publicRoutes?.find((r) => r.path === "q/:token")).toBeDefined();
    expect(m.settings?.find((s) => s.path === "sales-docs")?.feature).toBe("invoices.sales-docs");
    expect(m.actions?.find((a) => a.id === "new-challan")).toMatchObject({ href: "challans/new", permission: "sales-docs.manage" });
    for (const p of [...m.routes.map((r) => r.path), ...(m.publicRoutes ?? []).map((r) => r.path)]) expect(p.startsWith("/"), p).toBe(false);
  });

  it("builds the PDF paths of the documents module", () => {
    expect(SALES_DOC_PDF.proforma("p1")).toBe("/documents/proforma/p1.pdf");
    expect(SALES_DOC_PDF.sale_order("s1")).toBe("/documents/sale-order/s1.pdf");
    expect(SALES_DOC_PDF.challan("c1")).toBe("/documents/challan/c1.pdf");
  });

  it("matches the permissions like the server", () => {
    expect(permissionMatches("*.view", "sales-docs.view")).toBe(true);
    expect(permissionMatches("*.view", "sales-docs.manage")).toBe(false);
    expect(permissionMatches("sales-docs.*", "sales-docs.manage")).toBe(true);
    expect(permissionMatches("invoices.*", "sales-docs.view")).toBe(false);
  });

  it("knows the same statuses and reasons as the server", () => {
    expect([...PROFORMA_DISPLAY_STATUSES]).toEqual(["draft", "issued", "converted", "cancelled", "expired"]);
    expect([...SALE_ORDER_STATUSES]).toEqual(["open", "partly_delivered", "delivered", "invoiced", "cancelled"]);
    expect([...CHALLAN_STATUSES]).toEqual(["issued", "partly_returned", "returned", "invoiced", "cancelled"]);
    expect([...CHALLAN_REASONS].sort()).toEqual(["approval", "before_invoice", "exhibition", "job_work", "other"]);
  });

  it("draws a document as a bill with nothing paid and no due date", () => {
    const inv = salesDocAsInvoice({
      number: "DC/26-27/0001",
      date: "2026-10-14",
      status: "cancelled",
      customer: { name: "Ravi", phone: null, email: null, gstin: null, address: null, stateCode: "33" },
      seller: {},
      placeOfSupply: "33",
      interState: false,
      lines: [],
      totals: { subtotal: 100, discount: 0, taxable: 100, cgst: 0, sgst: 0, igst: 0, roundOff: 0, total: 100, taxBreakup: [] },
      amountInWords: "",
      notes: null,
    });
    expect(inv).toMatchObject({ number: "DC/26-27/0001", paid: 0, balance: 0, dueDate: null, status: "cancelled", total: 100 });
  });
});

describe("sales document messages", () => {
  const { en, ta } = billingMessages;
  const own = (m: Record<string, string>) =>
    Object.keys(m).filter((k) => k.startsWith("billing.sd.") || /^billing\.nav\.(proformas|saleOrders|challans|newSaleOrder|newChallan|salesDocSettings)$/.test(k) || k.startsWith("billing.movements.reason.challan_"));

  it("has the same keys in English and Tamil", () => {
    expect(own(ta).sort()).toEqual(own(en).sort());
    expect(own(en).length).toBeGreaterThan(250);
  });

  it("defines every billing.sd.* key the screens use, literal and built from a status / reason / kind", () => {
    const files = [
      "sales-docs.tsx",
      "components/sales-docs/sd-ui.tsx",
      "components/sales-docs/sd-form.tsx",
      "components/sales-docs/sd-dialogs.tsx",
      "components/sales-docs/sd-detail.tsx",
      "components/sales-docs/sd-list.tsx",
      "components/sales-docs/linked-sales-docs.tsx",
      "components/quotations/quotation-dialogs.tsx",
      "pages/quotation-detail.tsx",
      "pages/proforma-detail.tsx",
      "pages/proforma-new.tsx",
      "pages/proforma-edit.tsx",
      "pages/sale-order-detail.tsx",
      "pages/sale-order-new.tsx",
      "pages/sale-order-edit.tsx",
      "pages/challan-detail.tsx",
      "pages/challan-new.tsx",
      "pages/settings-sales-docs.tsx",
      "pages/public-sales-doc.tsx",
    ];
    const used = new Set<string>();
    for (const f of files) for (const m of readFileSync(join(__dirname, f), "utf8").matchAll(/["'`](billing\.(?:sd\.|nav\.(?:proformas|saleOrders|challans|newSaleOrder|newChallan|salesDocSettings))[a-zA-Z0-9_.]*)["'`]/g)) used.add(m[1]!);
    const kinds = ["proforma", "sale_order", "challan"] as const;
    const dynamic = [
      ...PROFORMA_DISPLAY_STATUSES.map((s) => `billing.sd.status.proforma.${s}`),
      ...SALE_ORDER_STATUSES.map((s) => `billing.sd.status.sale_order.${s}`),
      ...CHALLAN_STATUSES.map((s) => `billing.sd.status.challan.${s}`),
      ...CHALLAN_REASONS.flatMap((r) => [`billing.sd.reason.${r}`, `billing.sd.reasonHint.${r}`]),
      ...SALES_DOC_EVENT_TYPES.map((e) => `billing.sd.event.${e}`),
      ...TRANSPORT_MODES.map((m) => `billing.sd.transport.modes.${m}`),
      ...["whatsapp", "sms", "email"].flatMap((c) => [`billing.sd.send.channels.${c}`, `billing.sd.send.go.${c}`, `billing.sd.send.sent.${c}`]),
      ...kinds.flatMap((k) => [
        `billing.sd.file.${k}`,
        `billing.sd.form.title.${k}`,
        `billing.sd.form.notInvoice.${k}`,
        `billing.sd.list.title.${k}`,
        `billing.sd.list.subtitle.${k}`,
        `billing.sd.list.search.${k}`,
        `billing.sd.list.emptyTitle.${k}`,
        `billing.sd.list.emptyBody.${k}`,
        `billing.sd.new.${k}`,
        `billing.sd.send.body.${k}`,
        `billing.sd.send.message.${k}`,
        `billing.sd.cancel.body.${k}`,
      ]),
      "billing.movements.reason.challan_out",
      "billing.movements.reason.challan_return",
      "billing.movements.reason.challan_cancel",
    ];
    const all = [...used, ...dynamic].filter((k) => !k.endsWith("."));
    expect(all.filter((k) => !(k in en))).toEqual([]);
    expect(all.filter((k) => !(k in ta))).toEqual([]);
  });

  it("writes the Tamil titles in Tamil script and keeps placeholders the same", () => {
    expect(ta["billing.sd.doc.challanTitle"]).toMatch(/[஀-௿]/);
    expect(ta["billing.nav.proformas"]).toMatch(/[஀-௿]/);
    const ph = (s: string) => [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]!).sort();
    expect(own(en).filter((k) => JSON.stringify(ph(en[k]!)) !== JSON.stringify(ph(ta[k]!)))).toEqual([]);
  });

  it("says RBMS, never the internal names, in customer-facing text", () => {
    for (const m of [en, ta]) for (const k of own(m)) expect(m[k], k).not.toMatch(/srikit|srirealtime/i);
    expect(en["billing.sd.public.footer"]).toContain("RBMS");
  });
});
