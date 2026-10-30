import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildNavModel, featureChecker, normalizeBase, type FeatureState, type MountedModule } from "@rbms/web";
import { permissionMatches } from "./lib/access";
import { billingMessages } from "./lib/messages";
import { PDF_PATHS } from "./lib/pdf";
import { QUOTATION_DISPLAY_STATUSES, quotationAsInvoice, quotationDocMeta, type Quotation } from "./lib/types-quotations";
import { billingModule } from "./module";

const KEYS = ["invoices", "invoices.whatsapp", "invoices.credit-book", "invoices.reports", "invoices.quotations", "payments", "inventory"];

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

function mount(basePath: string): MountedModule {
  const m = billingModule({ basePath });
  return { ...m, basePath: normalizeBase(m.basePath) };
}

const visible = (off: string[]) => {
  const { check } = featureChecker(featuresOf(off));
  return (g: { feature?: string | readonly string[] }, m?: { features?: readonly string[] }) => check(g.feature, m?.features).ok;
};

describe("quotations in the billing module", () => {
  it("adds a Quotations item to the sell section, gated by the feature and quotations.view", () => {
    const m = mount("/");
    const sell = m.nav.find((s) => s.id === "sell")!;
    const item = sell.items.find((i) => i.href === "quotations")!;
    expect(item).toMatchObject({ label: "billing.nav.quotations", feature: "invoices.quotations", permission: "quotations.view" });
    expect(sell.items.map((i) => i.href).indexOf("quotations")).toBeGreaterThan(sell.items.map((i) => i.href).indexOf("invoices"));
    const hrefs = (off: string[]) => buildNavModel({ modules: [m] }, visible(off), []).sections.flatMap((s) => s.items.map((i) => i.href));
    expect(hrefs([])).toContain("/quotations");
    expect(hrefs(["invoices.quotations"])).not.toContain("/quotations");
  });

  it("lists, creates, shows and edits quotations behind the feature and the right permission", () => {
    const m = billingModule();
    const route = (p: string) => m.routes.find((r) => r.path === p)!;
    for (const p of ["quotations", "quotations/new", "quotations/:id", "quotations/:id/edit"]) expect(route(p).feature, p).toBe("invoices.quotations");
    expect(route("quotations").permission).toBe("quotations.view");
    expect(route("quotations/:id").permission).toBe("quotations.view");
    expect(route("quotations/new").permission).toBe("quotations.manage");
    expect(route("quotations/:id/edit").permission).toBe("quotations.manage");
    // Static segments come before ":id" so "new" is never read as an id.
    const paths = m.routes.map((r) => r.path);
    expect(paths.indexOf("quotations/new")).toBeLessThan(paths.indexOf("quotations/:id"));
  });

  it("serves the customer's page without sign-in at q/:token", () => {
    const m = billingModule();
    expect(m.publicRoutes?.find((r) => r.path === "q/:token")?.feature).toBe("invoices.quotations");
  });

  it("has a dashboard tile, a quick action and a settings page, all behind the feature", () => {
    const m = billingModule();
    expect(m.widgets?.find((w) => w.id === "kpi-quotations")).toMatchObject({ zone: "kpi", feature: "invoices.quotations" });
    expect(m.actions?.find((a) => a.id === "new-quotation")).toMatchObject({ href: "quotations/new", feature: "invoices.quotations" });
    expect(m.settings?.find((s) => s.path === "quotations")?.feature).toBe("invoices.quotations");
    const ok = visible([]);
    const off = visible(["invoices.quotations"]);
    expect((m.widgets ?? []).filter((w) => ok(w, m)).map((w) => w.id)).toContain("kpi-quotations");
    expect((m.widgets ?? []).filter((w) => off(w, m)).map((w) => w.id)).not.toContain("kpi-quotations");
  });

  it("uses module-relative paths under any base path", () => {
    const m = billingModule({ basePath: "/billing" });
    for (const p of [...m.routes.map((r) => r.path), ...(m.publicRoutes ?? []).map((r) => r.path), ...(m.actions ?? []).map((a) => a.href)]) expect(p.startsWith("/"), p).toBe(false);
  });

  it("builds the quotation PDF paths", () => {
    expect(PDF_PATHS.quotation("q1")).toBe("/documents/quotation/q1.pdf");
    expect(PDF_PATHS.quotationThermal("q1")).toBe("/documents/quotation-thermal/q1.pdf");
  });

  it("matches the quotation permissions like the server", () => {
    expect(permissionMatches("quotations.*", "quotations.manage")).toBe(true);
    expect(permissionMatches("*.view", "quotations.view")).toBe(true);
    expect(permissionMatches("*.view", "quotations.manage")).toBe(false);
    expect(permissionMatches("invoices.*", "quotations.view")).toBe(false);
  });
});

describe("quotation data helpers", () => {
  const base = {
    id: "q1",
    number: "QT/26-27/0001",
    rev: 2,
    status: "sent",
    validUntil: "2026-11-08",
    terms: "Pay 50% advance",
    deliveryText: "2 weeks",
    advancePercent: 50,
    advanceAmount: 5000,
    displayStatus: "sent",
    respondedBy: null,
    respondedAt: null,
    date: "2026-10-24",
    customer: { name: "Ravi", phone: null, email: null, gstin: null, address: null, stateCode: "33" },
    placeOfSupply: "33",
    interState: false,
    lines: [],
    totals: { subtotal: 10000, discount: 0, taxable: 10000, cgst: 0, sgst: 0, igst: 0, roundOff: 0, total: 10000, taxBreakup: [] },
    amountInWords: "",
    notes: null,
    total: 10000,
    createdAt: "2026-10-24T00:00:00Z",
    updatedAt: "2026-10-24T00:00:00Z",
    seller: { legalName: "Shop" },
  } as unknown as Quotation;

  it("draws a quotation as a bill with nothing paid and no due date", () => {
    const inv = quotationAsInvoice(base);
    expect(inv).toMatchObject({ number: "QT/26-27/0001", paid: 0, balance: 0, dueDate: null, status: "issued", total: 10000 });
    expect(quotationAsInvoice({ ...base, status: "cancelled" }).status).toBe("cancelled");
  });

  it("shows who accepted only for accepted (or accepted then billed) quotations", () => {
    expect(quotationDocMeta(base).acceptedBy).toBeNull();
    const accepted = { ...base, status: "accepted", displayStatus: "accepted", respondedBy: "Priya", respondedAt: "2026-10-25T05:00:00Z" } as Quotation;
    expect(quotationDocMeta(accepted)).toMatchObject({ acceptedBy: "Priya", acceptedAt: "2026-10-25T05:00:00Z", rev: 2, advancePercent: 50 });
    expect(quotationDocMeta({ ...accepted, status: "converted" } as Quotation).acceptedBy).toBe("Priya");
    expect(quotationDocMeta({ ...accepted, status: "declined" } as Quotation).acceptedBy).toBeNull();
  });

  it("knows the same statuses as the server", () => {
    expect([...QUOTATION_DISPLAY_STATUSES]).toEqual(["draft", "sent", "accepted", "declined", "cancelled", "converted", "expired"]);
  });
});

describe("quotation messages", () => {
  const { en, ta } = billingMessages;
  const quoteKeys = (m: Record<string, string>) => Object.keys(m).filter((k) => k.startsWith("billing.q.") || /^billing\.nav\.(quotations|newQuotation|quotationSettings)$/.test(k));

  it("has the same keys in English and Tamil", () => {
    expect(quoteKeys(ta).sort()).toEqual(quoteKeys(en).sort());
    expect(quoteKeys(en).length).toBeGreaterThan(150);
  });

  it("defines every literal billing.q.* key the quotation screens use", () => {
    const files = [
      "pages/quotations.tsx",
      "pages/quotation-new.tsx",
      "pages/quotation-edit.tsx",
      "pages/quotation-detail.tsx",
      "pages/public-quotation.tsx",
      "pages/settings-quotations.tsx",
      "components/quotations/quotation-form.tsx",
      "components/quotations/quotation-dialogs.tsx",
      "components/quotations/quotation-ui.tsx",
      "components/quotations/linked-quotation.tsx",
      "components/invoice-document.tsx",
      "widgets/quotations.tsx",
      "module.tsx",
    ];
    const used = new Set<string>();
    for (const f of files) for (const m of readFileSync(join(__dirname, f), "utf8").matchAll(/["'`](billing\.(?:q\.|nav\.(?:quotations|newQuotation|quotationSettings))[a-zA-Z0-9_.]*)["'`]/g)) used.add(m[1]!);
    const dynamic = [
      ...QUOTATION_DISPLAY_STATUSES.map((s) => `billing.q.status.${s}`),
      ...["created", "revised", "sent", "viewed", "accepted", "declined", "converted", "cancelled"].map((e) => `billing.q.event.${e}`),
      ...["whatsapp", "sms", "email"].flatMap((c) => [`billing.q.send.channels.${c}`, `billing.q.send.go.${c}`, `billing.q.send.sent.${c}`]),
      "billing.q.convert.doneIssued",
      "billing.q.convert.doneDraft",
      "billing.q.acceptedByName",
      "billing.q.declinedBy",
      "billing.q.billedAs",
      "billing.q.orderedAs",
    ];
    const all = [...used, ...dynamic].filter((k) => !k.endsWith("."));
    expect(all.filter((k) => !(k in en))).toEqual([]);
    expect(all.filter((k) => !(k in ta))).toEqual([]);
  });

  it("writes the Tamil titles in Tamil script", () => {
    expect(ta["billing.q.doc.title"]).toBe("மதிப்பீடு");
    expect(ta["billing.nav.quotations"]).toMatch(/[஀-௿]/);
    expect(ta["billing.q.public.accept"]).toMatch(/[஀-௿]/);
  });

  it("keeps placeholders the same in both languages", () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)/g)].map((m) => m[1]!).sort();
    const bad = quoteKeys(en).filter((k) => JSON.stringify(ph(en[k]!)) !== JSON.stringify(ph(ta[k]!)));
    expect(bad).toEqual([]);
  });
});
